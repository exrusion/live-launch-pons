"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const examples = [
  "A cyber mouse runs through a collapsing lab and dodges security drones.",
  "A tiny moon bird taps through broken satellites and gathers stardust.",
  "A neon rover survives waves of alien bugs in a crystal desert.",
];

export function PromptHero() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  function go() {
    const value = prompt.trim() || examples[0];
    router.push(`/create?prompt=${encodeURIComponent(value)}`);
  }

  return <div className="prompt-console">
    <div className="console-top"><span><i /> New game prompt</span><small>Playable in minutes</small></div>
    <textarea aria-label="Describe your game" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the hero, the world, and what the player must survive…" maxLength={900} />
    <div className="prompt-presets" aria-label="Example game prompts">
      {examples.map((example, index) => <button key={example} type="button" onClick={() => setPrompt(example)}>0{index + 1} {index === 0 ? "Lab runner" : index === 1 ? "Moon flappy" : "Alien shooter"}</button>)}
    </div>
    <div className="prompt-actions"><span>{prompt.length}/900</span><button className="button button-primary" onClick={go}>Generate game <span>↗</span></button></div>
  </div>;
}
