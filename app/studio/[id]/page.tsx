import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import { freeLaunchStatus } from "@/lib/data";
import { GameFrame } from "@/components/game-frame";
import { LaunchPanel } from "@/components/launch-panel";
import { StatusBadge } from "@/components/status-badge";
import { hasSponsorRebateConfig } from "@/lib/rebates";

export const dynamic = "force-dynamic";

export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth(); if (!session?.user?.id) redirect("/auth/signin");
  const { id } = await params;
  const result = await query(
    `SELECT g.*,v.id AS version_id,v.deterministic_id,v.version_number,v.config,v.config_hash,v.manifest_hash,
      (SELECT a.id FROM assets a WHERE a.game_id=g.id AND a.kind='TOKEN_IMAGE' ORDER BY a.created_at DESC LIMIT 1) AS image_id,
      p.id AS launch_id,p.status AS launch_status,p.transaction_hash,p.error_detail,p.free_credit_id,p.quote_expires_at::text AS quote_expires_at,p.rebate_status,
      p.rebate_tx_hash,p.rebate_error_code,p.rebate_error_detail,COALESCE(t.address,p.token_address) AS token_address,t.pons_url AS trading_url
     FROM games g JOIN game_versions v ON v.id=g.current_version_id
     LEFT JOIN LATERAL (SELECT * FROM pons_launches WHERE game_id=g.id ORDER BY created_at DESC,id DESC LIMIT 1) p ON true
     LEFT JOIN tokens t ON t.game_id=g.id WHERE g.id=$1 AND g.owner_user_id=$2 LIMIT 1`,
    [id, session.user.id],
  );
  const game = result.rows[0]; if (!game) notFound();
  const credit = await freeLaunchStatus(session.user.id);
  const sponsorReady = hasSponsorRebateConfig();
  return <main className="shell page-shell studio-page"><div className="studio-top"><div><Link className="back-link" href="/dashboard">← Dashboard</Link><div className="title-line"><h1>{game.name}</h1><span>${game.ticker}</span><StatusBadge status={game.launch_status || game.status} /></div><p>{game.description}</p></div>{game.token_address && <Link className="button button-primary" href={`/game/${game.token_address}`}>Open live game</Link>}</div>
    <div className="studio-grid"><div><GameFrame title={game.name} publicId={game.token_address || game.slug} versionId={game.version_id} /><div className="version-card"><div><span>Frozen game version</span><b>v{game.version_number} · {game.deterministic_id}</b></div><div><span>Configuration hash</span><code>{game.config_hash}</code></div><div><span>Manifest hash</span><code>{game.manifest_hash}</code></div></div></div><LaunchPanel key={game.id} gameId={game.id} creditStatus={credit?.status} sponsorReady={sponsorReady} initialLaunch={game.launch_id ? { id: game.launch_id, status: game.launch_status, transactionHash: game.transaction_hash, tokenAddress: game.token_address, errorDetail: game.error_detail, tradingUrl: game.trading_url || (game.token_address ? `https://www.ponsfamily.com/launchpad/${game.token_address}` : null), quoteExpiresAt: game.quote_expires_at, freeCreditRequested: Boolean(game.free_credit_id), rebateStatus: game.rebate_status, rebateTxHash: game.rebate_tx_hash, rebateErrorDetail: game.rebate_error_detail } : null} /></div>
    <section className="studio-details"><article><span>Template</span><h3>{game.category.toLowerCase()}</h3><p>{game.difficulty.toLowerCase()} difficulty · {game.visual_style}</p></article><article><span>On-chain state</span><h3>{game.token_address ? "Confirmed" : game.launch_status || "Not submitted"}</h3><p>{game.transaction_hash ? `${game.transaction_hash.slice(0,12)}…` : "No transaction has been approved."}</p></article><article><span>Failure policy</span><h3>Game stays safe</h3><p>If the pons step fails, the draft and unused credit remain available.</p></article></section>
    {game.error_detail && <div className="failure-card"><b>Last launch error</b><p>{game.error_detail}</p></div>}
    {game.rebate_status === "FAILED" && <div className="failure-card"><b>Launch confirmed · reimbursement needs attention</b><p>{game.rebate_error_detail || game.rebate_error_code || "The reimbursement did not complete. The failure is recorded for operator review."}</p>{game.rebate_tx_hash && <a className="tx-link" href={`https://robinhoodchain.blockscout.com/tx/${game.rebate_tx_hash}`} target="_blank" rel="noreferrer">View reimbursement transaction ↗</a>}</div>}
    {["PENDING","SENDING"].includes(game.rebate_status) && <div className="credit-warning"><b>Reimbursement pending</b><p>Your launch is confirmed. The exact pons launch fee reimbursement is recorded and will be processed by the worker.</p></div>}
  </main>;
}
