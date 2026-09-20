import {
  createWalletClient,
  getAddress,
  isAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PoolClient } from "pg";
import { robinhoodChain } from "@/lib/chain";
import { publicClient, robinhoodServerTransport } from "@/lib/pons";
import { query, transaction } from "@/lib/db";
import { safeError } from "@/lib/security";
import type { RebateStatus } from "@/lib/types";

type RebateRow = {
  id: string;
  user_id: string;
  wallet_address: string;
  chain_id: number;
  launch_fee_wei: string;
  status: string;
  transaction_hash: string | null;
  receipt_block: string | null;
  token_address: string | null;
  free_credit_id: string | null;
  rebate_status: RebateStatus;
  rebate_tx_hash: string | null;
  rebate_signed_transaction: string | null;
  rebate_sponsor_address: string | null;
  rebate_nonce: string | null;
  rebate_reserved_wei: string;
  rebate_attempts: number;
};

type TransferFees =
  | { type: "eip1559"; gasLimit: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
  | { type: "legacy"; gasLimit: bigint; gasPrice: bigint };

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const REBATE_CONFIRMATIONS = 2;
const REBATE_CONFIRMATION_TIMEOUT_MS = 45_000;
const GAS_LIMIT_BUFFER_BPS = 12_000n;

function positiveWei(name: "MAX_FREE_LAUNCH_REBATE_WEI" | "FREE_LAUNCH_DAILY_BUDGET_WEI") {
  const raw = process.env[name];
  if (!raw || !/^\d+$/.test(raw) || BigInt(raw) <= 0n) throw new Error(`${name}_NOT_CONFIGURED`);
  return BigInt(raw);
}

function assertRebateAmountAllowed(value: bigint) {
  if (value <= 0n) throw new Error("INVALID_REBATE_AMOUNT");
  if (value > positiveWei("MAX_FREE_LAUNCH_REBATE_WEI")) throw new Error("REBATE_AMOUNT_EXCEEDS_OPERATOR_CAP");
}

export function hasSponsorRebateConfig() {
  if (process.env.FREE_LAUNCH_REBATE_ENABLED !== "true") return false;
  try {
    positiveWei("MAX_FREE_LAUNCH_REBATE_WEI");
    positiveWei("FREE_LAUNCH_DAILY_BUDGET_WEI");
  } catch {
    return false;
  }
  if (process.env.SPONSOR_ADDRESS) return isAddress(process.env.SPONSOR_ADDRESS);
  return PRIVATE_KEY_PATTERN.test(process.env.SPONSOR_PRIVATE_KEY || "");
}

export function hasSponsorSigningConfig() {
  if (!hasSponsorRebateConfig() || !PRIVATE_KEY_PATTERN.test(process.env.SPONSOR_PRIVATE_KEY || "")) return false;
  try {
    sponsorAccount();
    return true;
  } catch {
    return false;
  }
}

function sponsorAccount() {
  if (process.env.FREE_LAUNCH_REBATE_ENABLED !== "true") throw new Error("FREE_LAUNCH_REBATE_DISABLED");
  const key = process.env.SPONSOR_PRIVATE_KEY;
  if (!key || !PRIVATE_KEY_PATTERN.test(key)) throw new Error("SPONSOR_PRIVATE_KEY_NOT_CONFIGURED");
  const account = privateKeyToAccount(key as Hex);
  if (process.env.SPONSOR_ADDRESS && (!isAddress(process.env.SPONSOR_ADDRESS) || getAddress(process.env.SPONSOR_ADDRESS) !== account.address)) {
    throw new Error("SPONSOR_ADDRESS_KEY_MISMATCH");
  }
  return account;
}

function sponsorAddress() {
  if (process.env.FREE_LAUNCH_REBATE_ENABLED !== "true") throw new Error("FREE_LAUNCH_REBATE_DISABLED");
  if (process.env.SPONSOR_ADDRESS) {
    if (!isAddress(process.env.SPONSOR_ADDRESS)) throw new Error("SPONSOR_ADDRESS_INVALID");
    return getAddress(process.env.SPONSOR_ADDRESS);
  }
  return sponsorAccount().address;
}

function sponsorWallet() {
  const account = sponsorAccount();
  return {
    account,
    client: createWalletClient({
      account,
      chain: robinhoodChain,
      transport: robinhoodServerTransport(),
    }),
  };
}

export function rebateRequiredBalance(value: bigint, gasLimit: bigint, feePerGas: bigint) {
  if (value < 0n || gasLimit < 0n || feePerGas < 0n) throw new Error("INVALID_REBATE_COST");
  return value + gasLimit * feePerGas;
}

export function nextSponsorNonce(networkPendingNonce: number, largestReservedNonce: string | null) {
  if (!Number.isSafeInteger(networkPendingNonce) || networkPendingNonce < 0) throw new Error("INVALID_NETWORK_NONCE");
  if (largestReservedNonce === null) return networkPendingNonce;
  const reserved = BigInt(largestReservedNonce);
  const candidate = reserved + 1n;
  if (candidate > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("SPONSOR_NONCE_OUT_OF_RANGE");
  return Math.max(networkPendingNonce, Number(candidate));
}

async function transferFees(sponsor: Address, recipient: Address, value: bigint): Promise<TransferFees> {
  const estimatedGas = await publicClient.estimateGas({ account: sponsor, to: recipient, value });
  const gasLimit = (estimatedGas * GAS_LIMIT_BUFFER_BPS + 9_999n) / 10_000n;
  try {
    const fees = await publicClient.estimateFeesPerGas({ type: "eip1559" });
    return {
      type: "eip1559",
      gasLimit,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    };
  } catch {
    return { type: "legacy", gasLimit, gasPrice: await publicClient.getGasPrice() };
  }
}

async function sponsorCapacity(sponsor: Address, recipient: Address, value: bigint) {
  const balance = await publicClient.getBalance({ address: sponsor });
  if (balance < value) throw new Error("REBATE_SPONSOR_UNFUNDED");
  let fees: TransferFees;
  try {
    fees = await transferFees(sponsor, recipient, value);
  } catch {
    throw new Error("REBATE_TRANSFER_PREFLIGHT_FAILED");
  }
  const feePerGas = fees.type === "eip1559" ? fees.maxFeePerGas : fees.gasPrice;
  const required = rebateRequiredBalance(value, fees.gasLimit, feePerGas);
  if (balance < required) throw new Error("REBATE_SPONSOR_UNFUNDED");
  return { balance, required, fees };
}

type RebateCapacityOptions = { client?: PoolClient; excludeLaunchId?: string };

/** Server-side only. Returns a liability amount, never account material. */
export async function assertSponsorCanReimburse(value: bigint, recipient: Address, options: RebateCapacityOptions = {}) {
  assertRebateAmountAllowed(value);
  if (!isAddress(recipient)) throw new Error("INVALID_REBATE_RECIPIENT");
  const address = sponsorAddress();
  if (options.client) await options.client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`pons-rebate-reserve:${address.toLowerCase()}`]);
  const capacity = await sponsorCapacity(address, getAddress(recipient), value);
  const committedSql = `SELECT COALESCE(sum(rebate_reserved_wei),0)::text AS total FROM pons_launches
    WHERE rebate_reserved_wei>0 AND rebate_status NOT IN ('SENT','FAILED')
      AND status NOT IN ('FAILED','EXPIRED') AND ($1::uuid IS NULL OR id<>$1::uuid)`;
  const committed = options.client
    ? await options.client.query<{ total: string }>(committedSql, [options.excludeLaunchId || null])
    : await query<{ total: string }>(committedSql, [options.excludeLaunchId || null]);
  const totalRequired = BigInt(committed.rows[0]?.total || "0") + capacity.required;
  if (capacity.balance < totalRequired) throw new Error("REBATE_SPONSOR_CAPACITY_RESERVED");
  const budgetSql = `SELECT COALESCE(sum(amount_wei),0)::text AS total FROM (
       SELECT launch_fee_wei AS amount_wei FROM pons_launches
        WHERE rebate_status='SENT' AND rebate_sent_at>=now()-interval '24 hours'
       UNION ALL
       SELECT launch_fee_wei AS amount_wei FROM pons_launches
        WHERE rebate_reserved_wei>0 AND rebate_status NOT IN ('SENT','FAILED')
          AND status NOT IN ('FAILED','EXPIRED') AND ($1::uuid IS NULL OR id<>$1::uuid)
     ) liabilities`;
  const budgetUsage = options.client
    ? await options.client.query<{ total: string }>(budgetSql, [options.excludeLaunchId || null])
    : await query<{ total: string }>(budgetSql, [options.excludeLaunchId || null]);
  if (BigInt(budgetUsage.rows[0]?.total || "0") + value > positiveWei("FREE_LAUNCH_DAILY_BUDGET_WEI")) {
    throw new Error("REBATE_DAILY_BUDGET_RESERVED");
  }
  return { reserveWei: capacity.required.toString(), sponsorAddress: address };
}

function redactedError(error: unknown) {
  const key = process.env.SPONSOR_PRIVATE_KEY;
  const detail = safeError(error);
  return key ? detail.replaceAll(key, "[redacted]") : detail;
}

async function rebateById(id: string) {
  const result = await query<RebateRow>("SELECT * FROM pons_launches WHERE id=$1 LIMIT 1", [id]);
  return result.rows[0] || null;
}

async function recordRebateFailure(id: string, code: string, detail: string) {
  await transaction(async (client) => {
    const locked = await client.query<RebateRow>("SELECT * FROM pons_launches WHERE id=$1 FOR UPDATE", [id]);
    const row = locked.rows[0];
    if (!row || row.rebate_status === "SENT" || row.rebate_status === "FAILED") return;
    await client.query(
      `UPDATE pons_launches SET rebate_status='FAILED',rebate_reserved_wei=0,rebate_next_attempt_at=NULL,
         rebate_error_code=$2,rebate_error_detail=$3,updated_at=now()
       WHERE id=$1`,
      [id, code, detail.slice(0, 500)],
    );
    await client.query(
      `INSERT INTO audit_logs(actor_user_id,actor_type,action,resource_type,resource_id,before_data,after_data)
       VALUES($1,'SYSTEM','PONS_REBATE_FAILED','PONS_LAUNCH',$2,$3::jsonb,$4::jsonb)`,
      [row.user_id, id, JSON.stringify({ status: row.rebate_status }), JSON.stringify({ status: "FAILED", code, detail: detail.slice(0, 500), transactionHash: row.rebate_tx_hash })],
    );
  });
}

async function noteRebateAttempt(id: string, code: string | null, detail: string | null, broadcast = false) {
  await query(
    `UPDATE pons_launches SET rebate_attempts=rebate_attempts+1,rebate_last_attempt_at=now(),
       rebate_broadcast_at=CASE WHEN $4 THEN COALESCE(rebate_broadcast_at,now()) ELSE rebate_broadcast_at END,
       rebate_next_attempt_at=now() + LEAST(300,(5 * power(2,LEAST(rebate_attempts,6)))::int) * interval '1 second',
       rebate_error_code=$2,rebate_error_detail=$3,updated_at=now()
     WHERE id=$1 AND rebate_status='SENDING'`,
    [id, code, detail?.slice(0, 500) || null, broadcast],
  );
}

async function prepareRebate(id: string) {
  return transaction(async (client) => {
    const { account, client: walletClient } = sponsorWallet();
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`pons-rebate-nonce:${account.address.toLowerCase()}`]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`pons-rebate-reserve:${account.address.toLowerCase()}`]);
    const locked = await client.query<RebateRow>("SELECT * FROM pons_launches WHERE id=$1 FOR UPDATE", [id]);
    const row = locked.rows[0];
    if (!row || row.rebate_status !== "PENDING") return row || null;
    if (
      row.status !== "CONFIRMED" ||
      !row.free_credit_id ||
      !row.transaction_hash ||
      !row.receipt_block ||
      !row.token_address
    ) {
      throw new Error("REBATE_REQUIRES_CANONICAL_LAUNCH");
    }
    if (row.chain_id !== robinhoodChain.id || !isAddress(row.wallet_address)) throw new Error("INVALID_REBATE_RECIPIENT");
    const recipient = getAddress(row.wallet_address);
    const value = BigInt(row.launch_fee_wei);
    assertRebateAmountAllowed(value);
    const capacity = await sponsorCapacity(account.address, recipient, value);
    const otherCommitments = await client.query<{ total: string }>(
      `SELECT COALESCE(sum(rebate_reserved_wei),0)::text AS total FROM pons_launches
       WHERE id<>$1 AND rebate_reserved_wei>0 AND rebate_status NOT IN ('SENT','FAILED')
         AND status NOT IN ('FAILED','EXPIRED')`,
      [id],
    );
    if (capacity.balance < BigInt(otherCommitments.rows[0]?.total || "0") + capacity.required) {
      throw new Error("REBATE_SPONSOR_CAPACITY_RESERVED");
    }
    const networkNonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
    const reserved = await client.query<{ max_nonce: string | null }>(
      `SELECT max(rebate_nonce)::text AS max_nonce FROM pons_launches
       WHERE chain_id=$1 AND rebate_sponsor_address=$2 AND rebate_nonce IS NOT NULL`,
      [robinhoodChain.id, account.address.toLowerCase()],
    );
    const nonce = nextSponsorNonce(networkNonce, reserved.rows[0]?.max_nonce || null);
    const common = { account, chain: robinhoodChain, to: recipient, value, nonce, gas: capacity.fees.gasLimit } as const;
    const signed = capacity.fees.type === "eip1559"
      ? await walletClient.signTransaction({
          ...common,
          type: "eip1559",
          maxFeePerGas: capacity.fees.maxFeePerGas,
          maxPriorityFeePerGas: capacity.fees.maxPriorityFeePerGas,
        })
      : await walletClient.signTransaction({ ...common, type: "legacy", gasPrice: capacity.fees.gasPrice });
    const hash = keccak256(signed);
    const updated = await client.query<RebateRow>(
      `UPDATE pons_launches SET rebate_status='SENDING',rebate_tx_hash=$2,rebate_signed_transaction=$3,
         rebate_sponsor_address=$4,rebate_nonce=$5,rebate_started_at=COALESCE(rebate_started_at,now()),
         rebate_reserved_wei=$6,rebate_next_attempt_at=now(),rebate_error_code=NULL,rebate_error_detail=NULL,updated_at=now()
       WHERE id=$1 AND rebate_status='PENDING' RETURNING *`,
      [id, hash, signed, account.address.toLowerCase(), nonce.toString(), capacity.required.toString()],
    );
    await client.query(
      `INSERT INTO audit_logs(actor_user_id,actor_type,action,resource_type,resource_id,before_data,after_data)
       VALUES($1,'SYSTEM','PONS_REBATE_SIGNED','PONS_LAUNCH',$2,$3::jsonb,$4::jsonb)`,
      [row.user_id, id, JSON.stringify({ status: "PENDING" }), JSON.stringify({ status: "SENDING", transactionHash: hash, recipient, amountWei: value.toString(), nonce })],
    );
    return updated.rows[0] || null;
  });
}

async function markRebateSent(row: RebateRow, blockNumber: bigint) {
  await transaction(async (client) => {
    const updated = await client.query<RebateRow>(
      `UPDATE pons_launches SET rebate_status='SENT',rebate_reserved_wei=0,rebate_sent_at=now(),
         rebate_next_attempt_at=NULL,rebate_error_code=NULL,rebate_error_detail=NULL,updated_at=now()
       WHERE id=$1 AND rebate_status='SENDING' AND rebate_tx_hash=$2 RETURNING *`,
      [row.id, row.rebate_tx_hash],
    );
    if (!updated.rows[0]) return;
    await client.query(
      `INSERT INTO audit_logs(actor_user_id,actor_type,action,resource_type,resource_id,before_data,after_data)
       VALUES($1,'SYSTEM','PONS_REBATE_SENT','PONS_LAUNCH',$2,$3::jsonb,$4::jsonb)`,
      [row.user_id, row.id, JSON.stringify({ status: "SENDING" }), JSON.stringify({ status: "SENT", transactionHash: row.rebate_tx_hash, blockNumber: blockNumber.toString(), amountWei: row.launch_fee_wei })],
    );
  });
}

async function broadcastAndConfirm(row: RebateRow) {
  if (!row.rebate_tx_hash || !row.rebate_signed_transaction || !row.rebate_sponsor_address) {
    await recordRebateFailure(row.id, "REBATE_STATE_INVALID", "A signed reimbursement transaction was not persisted.");
    return;
  }
  const hash = row.rebate_tx_hash as Hex;
  const signed = row.rebate_signed_transaction as Hex;
  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash });
  } catch {
    receipt = null;
  }
  if (!receipt) {
    try {
      const { client } = sponsorWallet();
      const broadcastHash = await client.sendRawTransaction({ serializedTransaction: signed });
      if (broadcastHash.toLowerCase() !== hash.toLowerCase()) throw new Error("REBATE_HASH_MISMATCH");
      await noteRebateAttempt(row.id, null, null, true);
      await query(
        `INSERT INTO audit_logs(actor_user_id,actor_type,action,resource_type,resource_id,after_data)
         VALUES($1,'SYSTEM','PONS_REBATE_BROADCAST','PONS_LAUNCH',$2,$3::jsonb)`,
        [row.user_id, row.id, JSON.stringify({ transactionHash: hash, amountWei: row.launch_fee_wei })],
      );
    } catch (error) {
      const detail = redactedError(error);
      if (/already known|known transaction/i.test(detail)) {
        await noteRebateAttempt(row.id, "REBATE_CONFIRMATION_PENDING", "The reimbursement transaction is already known by the network.", true);
      } else if (/REBATE_HASH_MISMATCH/i.test(detail)) {
        await recordRebateFailure(row.id, "REBATE_NONCE_CONFLICT", detail);
        return;
      } else if (/nonce too low/i.test(detail)) {
        // A provider can report this while the exact persisted transaction is
        // being mined. Never sign a replacement or declare failure from this
        // ambiguous response; reconciliation continues by the same hash.
        await noteRebateAttempt(row.id, "REBATE_NONCE_RECONCILIATION", detail);
        return;
      } else {
        await noteRebateAttempt(row.id, "REBATE_BROADCAST_PENDING", detail);
        return;
      }
    }
  }
  try {
    receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: REBATE_CONFIRMATIONS,
      timeout: REBATE_CONFIRMATION_TIMEOUT_MS,
    });
  } catch (error) {
    await noteRebateAttempt(row.id, "REBATE_CONFIRMATION_PENDING", redactedError(error));
    return;
  }
  if (receipt.status !== "success") {
    await recordRebateFailure(row.id, "REBATE_TRANSACTION_REVERTED", "The reimbursement transaction reverted on-chain.");
    return;
  }
  const reimbursement = await publicClient.getTransaction({ hash });
  const expectedRecipient = getAddress(row.wallet_address);
  const valid =
    reimbursement.to !== null &&
    getAddress(reimbursement.to) === expectedRecipient &&
    getAddress(reimbursement.from) === getAddress(row.rebate_sponsor_address) &&
    reimbursement.value === BigInt(row.launch_fee_wei) &&
    reimbursement.input === "0x";
  if (!valid) {
    await recordRebateFailure(row.id, "REBATE_TRANSACTION_MISMATCH", "The mined reimbursement did not match the persisted recipient and exact launch fee.");
    return;
  }
  await markRebateSent(row, receipt.blockNumber);
}

export async function processRebateForLaunch(id: string) {
  if (!hasSponsorSigningConfig()) return false;
  let row = await rebateById(id);
  if (!row || !["PENDING", "SENDING"].includes(row.rebate_status)) return false;
  try {
    if (row.rebate_status === "PENDING") {
      row = await prepareRebate(id);
      if (!row || row.rebate_status !== "SENDING") return false;
    }
    await broadcastAndConfirm(row);
    return true;
  } catch (error) {
    const detail = redactedError(error);
    if (/CANONICAL|INVALID_REBATE|WRONG_CHAIN/.test(detail)) {
      await recordRebateFailure(id, "REBATE_VALIDATION_FAILED", detail);
    } else {
      await query(
        `UPDATE pons_launches SET rebate_error_code='REBATE_PROCESSING_PENDING',rebate_error_detail=$2,
           rebate_next_attempt_at=now() + interval '30 seconds',updated_at=now()
         WHERE id=$1 AND rebate_status IN ('PENDING','SENDING')`,
        [id, detail.slice(0, 500)],
      );
    }
    return true;
  }
}

export async function processNextRebate() {
  if (!hasSponsorSigningConfig()) return false;
  const result = await query<{ id: string }>(
    `SELECT id FROM pons_launches WHERE rebate_status IN ('SENDING','PENDING')
       AND (rebate_next_attempt_at IS NULL OR rebate_next_attempt_at<=now())
     ORDER BY COALESCE(rebate_next_attempt_at,created_at) ASC,updated_at ASC LIMIT 1`,
  );
  if (!result.rows[0]) return false;
  return processRebateForLaunch(result.rows[0].id);
}
