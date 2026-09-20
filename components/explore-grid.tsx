"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import type { ExploreGame } from "@/lib/data";

const filters = [
  { label: "All games", value: "ALL" },
  { label: "Runner", value: "RUNNER" },
  { label: "Flappy-style", value: "FLAPPY" },
  { label: "Shooter", value: "SHOOTER" },
] as const;

export function ExploreGrid({ games }: { games: ExploreGame[] }) {
  const [filter, setFilter] = useState<(typeof filters)[number]["value"]>("ALL");
  const visibleGames = useMemo(() => filter === "ALL" ? games : games.filter((game) => game.category === filter), [filter, games]);

  return <>
    <div className="filter-bar" aria-label="Filter games by engine">
      {filters.map((item) => <button key={item.value} className={filter === item.value ? "active" : ""} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}
      <small>{visibleGames.length} available</small>
    </div>
    {visibleGames.length ? <div className="games-grid">{visibleGames.map((game) => <Link className="game-card" key={game.id} href={`/game/${game.tokenAddress || game.slug}`}>
      <div className={`game-card-art art-${game.category.toLowerCase()}`}>
        <span className="game-token-image">{game.imageId ? <img src={`/api/assets/${game.imageId}`} alt="" /> : game.ticker.slice(0, 2)}</span>
        <StatusBadge status={game.status} />
        <div className="art-grid" /><i className="art-character" /><i className="art-target" />
      </div>
      <div className="game-card-body"><div><h2>{game.name}</h2><span>${game.ticker}</span></div><p>{game.description}</p><footer><span>{game.category.toLowerCase()}</span><span>{game.players} players</span><b>Play ↗</b></footer></div>
    </Link>)}</div> : <div className="empty-state"><span>◫</span><h2>No games in this lane yet.</h2><p>Try another engine or create the first one.</p></div>}
  </>;
}
