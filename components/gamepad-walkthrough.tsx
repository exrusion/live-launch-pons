"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const SCENE_DURATION = 4400;

const scenes = [
  {
    id: "prompt",
    number: "01",
    label: "Prompt",
    eyebrow: "Start with an idea",
    title: "Describe the game you want to play.",
    copy: "Set the world, the character, and the challenge. Gamepad turns a plain-language prompt into a real first build.",
  },
  {
    id: "build",
    number: "02",
    label: "Build",
    eyebrow: "Generation in motion",
    title: "Watch the first version take shape.",
    copy: "The game loop, art direction, controls, and scoring system are assembled into a playable preview.",
  },
  {
    id: "play",
    number: "03",
    label: "Playtest",
    eyebrow: "Play before launch",
    title: "Test the feel, then keep iterating.",
    copy: "Run the real game in your browser, check the controls, and refine the prompt before anything goes onchain.",
  },
  {
    id: "launch",
    number: "04",
    label: "Launch",
    eyebrow: "Powered by Pons",
    title: "Turn the finished build into a market.",
    copy: "Review the token details, connect your wallet, and sign the official launch through Pons on Robinhood Chain.",
  },
  {
    id: "market",
    number: "05",
    label: "Go live",
    eyebrow: "The game is live",
    title: "Players arrive. The world keeps growing.",
    copy: "Every game gets a public home for play, market activity, verified runs, and future versions from its creator.",
  },
] as const;

type SceneId = (typeof scenes)[number]["id"];

function SceneVisual({ id }: { id: SceneId }) {
  if (id === "prompt") {
    return (
      <div className="walkthrough-prompt-scene" aria-hidden="true">
        <div className="walkthrough-prompt-head">
          <span><i /> New game</span>
          <small>AI creator</small>
        </div>
        <p>
          Build a neon rooftop runner where a tiny robot races the sunrise,
          collects battery cells, and dodges delivery drones.<span className="walkthrough-cursor" />
        </p>
        <div className="walkthrough-prompt-tags">
          <span>Runner</span><span>Neon city</span><span>Keyboard</span>
        </div>
        <div className="walkthrough-generate-button">
          <span>Generate first build</span><b>↗</b>
        </div>
      </div>
    );
  }

  if (id === "build") {
    return (
      <div className="walkthrough-build-scene" aria-hidden="true">
        <div className="walkthrough-build-orbit">
          <i /><i /><i />
          <span>G</span>
        </div>
        <div className="walkthrough-build-list">
          <div className="is-complete"><span>World + art direction</span><b>Done</b></div>
          <div className="is-complete"><span>Movement + controls</span><b>Done</b></div>
          <div className="is-active"><span>Scoring + game loop</span><b>Building</b></div>
          <div><span>Playable preview</span><b>Next</b></div>
        </div>
        <div className="walkthrough-build-time"><b>00:38</b><span>First build is almost ready</span></div>
      </div>
    );
  }

  if (id === "play") {
    return (
      <div className="walkthrough-game-scene" aria-hidden="true">
        <div className="walkthrough-game-hud">
          <span>SCORE <b>02480</b></span>
          <strong>NEON DAWN</strong>
          <span>BEST <b>06120</b></span>
        </div>
        <div className="walkthrough-game-sun" />
        <div className="walkthrough-city city-back" />
        <div className="walkthrough-city city-front" />
        <div className="walkthrough-game-platform platform-one" />
        <div className="walkthrough-game-platform platform-two" />
        <div className="walkthrough-game-platform platform-three" />
        <div className="walkthrough-game-runner"><i /><b /></div>
        <div className="walkthrough-game-drone"><i /><i /></div>
        <div className="walkthrough-game-coin coin-one" />
        <div className="walkthrough-game-coin coin-two" />
        <div className="walkthrough-game-tip"><span>SPACE</span> jump</div>
      </div>
    );
  }

  if (id === "launch") {
    return (
      <div className="walkthrough-launch-scene" aria-hidden="true">
        <div className="walkthrough-launch-head">
          <div className="walkthrough-token-mark">ND</div>
          <div><small>Token launch</small><strong>Neon Dawn</strong><span>$DAWN</span></div>
          <b>Ready</b>
        </div>
        <div className="walkthrough-launch-grid">
          <div><span>Network</span><b>Robinhood Chain</b></div>
          <div><span>Launch route</span><b>Pons</b></div>
          <div><span>Game build</span><b>v1 verified</b></div>
          <div><span>Creator</span><b>0x19…7D2A</b></div>
        </div>
        <div className="walkthrough-sign-row">
          <span><i /> Wallet connected</span>
          <button type="button" tabIndex={-1}>Sign &amp; launch <b>↗</b></button>
        </div>
        <p>One signature publishes the game and starts its official Pons market.</p>
      </div>
    );
  }

  return (
    <div className="walkthrough-market-scene" aria-hidden="true">
      <div className="walkthrough-market-head">
        <div className="walkthrough-token-mark">ND</div>
        <div><strong>Neon Dawn <span>$DAWN</span></strong><small>Created by @runnerzero</small></div>
        <b><i /> Live</b>
      </div>
      <div className="walkthrough-market-price">
        <div><small>Market price</small><strong>$0.00482</strong><span>+18.4%</span></div>
        <div className="walkthrough-market-chart">
          <svg viewBox="0 0 320 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id="market-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#d4fc50" stopOpacity=".36" />
                <stop offset="1" stopColor="#d4fc50" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path className="market-area" d="M0,91 C25,84 28,76 50,78 C75,80 79,61 102,65 C130,70 135,43 158,48 C180,52 190,37 210,42 C236,47 244,19 270,27 C288,32 296,14 320,8 L320,100 L0,100 Z" />
            <path className="market-line" d="M0,91 C25,84 28,76 50,78 C75,80 79,61 102,65 C130,70 135,43 158,48 C180,52 190,37 210,42 C236,47 244,19 270,27 C288,32 296,14 320,8" />
          </svg>
        </div>
      </div>
      <div className="walkthrough-market-stats">
        <div><span>Market cap</span><b>$482K</b></div>
        <div><span>Verified runs</span><b>1,284</b></div>
        <div><span>Top score</span><b>96,410</b></div>
      </div>
      <div className="walkthrough-market-activity"><i /><span>New run from 0xB7…92E</span><b>+8,240 pts</b></div>
    </div>
  );
}

export function GamepadWalkthrough() {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const scene = scenes[active];

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      setActive((current) => (current + 1) % scenes.length);
    }, SCENE_DURATION);
    return () => window.clearTimeout(timer);
  }, [active, playing]);

  function restart() {
    setActive(0);
    setPlaying(true);
  }

  return (
    <main className="walkthrough-page">
      <section className="walkthrough-hero shell">
        <div>
          <span className="walkthrough-kicker"><i /> Interactive walkthrough</span>
          <h1>From a prompt to a <span>live game market.</span></h1>
        </div>
        <p>See the entire Gamepad flow in under a minute. It plays automatically, or use the timeline to jump anywhere.</p>
      </section>

      <section className={`walkthrough-cinema shell ${playing ? "is-playing" : "is-paused"}`} aria-label="Gamepad product walkthrough">
        <div className="walkthrough-chrome">
          <span className="walkthrough-chrome-dots" aria-hidden="true"><i /><i /><i /></span>
          <span className="walkthrough-address">gamepad.markets / create</span>
          <span className="walkthrough-demo-state"><i /> Live demo</span>
        </div>

        <div className="walkthrough-stage">
          <div className="walkthrough-copy-panel" key={`copy-${scene.id}`}>
            <div className="walkthrough-scene-meta">
              <span>{scene.eyebrow}</span><b>{scene.number} / 05</b>
            </div>
            <h2>{scene.title}</h2>
            <p>{scene.copy}</p>
            <div className="walkthrough-now-playing">
              <span>{playing ? "Now playing" : "Paused"}</span>
              <b>{scene.label}</b>
            </div>
          </div>

          <div className="walkthrough-demo-panel" key={`visual-${scene.id}`}>
            <SceneVisual id={scene.id} />
          </div>
        </div>

        <div className="walkthrough-controls">
          <button className="walkthrough-control-button" type="button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause walkthrough" : "Play walkthrough"}>
            <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
          </button>

          <div className="walkthrough-timeline" aria-label="Walkthrough scenes">
            {scenes.map((item, index) => (
              <button
                className={index === active ? "is-active" : index < active ? "is-complete" : ""}
                key={item.id}
                type="button"
                aria-pressed={index === active}
                aria-label={`Scene ${item.number}: ${item.label}`}
                onClick={() => setActive(index)}
              >
                <span><b>{item.number}</b>{item.label}</span>
                <i />
              </button>
            ))}
          </div>

          <button className="walkthrough-restart" type="button" onClick={restart} aria-label="Restart walkthrough">
            <span aria-hidden="true">↻</span><b>Restart</b>
          </button>
        </div>
      </section>

      <section className="walkthrough-end shell">
        <div><span>Ready when you are</span><h2>Build the game people cannot stop playing.</h2></div>
        <div><Link className="button button-primary" href="/create">Build a game <span>↗</span></Link><Link className="walkthrough-explore-link" href="/explore">Explore live games</Link></div>
      </section>
    </main>
  );
}
