import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { PONS_V2_FACTORY, robinhoodChain, ZERO_ADDRESS } from "@/lib/chain";
import { PONS_FACTORY_ABI } from "@/lib/pons-abi";
import { canonicalJson, safeError, sha256 } from "@/lib/security";

export type PonsTokenParams = {
  name: string;
  symbol: string;
  logo: string;
  description: string;
  socials: { twitter: string; telegram: string; discord: string; website: string; farcaster: string };
  creatorFeeRecipient: Address;
  creatorTaxBps: number;
  buybackEnabled: boolean;
  expectedEconomics: Hex;
  salt: Hex;
};

export type PonsLaunchConfig = {
  supply: bigint;
  curveFeeBps: bigint;
  phantomQuote: bigint;
  graduationThreshold: bigint;
  poolFee: number;
  tickSpacing: number;
  enabled: boolean;
};

export const publicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(robinhoodChain.rpcUrls.default.http[0], { timeout: 15_000, retryCount: 2 }),
});

export async function readPonsLaunchTerms(wallet: Address, pairToken: Address = ZERO_ADDRESS) {
  if (!isAddress(wallet)) throw new Error("INVALID_WALLET");
  const [chainId, bytecode, launchEnabled, canLaunch, launchFee, configCount, maxCreatorTaxBps] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getBytecode({ address: PONS_V2_FACTORY }),
    publicClient.readContract({ address: PONS_V2_FACTORY, abi: PONS_FACTORY_ABI, functionName: "launchEnabled" }),
    publicClient.readContract({ address: PONS_V2_FACTORY, abi: PONS_FACTORY_ABI, functionName: "canLaunch", args: [wallet] }),
    publicClient.readContract({ address: PONS_V2_FACTORY, abi: PONS_FACTORY_ABI, functionName: "launchFee" }),
    publicClient.readContract({ address: PONS_V2_FACTORY, abi: PONS_FACTORY_ABI, functionName: "launchConfigCount" }),
    publicClient.readContract({ address: PONS_V2_FACTORY, abi: PONS_FACTORY_ABI, functionName: "maxCreatorTaxBps" }),
  ]);
  if (chainId !== 4663) throw new Error("WRONG_CHAIN");
  if (!bytecode || bytecode === "0x") throw new Error("PONS_FACTORY_NOT_DEPLOYED");
  if (!launchEnabled || !canLaunch) throw new Error("PONS_LAUNCH_GATE_CLOSED");

  const requested = process.env.PONS_LAUNCH_CONFIG_ID;
  let configId: bigint | null = requested && requested !== "auto" ? BigInt(requested) : null;
  let config: PonsLaunchConfig | null = null;
  if (configId !== null) {
    config = await publicClient.readContract({ address: PONS_V2_FACTORY, abi: PONS_FACTORY_ABI, functionName: "getLaunchConfig", args: [configId] });
    if (!config.enabled) throw new Error("PONS_CONFIG_DISABLED");
  } else {
    for (let index = 0n; index < configCount; index += 1n) {
      const candidate = await publicClient.readContract({ address: PONS_V2_FACTORY, abi: PONS_FACTORY_ABI, functionName: "getLaunchConfig", args: [index] });
      if (candidate.enabled) {
        configId = index;
        config = candidate;
        break;
      }
    }
  }
  if (configId === null || !config) throw new Error("NO_ACTIVE_PONS_CONFIG");
  if (pairToken !== ZERO_ADDRESS) {
    const approved = await publicClient.readContract({ address: PONS_V2_FACTORY, abi: PONS_FACTORY_ABI, functionName: "approvedPairTokens", args: [pairToken] });
    if (!approved) throw new Error("PAIR_TOKEN_NOT_APPROVED");
  }
  const expectedEconomics = await publicClient.readContract({
    address: PONS_V2_FACTORY,
    abi: PONS_FACTORY_ABI,
    functionName: "previewLaunchEconomics",
    args: [configId, pairToken],
  });
  return { factory: PONS_V2_FACTORY, chainId, launchFee, configId, config, expectedEconomics, maxCreatorTaxBps };
}

export function buildPonsParams(input: {
  launchId: string;
  versionId: string;
  name: string;
  symbol: string;
  logo: string;
  description: string;
  xUrl?: string | null;
  websiteUrl?: string | null;
  creator: Address;
  creatorTaxBps?: number;
  buybackEnabled?: boolean;
  expectedEconomics: Hex;
}): PonsTokenParams {
  const salt = keccak256(toHex(`pons-game-studio:${input.launchId}:${input.versionId}`));
  return {
    name: input.name.slice(0, 64),
    symbol: input.symbol.slice(0, 12),
    logo: input.logo.slice(0, 512),
    description: input.description.slice(0, 512),
    socials: { twitter: input.xUrl || "", telegram: "", discord: "", website: input.websiteUrl || "", farcaster: "" },
    creatorFeeRecipient: getAddress(input.creator),
    creatorTaxBps: input.creatorTaxBps || 0,
    buybackEnabled: input.buybackEnabled ?? false,
    expectedEconomics: input.expectedEconomics,
    salt,
  };
}

export function launchCalldata(params: PonsTokenParams, configId: bigint, pairToken: Address = ZERO_ADDRESS) {
  return encodeFunctionData({ abi: PONS_FACTORY_ABI, functionName: "launchToken", args: [params, configId, pairToken] });
}

export function transactionFingerprint(params: PonsTokenParams, configId: bigint, pairToken: Address, value: bigint) {
  return sha256(canonicalJson({ params, configId: configId.toString(), pairToken: pairToken.toLowerCase(), value: value.toString() }));
}

export async function simulatePonsLaunch(account: Address, params: PonsTokenParams, configId: bigint, pairToken: Address, value: bigint) {
  return publicClient.simulateContract({ account, address: PONS_V2_FACTORY, abi: PONS_FACTORY_ABI, functionName: "launchToken", args: [params, configId, pairToken], value });
}

export function assertPonsTransactionEnvelope(input: {
  transaction: Awaited<ReturnType<typeof publicClient.getTransaction>>;
  factory: Address;
  wallet: Address;
  configId: bigint;
  pairToken: Address;
  launchFee: bigint;
  params: PonsTokenParams;
}) {
  const { transaction } = input;
  if (!transaction.to || getAddress(transaction.to) !== getAddress(input.factory)) throw new Error("WRONG_TRANSACTION_TARGET");
  if (getAddress(transaction.from) !== getAddress(input.wallet)) throw new Error("WRONG_TRANSACTION_SENDER");
  if (transaction.value !== input.launchFee) throw new Error("WRONG_TRANSACTION_VALUE");
  const decodedCall = decodeFunctionData({ abi: PONS_FACTORY_ABI, data: transaction.input });
  if (decodedCall.functionName !== "launchToken") throw new Error("WRONG_TRANSACTION_CALL");
  const [params, configId, pairToken] = decodedCall.args;
  if (BigInt(configId) !== input.configId || getAddress(pairToken) !== getAddress(input.pairToken)) throw new Error("LAUNCH_TERMS_MISMATCH");
  if (transactionFingerprint(params as PonsTokenParams, BigInt(configId), pairToken, transaction.value) !== transactionFingerprint(input.params, input.configId, input.pairToken, input.launchFee)) {
    throw new Error("LAUNCH_METADATA_MISMATCH");
  }
  return decodedCall;
}

export async function preflightSubmittedPonsTransaction(input: {
  transactionHash: Hex;
  factory: Address;
  wallet: Address;
  configId: bigint;
  pairToken: Address;
  launchFee: bigint;
  params: PonsTokenParams;
}) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const transaction = await publicClient.getTransaction({ hash: input.transactionHash });
      assertPonsTransactionEnvelope({ ...input, transaction });
      return transaction;
    } catch (error) {
      lastError = error;
      if (!/not found|could not be found/i.test(safeError(error)) || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastError;
}

export async function verifyPonsLaunch(input: {
  transactionHash: Hex;
  factory: Address;
  wallet: Address;
  configId: bigint;
  pairToken: Address;
  launchFee: bigint;
  params: PonsTokenParams;
}) {
  const [transaction, receipt] = await Promise.all([
    publicClient.getTransaction({ hash: input.transactionHash }),
    publicClient.waitForTransactionReceipt({ hash: input.transactionHash, confirmations: 2, timeout: 180_000 }),
  ]);
  if (receipt.status !== "success") throw new Error("PONS_TRANSACTION_REVERTED");
  assertPonsTransactionEnvelope({ ...input, transaction });

  let launched: { token: Address; curve: Address; deployer: Address; pairToken: Address; launchConfigId: bigint; graduationThreshold: bigint } | null = null;
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(input.factory)) continue;
    try {
      const event = decodeEventLog({ abi: PONS_FACTORY_ABI, eventName: "TokenLaunched", data: log.data, topics: log.topics });
      launched = event.args;
      break;
    } catch {
      continue;
    }
  }
  if (!launched) throw new Error("PONS_LAUNCH_EVENT_MISSING");
  if (getAddress(launched.deployer) !== getAddress(input.wallet)) throw new Error("PONS_DEPLOYER_MISMATCH");
  if (launched.launchConfigId !== input.configId || getAddress(launched.pairToken) !== getAddress(input.pairToken)) throw new Error("PONS_EVENT_TERMS_MISMATCH");
  const record = await publicClient.readContract({ address: input.factory, abi: PONS_FACTORY_ABI, functionName: "getLaunchedToken", args: [launched.token] });
  if (!record.exists || getAddress(record.token) !== getAddress(launched.token) || getAddress(record.curve) !== getAddress(launched.curve)) throw new Error("PONS_FACTORY_RECORD_INVALID");
  if (getAddress(record.deployer) !== getAddress(input.wallet) || getAddress(record.creatorFeeRecipient) !== getAddress(input.params.creatorFeeRecipient)) throw new Error("PONS_FACTORY_RECORD_MISMATCH");
  return { receipt, transaction, token: getAddress(launched.token), curve: getAddress(launched.curve), record };
}

export function ponsTradingUrl(token: string) {
  return `https://www.ponsfamily.com/launchpad/${token}`;
}

export function explorerTokenUrl(token: string) {
  return `https://robinhoodchain.blockscout.com/token/${token}`;
}
