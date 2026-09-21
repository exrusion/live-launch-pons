import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Walkthrough | gamepad.markets",
  description: "See how a prompt becomes a playable game and a live Pons market.",
};

const steps = [
  ["01", "Describe the world", "Start with the hero, the setting, and the challenge. Choose a ready-made prompt or write your own."],
  ["02", "Generate the first build", "AI turns your direction into a playable runner, flappy game, or top-down shooter in minutes."],
  ["03", "Play before launch", "Test the real game loop, tune the feel, and keep iterating without putting a token onchain."],
  ["04", "Launch on Pons", "When the build feels right, connect your wallet and sign the official launch from your account."],
  ["05", "Compete and evolve", "Players submit verified runs while future versions can add new maps, characters, and challenges."],
] as const;

export default function WalkthroughPage() {
  return (
    <main className="walkthrough-page">
      <section className="walkthrough-hero shell">
        <span className="eyebrow">Gamepad walkthrough</span>
        <h1>From one prompt to a <span>live game market.</span></h1>
        <p>Five clear stages. You stay in control from the first idea to the first verified score.</p>
      </section>

      <section className="walkthrough-flow" aria-label="How Gamepad works">
        {steps.map(([number, title, copy]) => (
          <article className="walkthrough-step" key={number}>
            <span className="walkthrough-number">{number}</span>
            <h2>{title}</h2>
            <p>{copy}</p>
            <div className="walkthrough-visual" aria-hidden="true" />
          </article>
        ))}

        <div className="walkthrough-cta">
          <h2>Ready to make the first build?</h2>
          <Link className="button button-primary" href="/create">Build a game ↗</Link>
          <Link className="button button-quiet" href="/explore">Explore games</Link>
        </div>
      </section>
    </main>
  );
}
