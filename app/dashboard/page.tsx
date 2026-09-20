import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { creatorGames, freeLaunchStatus } from "@/lib/data";
import { StatusBadge } from "@/components/status-badge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Creator dashboard" };

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/create");
  const [games, credit] = await Promise.all([creatorGames(session.user.id), freeLaunchStatus(session.user.id)]);
  const live = games.filter((game) => game.status === "LIVE").length;
  return <main className="shell page-shell dashboard-page"><div className="page-heading"><div><span className="eyebrow">Creator dashboard</span><h1>Your game launchpad.</h1><p>Draft, verify, and publish each playable launch from one place.</p></div><Link className="button button-primary" href="/create">＋ New game</Link></div>
    <div className="dashboard-summary"><article className="credit-card"><div><span>Launch readiness</span><StatusBadge status={credit?.primary_wallet ? "READY" : "WALLET NEEDED"} /></div><strong>{credit?.primary_wallet ? "Wallet verified" : "Connect at launch"}</strong><p>Your wallet signature verifies ownership only when you are ready to launch.</p></article><article><span>Game drafts</span><strong>{games.filter((game) => game.status !== "LIVE").length}</strong><p>Playable versions not yet on-chain.</p></article><article><span>Live games</span><strong>{live}</strong><p>Confirmed through the official pons factory.</p></article><article><span>Verified wallet</span><strong className="address-value">{credit?.primary_wallet ? `${credit.primary_wallet.slice(0,6)}…${credit.primary_wallet.slice(-4)}` : "None"}</strong><p>Verify from the wallet control before launch.</p></article></div>
    <div className="dashboard-section-head"><div><h2>Your games</h2><p>Failed blockchain steps can be retried without regenerating the game.</p></div></div>
    {games.length ? <div className="dashboard-list">{games.map((game) => <Link key={game.id} href={`/studio/${game.id}`} className="dashboard-game"><div className="dashboard-thumb">{game.image_id ? <img src={`/api/assets/${game.image_id}`} alt="" /> : game.ticker.slice(0,2)}</div><div className="dashboard-game-copy"><div><h3>{game.name}</h3><span>${game.ticker}</span></div><p>{game.description}</p></div><StatusBadge status={game.launch_status || game.status} /><div className="dashboard-stat"><span>Version</span><b>{game.deterministic_id?.slice(0,12) || "draft"}</b></div><div className="dashboard-open">Open →</div></Link>)}</div> : <div className="empty-state"><span>＋</span><h2>No games yet.</h2><p>Your first prompt can be playable in a few seconds.</p><Link className="button button-primary" href="/create">Create a game</Link></div>}
  </main>;
}
