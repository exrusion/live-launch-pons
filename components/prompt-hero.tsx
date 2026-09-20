"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const example = "A cyber mouse runs through a collapsing laboratory, collects neurons and avoids security drones.";

export function PromptHero() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  function go() { const value = prompt.trim() || example; router.push(`/create?prompt=${encodeURIComponent(value)}`); }
  return <div className="prompt-console">
    <div className="console-top"><span><i /> game prompt</span><small>3 controlled engines</small></div>
    <textarea aria-label="Describe your game" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={example} maxLength={900} />
    <div className="prompt-actions"><button className="example-link" onClick={() => setPrompt(example)}>Use example</button><button className="button button-primary" onClick={go}>Generate game <span>↗</span></button></div>
  </div>;
}
