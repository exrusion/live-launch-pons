import Link from "next/link";

export const metadata = { title: "How it works" };

export default function HowItWorksPage() {
  const steps = [
    ["01", "Create freely", "Build and save without an account. Sign a no-gas wallet message only when you are ready to launch."],
    ["02", "Generate safe configuration", "Your prompt selects and configures one of three controlled canvas engines. It never injects arbitrary executable code into the application."],
    ["03", "Play before launch", "The game runs in a credential-free sandbox. Test touch, keyboard, pause, restart, mute, and fullscreen before freezing the version."],
    ["04", "Read pons live", "The app reads the official V2 factory, active launch config, fee, wallet eligibility, and economics pin directly on Robinhood Chain."],
    ["05", "Approve in your wallet", "The platform prepares the official factory call. Your wallet shows the target, ETH value, gas, and chain. Nothing is approved automatically."],
    ["06", "Verify and publish", "After confirmation, the backend decodes TokenLaunched, checks the deployer and frozen metadata, consumes the credit, and publishes the permanent game page."],
  ];
  return <main className="shell page-shell story-page"><div className="page-heading centered"><div><span className="eyebrow">Prompt → game → token</span><h1>Playable first. On-chain second.</h1><p>The launch flow has one trust boundary at every step, with clear pending, failed, demo, and live states.</p></div></div><div className="process-list">{steps.map(([number,title,copy]) => <article key={number}><span>{number}</span><div><h2>{title}</h2><p>{copy}</p></div></article>)}</div><section className="trust-section"><div><span className="eyebrow">What the game cannot reach</span><h2>The iframe gets a canvas, not your wallet.</h2></div><div className="trust-grid"><p><b>No wallet provider</b><span>The sandbox has no same-origin access and no application cookies.</span></p><p><b>No network requests</b><span>Its CSP blocks connections, forms, popups, and top-level navigation.</span></p><p><b>Approved events only</b><span>It reports start, score, game over, and a bounded input log.</span></p><p><b>Immutable releases</b><span>Each version carries a deterministic configuration and manifest hash.</span></p></div></section><div className="final-cta inset"><div><h2>Build the game you want to launch.</h2><p>The first playable preview costs nothing.</p></div><Link className="button button-primary" href="/create">Open the studio →</Link></div></main>;
}
