import Link from "next/link";
import { PromptHero } from "@/components/prompt-hero";
import { GameFrame } from "@/components/game-frame";
import { exploreGames } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const games = await exploreGames();
  const featured = games[0];

  return <main>
    <section className="hero shell">
      <div className="hero-copy">
        <div className="eyebrow"><span className="live-dot" /> Built to launch through pons</div>
        <h1>Make the game.<br /><span>Launch the token.</span></h1>
        <p>Turn one idea into a phone-ready arcade game, freeze the playable build, and launch its token on Robinhood Chain.</p>
        <div className="hero-actions">
          <Link className="button button-primary" href="/create">Build a game <span>↗</span></Link>
          <Link className="button button-quiet" href="/explore">Enter the arcade</Link>
        </div>
        <div className="signup-note"><span>Phase 1 launch credit</span><p>Sign in with X and verify your creator wallet to check eligibility.</p></div>
      </div>
      <div className="hero-console">
        <PromptHero />
        <div className="console-foot"><span>Runner</span><i /><span>Flappy</span><i /><span>Shooter</span></div>
      </div>
    </section>

    <section className="flow-strip"><div className="shell flow-row">
      {["Prompt", "Game", "Token", "Play", "Compete"].map((item, index) => <div key={item}><span>{String(index + 1).padStart(2, "0")}</span><b>{item}</b>{index < 4 && <em>→</em>}</div>)}
    </div></section>

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
        <article className="feature-card"><span className="feature-number">03 · COMPETE</span><div className="score-mini"><b>12,480</b><span>verified score</span><i style={{ width: "82%" }} /><i style={{ width: "64%" }} /><i style={{ width: "46%" }} /></div><h3>Climb the board</h3><p>Server-backed runs keep the leaderboard competitive while every version remains playable.</p></article>
      </div>
    </section>

    <section className="final-cta shell"><div><span className="eyebrow">Your turn</span><h2>What will your token play like?</h2></div><Link className="button button-primary" href="/create">Create the first version →</Link></section>
  </main>;
}
