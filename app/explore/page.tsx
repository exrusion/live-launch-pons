import Link from "next/link";
import { exploreGames } from "@/lib/data";
import { StatusBadge } from "@/components/status-badge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Explore games" };

export default async function ExplorePage() {
  const games = await exploreGames();
  return <main className="shell page-shell"><div className="page-heading"><div><span className="eyebrow">Arcade floor</span><h1>Play what launched.</h1><p>Every live card connects a frozen game build to a verified pons token address.</p></div><Link className="button button-primary" href="/create">Create a game</Link></div>
    <div className="filter-bar"><span className="active">All games</span><span>Runner</span><span>Flappy-style</span><span>Shooter</span><small>{games.length} available</small></div>
    {games.length ? <div className="games-grid">{games.map((game) => <Link className="game-card" key={game.id} href={`/game/${game.tokenAddress || game.slug}`}><div className={`game-card-art art-${game.category.toLowerCase()}`}><span className="game-token-image">{game.imageId ? <img src={`/api/assets/${game.imageId}`} alt="" /> : game.ticker.slice(0,2)}</span><StatusBadge status={game.status} /><div className="art-grid" /><i className="art-character" /><i className="art-target" /></div><div className="game-card-body"><div><h2>{game.name}</h2><span>${game.ticker}</span></div><p>{game.description}</p><footer><span>{game.category.toLowerCase()}</span><span>{game.players} players</span><b>Play ↗</b></footer></div></Link>)}</div> : <div className="empty-state"><span>◫</span><h2>The arcade is waiting.</h2><p>Create the first playable launch.</p><Link className="button button-primary" href="/create">Create a game</Link></div>}
  </main>;
}
