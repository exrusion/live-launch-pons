"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";

const STAGE_DURATION = 5600;

const stages = [
  { id: "idea", number: "01", label: "Idea", eyebrow: "Create freely", title: "Start with one game idea.", copy: "Connect a supported injected or WalletConnect wallet, then shape the token details and the game in one private draft." },
  { id: "generate", number: "02", label: "Generate", eyebrow: "AI-directed build", title: "Turn the prompt into a safe playable build.", copy: "AI directs a validated blueprint while Gamepad keeps the executable HTML5 runtime inside its controlled sandbox." },
  { id: "play", number: "03", label: "Play", eyebrow: "Test before launch", title: "Play it, refine it, and freeze the version.", copy: "Use keyboard, pointer, or touch controls. Edit the prompt and regenerate until the build feels right—nothing is on-chain yet." },
  { id: "launch", number: "04", label: "Launch", eyebrow: "Pons V2 · Robinhood Chain", title: "Review the real launch, then confirm in your wallet.", copy: "Gamepad reads the official Pons factory, prepares the launchToken call, and waits for your wallet. This walkthrough never sends a transaction." },
  { id: "vote", number: "05", label: "Vote", eyebrow: "Phase 2 · Coming Soon", title: "Let verified holders shape what ships next.", copy: "The planned governance layer covers characters, maps, gameplay upgrades, and tournament formats after holder snapshots are enabled." },
  { id: "compete", number: "06", label: "Compete", eyebrow: "Phase 3 · Coming Soon", title: "Turn every version into a competitive season.", copy: "Verified runs and leaderboards are live today. Tournament creation and prize pools remain disabled until the reward path is audited." },
  { id: "reward", number: "07", label: "Reward", eyebrow: "Phase 3 · Coming Soon", title: "Close the loop with a verified winner.", copy: "The intended reward flow funds a declared pool and pays the winner in the project token—only after vault and payout accounting are audited." },
] as const;

type StageId = (typeof stages)[number]["id"];
const generationSteps = ["Understanding the prompt", "Creating game mechanics", "Generating visuals", "Building levels", "Testing controls", "Preparing playable preview"];

function IdeaScene() {
  return <div className="gamed-idea-scene">
    <div className="gamed-wallet-row"><span className="is-selected"><i /> Injected wallet</span><span>WalletConnect</span><b>Connected</b></div>
    <div className="gamed-form-grid"><label><span>Game name</span><strong>Neon Dawn</strong></label><label><span>Token ticker</span><strong>$DAWN</strong></label></div>
    <label className="gamed-wide-field"><span>Description</span><strong>A rooftop runner racing the sunrise.</strong></label>
    <div className="gamed-prompt-box"><span>Game prompt</span><p>Build a neon rooftop runner where a tiny robot collects battery cells and dodges delivery drones.<i /></p></div>
    <div className="gamed-detail-row"><span><b>ND</b> Token image</span><span>𝕏 @runnerzero</span><span>↗ game.example</span></div>
  </div>;
}

function GenerateScene() {
  return <div className="gamed-generate-scene"><div className="gamed-ai-core"><span>G</span><i /><i /><i /></div><div className="gamed-generation-copy"><div className="gamed-generation-head"><div><small>AI build pipeline</small><strong>Generating Neon Dawn</strong></div><b>10–20 sec</b></div><div className="gamed-generation-list">{generationSteps.map((step, index) => <div key={step} style={{ "--step-delay": `${index * .48}s` } as CSSProperties}><i /><span>{step}</span><b>{index === generationSteps.length - 1 ? "Preview" : "Done"}</b></div>)}</div><div className="gamed-generation-progress"><i /><span>Validated blueprint · sandboxed runtime</span></div></div></div>;
}

function PlayScene() {
  return <div className="gamed-play-scene"><div className="gamed-mini-browser"><header><i /><i /><i /><span>gamepad.markets / preview</span><b>v1</b></header><div className="gamed-game-world"><div className="gamed-game-score">SCORE <b>02480</b></div><div className="gamed-game-sun" /><div className="gamed-game-city" /><div className="gamed-game-platform" /><div className="gamed-game-runner"><i /><b /></div><div className="gamed-game-drone"><i /><i /></div><div className="gamed-keyboard"><span>←</span><span className="is-pressed">SPACE</span><span>→</span></div></div></div><div className="gamed-version-editor"><span>Edit game prompt</span><p>Add a second drone after 30 seconds and make battery cells glow brighter.<i /></p><div><b>v1 frozen</b><i>→</i><strong>Generate v2</strong></div><small>Creator-published AI versions · Phase 2 coming soon</small></div></div>;
}

function LaunchScene() {
  return <div className="gamed-launch-scene"><div className="gamed-launch-summary"><div className="gamed-token-orb">ND</div><div><small>Official launch route</small><strong>Neon Dawn <span>$DAWN</span></strong><p>Frozen game build v1</p></div><b>Ready</b></div><div className="gamed-launch-facts"><div><span>Launchpad</span><b>Pons V2</b></div><div><span>Network</span><b>Robinhood Chain</b></div><div><span>Pair</span><b>Native ETH</b></div><div><span>Status</span><b>Awaiting signature</b></div></div><div className="gamed-launch-transition"><div className="gamed-wallet-modal"><header><span>Wallet confirmation</span><b>Walkthrough Example</b></header><div><span>Contract</span><strong>Pons V2 Factory</strong></div><div><span>Action</span><strong>launchToken</strong></div><div><span>Approval</span><strong>Not submitted</strong></div><footer><button type="button" tabIndex={-1}>Cancel</button><button type="button" tabIndex={-1}>Review in wallet</button></footer></div><div className="gamed-project-page"><header><div className="gamed-project-cover">ND</div><div><small>Published project</small><strong>Neon Dawn <span>$DAWN</span></strong><p>by @runnerzero · Version 1</p></div><button type="button" tabIndex={-1}>▶ Play</button></header><div className="gamed-project-stats"><span><small>Players</small><b>1,284</b></span><span><small>Market</small><b>Pons curve</b></span><span><small>Contract</small><b>View address ↗</b></span><span><small>Launch</small><b>View transaction ↗</b></span></div><footer>Walkthrough Example · Addresses and transactions are intentionally omitted</footer></div></div></div>;
}

function VoteScene() {
  const votes = [["New character", 42], ["New map", 31], ["Gameplay upgrade", 18], ["Next tournament format", 9]] as const;
  return <div className="gamed-vote-scene"><header><div><small>Holder proposal #12</small><strong>What should ship in v2?</strong></div><span>Coming Soon</span></header><div className="gamed-vote-list">{votes.map(([label, value], index) => <div key={label} style={{ "--vote-delay": `${index * .18}s`, "--vote-width": `${value}%` } as CSSProperties}><span><b>{label}</b><strong>{value}%</strong></span><i /></div>)}</div><footer><span>Snapshot source</span><b>Verified token holders</b><small>Voting is not active yet</small></footer></div>;
}

function CompeteScene() {
  return <div className="gamed-compete-scene"><div className="gamed-bracket"><header><span>Neon Dawn Open</span><b>Coming Soon</b></header><div className="gamed-bracket-grid"><div><span>0x8A…11F <b>8,240</b></span><span>0x41…90C <b>6,180</b></span></div><i /><div><span className="winner">0x8A…11F <b>Final</b></span></div><i /><div><span className="pending">Winner</span></div></div></div><div className="gamed-live-board"><header><span>Live leaderboard</span><b>Verified runs</b></header>{[["01", "0x8A…11F", "8,240"], ["02", "0xB7…92E", "7,980"], ["03", "0x41…90C", "6,180"]].map((row) => <div key={row[0]}><span>{row[0]}</span><b>{row[1]}</b><strong>{row[2]}</strong></div>)}</div></div>;
}

function RewardScene() {
  return <div className="gamed-reward-scene"><div className="gamed-confetti">{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ "--confetti-x": `${(index * 37) % 100}%`, "--confetti-delay": `${(index % 7) * .12}s` } as CSSProperties} />)}</div><div className="gamed-trophy">★</div><span className="gamed-coming-pill">Phase 3 · Coming Soon</span><h3>0x8A…11F wins the season</h3><p>Verified first place · Neon Dawn Open</p><div className="gamed-pool-counter"><span>Prize pool</span><strong>12,480 <b>$DAWN</b></strong><small>Walkthrough Example · No funds moved</small></div><div className="gamed-reward-flow"><span>Configured fee flow</span><i>→</i><span>Audited reward vault</span><i>→</i><b>Winner payout</b></div></div>;
}

function StageVisual({ id }: { id: StageId }) {
  if (id === "idea") return <IdeaScene />;
  if (id === "generate") return <GenerateScene />;
  if (id === "play") return <PlayScene />;
  if (id === "launch") return <LaunchScene />;
  if (id === "vote") return <VoteScene />;
  if (id === "compete") return <CompeteScene />;
  return <RewardScene />;
}

const floatCards = [["Game Prompt", "One idea becomes a validated game direction."], ["AI Generation", "Blueprint first. Trusted runtime second."], ["Playable Build", "Keyboard, pointer, and touch controls."], ["Token Launch", "Official Pons V2 factory on Robinhood Chain."], ["Holder Vote", "Verified snapshots · Coming Soon"], ["Tournament", "Audited competition flow · Coming Soon"], ["Prize Pool", "Declared and funded rewards · Coming Soon"], ["Permanent Version", "Every published build stays immutable."]] as const;

export function GamepadWalkthroughCinema({ embedded = false }: { embedded?: boolean }) {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(!embedded);
  const [tabActive, setTabActive] = useState(true);
  const rootRef = useRef<HTMLElement>(null);
  const stage = stages[active];

  useEffect(() => { if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(false); }, []);
  useEffect(() => { const onVisibility = () => setTabActive(document.visibilityState === "visible"); document.addEventListener("visibilitychange", onVisibility); return () => document.removeEventListener("visibilitychange", onVisibility); }, []);
  useEffect(() => { if (!embedded || !rootRef.current) { setVisible(true); return; } const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting && entry.intersectionRatio > .2), { threshold: [.2, .5] }); observer.observe(rootRef.current); return () => observer.disconnect(); }, [embedded]);
  useEffect(() => { if (!playing || !visible || !tabActive) return; const timer = window.setTimeout(() => setActive((current) => (current + 1) % stages.length), STAGE_DURATION); return () => window.clearTimeout(timer); }, [active, playing, visible, tabActive]);

  const restart = () => { setActive(0); setPlaying(true); };
  const livePlaying = playing && visible && tabActive;

  return <section ref={rootRef} className={`gamed-walkthrough-cinema ${embedded ? "is-embedded" : ""} ${livePlaying ? "is-playing" : "is-paused"}`} aria-label="Gamed Markets product walkthrough">
    <div className="gamed-cinema-chrome"><span><i /><i /><i /></span><b>gamepad.markets / studio</b><small><i /> Interactive demo</small></div>
    <div className="gamed-cinema-stage"><div className="gamed-stage-copy" key={`copy-${stage.id}`}><div><span>{stage.eyebrow}</span><b>{stage.number} / 07</b></div><h2>{stage.title}</h2><p>{stage.copy}</p><footer><span>{livePlaying ? "Now playing" : "Paused"}</span><b>{stage.label}</b></footer></div><div className="gamed-stage-visual" key={`visual-${stage.id}`}><StageVisual id={stage.id} /></div></div>
    <div className="gamed-cinema-controls"><button className="gamed-play-control" type="button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause walkthrough" : "Play walkthrough"}>{playing ? "Ⅱ" : "▶"}</button><div className="gamed-stage-timeline" aria-label="Walkthrough stages">{stages.map((item, index) => <button key={item.id} className={index === active ? "is-active" : index < active ? "is-complete" : ""} type="button" aria-pressed={index === active} onClick={() => setActive(index)}><span><b>{item.number}</b>{item.label}</span><i /></button>)}</div><button className="gamed-restart-control" type="button" onClick={restart}><span>↻</span><b>Restart</b></button></div>
  </section>;
}

export function GamepadWalkthrough() {
  return <main className="gamed-walkthrough-page"><section className="gamed-walkthrough-hero shell" id="walkthrough-overview"><div><span><i /> Interactive product tour</span><h1>Build the game.<br /><b>Launch the market.</b></h1></div><p>Follow the complete production flow—from private prompt and playable preview to a verified Pons launch, then see what the community roadmap unlocks next.</p></section><section className="gamed-walkthrough-world" id="walkthrough-demo"><div className="gamed-float-column gamed-float-left">{floatCards.slice(0,4).map(([title, copy], index) => <article key={title} style={{ "--float-delay": `${index * -1.4}s` } as CSSProperties}><span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p></article>)}</div><GamepadWalkthroughCinema /><div className="gamed-float-column gamed-float-right">{floatCards.slice(4).map(([title, copy], index) => <article key={title} style={{ "--float-delay": `${index * -1.7}s` } as CSSProperties}><span>0{index + 5}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section><section className="gamed-walkthrough-roadmap shell" id="walkthrough-roadmap"><div><span>Live now</span><b>AI-directed builds · Sandboxed games · Pons V2 launches · Verified leaderboards</b></div><div><span>Coming soon</span><b>Holder voting · Creator-published versions · Tournaments · Prize pools</b></div></section><section className="gamed-walkthrough-final shell"><span>Build what people want to play.</span><h2>Launch a coin. Generate its game.<br />Let holders build what comes next.</h2><div><Link className="button button-primary" href="/create">Launch Your Game <span>↗</span></Link><Link className="button button-quiet" href="/explore">Explore Games</Link></div></section></main>;
}
