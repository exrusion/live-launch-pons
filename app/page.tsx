import Link from "next/link";
import Image from "next/image";
import { PromptHero } from "@/components/prompt-hero";
import { GamepadWalkthroughCinema } from "@/components/gamepad-walkthrough";
import { exploreGames } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const games = await exploreGames();
  const newLaunches = games.filter((game) => game.status === "LIVE").slice(0, 6);

  return <main className="home-page">
    <section className="hero-sky">
      <Image className="hero-character hero-character-left" src="/hero-robot-v2.png" alt="" width={696} height={544} priority aria-hidden="true" />
      <Image className="hero-character hero-character-right" src="/hero-mouse-v2.png" alt="" width={556} height={535} priority aria-hidden="true" />
      <div className="hero shell">
        <div className="hero-copy">
          <div className="hero-pill"><span className="live-dot" /> AI game studio on pons</div>
          <h1>Make the game.<br /><span>Launch it on pons.</span></h1>
          <p>Describe the world. Play the first build. Launch the token only when the game feels right.</p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/create">Build a game <span>↗</span></Link>
            <Link className="button button-quiet" href="/explore">Explore games</Link>
          </div>
        </div>
        <div className="hero-console">
          <PromptHero />
          <div className="console-foot"><span>Runner</span><i /><span>Flappy</span><i /><span>Shooter</span></div>
        </div>
      </div>
    </section>

    <section className="flow-strip"><div className="shell flow-row">
      {["Prompt", "Game", "Token", "Play", "Complete"].map((item, index) => <div key={item}><span>{String(index + 1).padStart(2, "0")}</span><b>{item}</b>{index < 4 && <em>→</em>}</div>)}
    </div></section>

    <section className="home-walkthrough-section shell" aria-labelledby="home-walkthrough-title">
      <div className="home-walkthrough-heading">
        <div>
          <span className="eyebrow"><span className="live-dot" /> Product walkthrough</span>
          <h2 id="home-walkthrough-title">See a prompt become a playable market.</h2>
        </div>
        <p>Watch the complete Gamepad flow—from the first idea to a live game and token—in under twenty seconds.</p>
      </div>
      <div className="home-walkthrough-player">
        <GamepadWalkthroughCinema embedded />
      </div>
      <div className="home-walkthrough-footer">
        <span><i /> Live loop · 5 steps</span>
        <Link href="/walkthrough">Open the interactive walkthrough <b>↗</b></Link>
      </div>
    </section>

    <section className="new-launches-section shell" aria-labelledby="new-launches-title">
      <div className="new-launches-heading">
        <div><span className="eyebrow"><span className="live-dot" /> Fresh on Gamepad</span><h2 id="new-launches-title">New launches</h2></div>
        <Link href="/explore">View all launches <span>↗</span></Link>
      </div>
      {newLaunches.length ? <div className="new-launches-grid">
        {newLaunches.map((game, index) => <Link className="new-launch-card" key={game.id} href={`/game/${game.tokenAddress || game.slug}`}>
          <div className={`new-launch-art art-${game.category.toLowerCase()}`}>
            {game.imageId ? <Image src={`/api/assets/${game.imageId}`} alt="" fill sizes="(max-width: 740px) 100vw, (max-width: 1100px) 50vw, 33vw" /> : <span>{game.ticker.slice(0, 2)}</span>}
            <small>0{index + 1}</small>
            <b><i /> Live</b>
          </div>
          <div className="new-launch-body">
            <div><h3>{game.name}</h3><strong>${game.ticker}</strong></div>
            <p>{game.description}</p>
            <footer><span>{game.category.toLowerCase()}</span><span>{game.players} players</span><b>Play ↗</b></footer>
          </div>
        </Link>)}
      </div> : <div className="new-launches-empty"><span>New launches will appear here automatically.</span><Link href="/create">Launch the first game ↗</Link></div>}
    </section>

    <section className="product-section shell">
      <div className="section-intro">
        <div><span className="eyebrow">From prompt to arcade</span><h2>Play first. Launch when it feels right.</h2></div>
        <p>Every token begins as a game you can test on desktop and phone. Launch details stay locked until the build is ready.</p>
      </div>
      <div className="feature-grid">
        <article className="feature-card accent-card"><span className="feature-number">01 · BUILD</span><div className="mini-stage"><i className="runner" /><i className="obstacle" /><i className="coin" /></div><h3>Shape the game</h3><p>Choose a runner, flappy-style challenge, or top-down shooter and tune it with one prompt.</p></article>
        <span className="feature-arrow" aria-hidden="true">→</span>
        <article className="feature-card"><span className="feature-number">02 · LAUNCH</span><div className="token-orbit"><span>$</span><i /><i /><i /></div><h3>Launch through pons</h3><p>Your wallet signs the official V2 factory call only after the playable version is frozen.</p></article>
        <span className="feature-arrow" aria-hidden="true">→</span>
        <article className="feature-card"><span className="feature-number">03 · COMPETE</span><div className="score-mini"><b>12,480</b><span>replay-checked score</span><i style={{ width: "82%" }} /><i style={{ width: "64%" }} /><i style={{ width: "46%" }} /></div><h3>Climb the board</h3><p>Server-backed runs keep the leaderboard competitive while every version remains playable.</p></article>
      </div>
    </section>

    <section className="community-section shell">
      <div className="section-intro">
        <div><span className="eyebrow">Community-owned games</span><h2>The game can keep evolving after launch.</h2></div>
        <p>These are the next release surfaces. They will only activate after verified holder snapshots and safe version publishing are enabled.</p>
      </div>
      <div className="community-grid">
        <article><span>01 · HOLDER GOVERNANCE</span><h3>Vote on what ships next.</h3><p>Token holders will propose and vote on characters, maps, difficulty changes, and upgrades using verified on-chain snapshots.</p><div className="roadmap-tags"><b>Characters</b><b>Maps</b><b>Upgrades</b></div><small>Phase 2 · not active yet</small></article>
        <article><span>02 · AI VERSIONING</span><h3>Publish a new playable version.</h3><p>Creators will describe an update, generate it with AI, test it, and publish it while every previous frozen version remains replayable.</p><div className="version-flow"><b>v1</b><i>→</i><b>AI draft</b><i>→</i><b>v2</b></div><small>Phase 2 · not active yet</small></article>
      </div>
    </section>

    <section className="final-cta shell"><div><span className="eyebrow">Your turn</span><h2>What will your token play like?</h2></div><Link className="button button-primary" href="/create">Create the first version →</Link></section>
  </main>;
}
