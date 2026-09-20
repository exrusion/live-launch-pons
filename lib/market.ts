import { erc20Abi, formatEther, formatUnits, parseAbi, type Address } from "viem";
import { publicClient } from "@/lib/pons";
import { PONS_FACTORY_ABI } from "@/lib/pons-abi";
import { PONS_V2_FACTORY } from "@/lib/chain";

const curveAbi = parseAbi([
  "function getReserves() view returns (uint256 quoteReserve,uint256 tokenReserve)",
  "function realQuoteReserve() view returns (uint256)",
  "function graduationThreshold() view returns (uint256)",
  "function sellableTokens() view returns (uint256)",
  "function readyToGraduate() view returns (bool)",
]);

export async function tokenMarketData(token: Address) {
  try {
    const record = await publicClient.readContract({ address: PONS_V2_FACTORY, abi: PONS_FACTORY_ABI, functionName: "getLaunchedToken", args: [token] });
    if (!record.exists) return null;
    if (record.phase === 0) {
      const [reserves, raised, threshold, sellable, ready, totalSupply, decimals] = await Promise.all([
        publicClient.readContract({ address: record.curve, abi: curveAbi, functionName: "getReserves" }),
        publicClient.readContract({ address: record.curve, abi: curveAbi, functionName: "realQuoteReserve" }),
        publicClient.readContract({ address: record.curve, abi: curveAbi, functionName: "graduationThreshold" }),
        publicClient.readContract({ address: record.curve, abi: curveAbi, functionName: "sellableTokens" }),
        publicClient.readContract({ address: record.curve, abi: curveAbi, functionName: "readyToGraduate" }),
        publicClient.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }),
        publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      ]);
      const [quoteReserve, tokenReserve] = reserves;
      const priceEth = Number(formatEther(quoteReserve)) / Number(formatUnits(tokenReserve, decimals));
      const supply = Number(formatUnits(totalSupply, decimals));
      return {
        venue: ready ? "Awaiting graduation" : "Bonding curve",
        phase: Number(record.phase),
        priceEth: Number.isFinite(priceEth) ? priceEth : null,
        marketCapEth: Number.isFinite(priceEth) ? priceEth * supply : null,
        raisedEth: formatEther(raised),
        graduationEth: formatEther(threshold),
        progress: threshold > 0n ? Math.min(100, Number((raised * 10_000n) / threshold) / 100) : 0,
        sellable: formatEther(sellable),
      };
    }
    return { venue: record.phase === 2 ? "Uniswap V4" : record.phase === 1 ? "Graduating" : "Rescued", phase: Number(record.phase), priceEth: null, marketCapEth: null, raisedEth: null, graduationEth: null, progress: record.phase === 2 ? 100 : null, sellable: null };
  } catch {
    return null;
  }
}
