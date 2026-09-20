import Link from "next/link";
import Image from "next/image";
import { PromptHero } from "@/components/prompt-hero";
import { GameFrame } from "@/components/game-frame";
import { exploreGames, platformPulse } from "@/lib/data";

export const dynamic = "force-dynamic";

const GAMEPAD_PIXELS = [
  "........BBBBBBBB........",
  "......BBBBBBBBBBBB......",
  "....BBBBBBBBBBBBBBBB....",
  "..BBBBBBBBBBBBBBBBBBBB..",
  ".BBBBBBBBBBBBBBBBBBBBBB.",
  "BBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBWWBBBBBBBBBBWWBBBBB",
  "BBBBWWWWBBBBBBBBWWWWBBBB",
  "BBBBBWWBBBBCCBBBBWWBBBBB",
  "BBBBBBBBBBBCCBBBBBBBBBBB",
  ".BBBBBBBBBBBBBBBBBBBBBB.",
  "..BBBBBBBBBBBBBBBBBBBB..",
  "....BBBB........BBBB....",
  ".....BB............BB...",
];

const numberFormat = new Intl.NumberFormat("en-US");

function PixelGamepad() {
  return <div className="pixel-gamepad" aria-hidden="true">
    {GAMEPAD_PIXELS.flatMap((row, rowIndex) => row.split("").map((pixel, columnIndex) =>
      <i key={`${rowIndex}-${columnIndex}`} className={pixel === "." ? "pixel-off" : `pixel-${pixel.toLowerCase()}`} />,
    ))}
  </div>;
}

export default async function HomePage() {
  const [games, pulse] = await Promise.all([exploreGames(), platformPulse()]);
  const featured = games[0];

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
          <div className="signup-note"><span>Wallet-owned publishing</span><p>Every version stays playable.</p></div>
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

    <section className="market-pulse-section shell" aria-labelledby="market-pulse-title">
      <div className="market-pulse-copy">
        <span className="eyebrow"><span className="live-dot" /> Gamepad activity · last 24 hours</span>
        <h2 id="market-pulse-title">On Gamepad today: <strong>{numberFormat.format(pulse.newGames)}</strong> new games, <strong>{numberFormat.format(pulse.playableBuilds)}</strong> playable builds and <strong>{numberFormat.format(pulse.verifiedRuns)}</strong> verified runs.</h2>
        <p>Live launchpad activity from the Gamepad database—not an estimate.</p>
      </div>
      <div className="market-pulse-visual">
        <span className="pulse-glow pulse-glow-one" aria-hidden="true" />
        <span className="pulse-glow pulse-glow-two" aria-hidden="true" />
        <PixelGamepad />
        <div className="market-pulse-caption"><span><i /> Live</span><b>Games become markets.</b><small>Powered by pons · Robinhood Chain</small></div>
      </div>
    </section>

    {featured && <section className="featured-section"><div className="shell featured-grid">
      <div className="featured-copy">
        <span className="eyebrow">Playable now · {featured.status.toLowerCase()}</span>
        <h2>{featured.name}</h2>
        <p>{featured.description}</p>
        <dl>
          <div><dt>Engine</dt><dd>{featured.category.toLowerCase()}</dd></div>
          <div><dt>Token</dt><dd>{featured.tokenAddress ? `$${featured.ticker}` : "Not launched"}</dd></div>
          <div><dt>Build</dt><dd>Immutable v1</dd></div>
        </dl>
        <Link className="button button-quiet" href={`/game/${featured.tokenAddress || featured.slug}`}>Open full game page</Link>
      </div>
      <GameFrame title={featured.name} publicId={featured.tokenAddress || featured.slug} versionId={featured.versionId || "demo"} />
    </div></section>}

    <section className="product-section shell">
      <div className="section-intro">
        <div><span className="eyebrow">From prompt to arcade</span><h2>Play first. Launch when it feels right.</h2></div>
        <p>Every token begins as a game you can test on desktop and phone. Launch details stay locked until the build is ready.</p>
      </div>
      <div className="feature-grid">
        <article className="feature-card accent-card"><span className="feature-number">01 · BUILD</span><div className="mini-stage"><i className="runner" /><i className="obstacle" /><i className="coin" /></div><h3>Shape the game</h3><p>Choose a runner, flappy-style challenge, or top-down shooter and tune it with one prompt.</p></article>
        <article className="feature-card"><span className="feature-number">02 · LAUNCH</span><div className="token-orbit"><span>$</span><i /><i /><i /></div><h3>Launch through pons</h3><p>Your wallet signs the official V2 factory call only after the playable version is frozen.</p></article>
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
