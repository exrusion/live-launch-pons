"use client";

import { useEffect, useState } from "react";

type Entry = { rank: number; score: string; username?: string; wallet_address?: string; submitted_at: string };

export function Leaderboard({ publicId }: { publicId: string }) {
  const [period, setPeriod] = useState("week");
  const [entries, setEntries] = useState<Entry[]>([]);
  useEffect(() => { fetch(`/api/game/${encodeURIComponent(publicId)}/leaderboard?period=${period}`).then((response) => response.json()).then((data) => setEntries(data.entries || [])).catch(() => setEntries([])); }, [publicId, period]);
  return <section className="leaderboard"><div className="leaderboard-head"><div><span className="eyebrow">Verified runs</span><h2>Leaderboard</h2></div><div className="period-tabs">{["day","week","all"].map((value) => <button key={value} className={period === value ? "active" : ""} onClick={() => setPeriod(value)}>{value === "day" ? "Daily" : value === "week" ? "Weekly" : "All-time"}</button>)}</div></div>
    {entries.length ? <div className="leaderboard-rows">{entries.map((entry) => <div key={`${entry.rank}-${entry.submitted_at}`}><b className="rank">{entry.rank}</b><span className="player-avatar">{entry.username?.slice(0,1).toUpperCase() || "◈"}</span><span className="player-name">{entry.username ? `@${entry.username}` : `${entry.wallet_address?.slice(0,6)}…${entry.wallet_address?.slice(-4)}`}</span><strong>{Number(entry.score).toLocaleString()}</strong><small>{new Date(entry.submitted_at).toLocaleDateString()}</small></div>)}</div> : <div className="leaderboard-empty"><span>01</span><p>No verified scores in this window. Finish a signed run to take the first spot.</p></div>}
  </section>;
}
