import { defineChain } from "viem";

export const ROBINHOOD_PUBLIC_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";

export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    // This shared definition is bundled for the browser. Server workloads use
    // ROBINHOOD_RPC_URL through lib/pons.ts and never expose that endpoint.
    default: { http: [process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL || ROBINHOOD_PUBLIC_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Robinhood Chain Explorer", url: "https://robinhoodchain.blockscout.com" },
  },
});

export const PONS_V2_FACTORY = (process.env.NEXT_PUBLIC_PONS_V2_FACTORY || "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e") as `0x${string}`;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
