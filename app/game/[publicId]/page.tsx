import { getAddress, isAddress } from "viem";
import { notFound } from "next/navigation";
import { gameByPublicId } from "@/lib/data";
import { tokenMarketData } from "@/lib/market";
import { GameFrame } from "@/components/game-frame";
import { Leaderboard } from "@/components/leaderboard";
import { StatusBadge } from "@/components/status-badge";
import { CopyButton } from "@/components/copy-button";

export const dynamic = "force-dynamic";

function compact(value: number | null) { return value === null ? "Unavailable" : new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(value); }

export default async function GamePage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const game = await gameByPublicId(publicId); if (!game) notFound();
  const market = game.token_address && isAddress(game.token_address) ? await tokenMarketData(getAddress(game.token_address)) : null;
  return <main className="shell page-shell public-game-page"><div className="game-identity"><div className="game-logo-large">{game.image_id ? <img src={`/api/assets/${game.image_id}`} alt={`${game.name} token`} /> : game.ticker.slice(0,2)}</div><div><div className="game-title-row"><h1>{game.name}</h1><span>${game.ticker}</span><StatusBadge status={game.status} /></div><p>{game.description}</p><div className="creator-line"><span className="creator-avatar">{game.creator_image ? <img src={game.creator_image} alt="" /> : "@"}</span><span>Created by <b>@{game.creator_username || "studio demo"}</b></span><i /> <span>Build v{game.version_number}</span></div></div><div className="identity-actions">{game.pons_url && <a className="button button-primary" href={game.pons_url} target="_blank" rel="noreferrer">Trade on pons ↗</a>}{game.explorer_url && <a className="button button-quiet" href={game.explorer_url} target="_blank" rel="noreferrer">Explorer ↗</a>}</div></div>
    {game.status === "DEMO" && <div className="demo-banner"><b>Playable demo</b><span>This game has no token and no blockchain activity. Market fields are intentionally unavailable.</span></div>}
    <div className="public-stage-grid"><GameFrame title={game.name} publicId={game.token_address || game.slug} versionId={game.version_id} /><aside className="market-panel"><div className="market-head"><span>Live token data</span><small>{market ? market.venue : "Source unavailable"}</small></div><div className="market-price"><span>Price</span><strong>{market?.priceEth == null ? "Unavailable" : `${market.priceEth.toExponential(3)} ETH`}</strong></div><div className="market-grid"><div><span>Market cap</span><b>{market?.marketCapEth == null ? "Unavailable" : `${compact(market.marketCapEth)} ETH`}</b></div><div><span>24h volume</span><b>Unavailable</b></div><div><span>Liquidity</span><b>Unavailable</b></div><div><span>Holders</span><b>Unavailable</b></div></div><div className="curve-card"><div><span>Curve progress</span><b>{market?.progress == null ? "Unavailable" : `${market.progress.toFixed(1)}%`}</b></div><div className="progress-track"><i style={{ width: `${market?.progress || 0}%` }} /></div><small>{market?.raisedEth && market?.graduationEth ? `${Number(market.raisedEth).toFixed(3)} / ${Number(market.graduationEth).toFixed(2)} ETH` : "Verified data not available"}</small></div>{game.token_address && <div className="contract-row"><span>Token address</span><code>{game.token_address}</code><CopyButton value={game.token_address} /></div>}<p className="market-source">On-chain values come directly from the configured pons V2 factory and curve. Missing fields remain unavailable.</p></aside></div>
    <div className="game-about-grid"><article><span>How to play</span><h2>{game.config.instructions}</h2><p>{game.config.story}</p></article><article><span>Current version</span><h2>v{game.version_number}</h2><p>Immutable ID <code>{game.deterministic_id}</code></p></article><article className="future-card"><span>Community roadmap</span><h2>Voting + AI updates</h2><p>Holder voting on characters, maps, and upgrades—and creator-published AI versions—arrive after verified holder snapshots are enabled.</p></article></div>
    <Leaderboard publicId={game.token_address || game.slug} />
  </main>;
}
