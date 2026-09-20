import Link from "next/link";
import { exploreGames } from "@/lib/data";
import { ExploreGrid } from "@/components/explore-grid";

export const dynamic = "force-dynamic";
export const metadata = { title: "Explore games" };

export default async function ExplorePage() {
  const games = await exploreGames();
  return <main className="shell page-shell"><div className="page-heading"><div><span className="eyebrow">Arcade floor</span><h1>Play what launched.</h1><p>Every live card connects a frozen game build to a verified pons token address.</p></div><Link className="button button-primary" href="/create">Create a game</Link></div>
    {games.length ? <ExploreGrid games={games} /> : <div className="empty-state"><span>◫</span><h2>The arcade is waiting.</h2><p>Create the first playable launch.</p><Link className="button button-primary" href="/create">Create a game</Link></div>}
  </main>;
}
