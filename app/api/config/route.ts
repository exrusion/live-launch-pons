import { NextResponse } from "next/server";
import { isXAuthConfigured } from "@/lib/auth";
import { PONS_V2_FACTORY } from "@/lib/chain";
import { hasSponsorRebateConfig } from "@/lib/rebates";

export function GET() {
  return NextResponse.json({
    xAuth: isXAuthConfigured(),
    walletConnect: Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID),
    ponsLaunch: process.env.PONS_LAUNCH_ENABLED === "true",
    freeLaunchRebate: hasSponsorRebateConfig(),
    chain: { id: 4663, name: "Robinhood Chain", rpc: process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com" },
    ponsFactory: PONS_V2_FACTORY,
    features: { governance: process.env.FEATURE_GOVERNANCE === "true", tournaments: process.env.FEATURE_TOURNAMENTS === "true" },
  });
}
