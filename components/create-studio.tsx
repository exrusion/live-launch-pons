"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { useSession, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { buildGameDocument } from "@/lib/game-runtime";
import type { CreateGameInput, GameConfig } from "@/lib/types";
import { GameFrame } from "@/components/game-frame";

const categories = [
  { value: "RUNNER", title: "Endless runner", copy: "Jump, dodge, and collect." },
  { value: "FLAPPY", title: "Flappy-style", copy: "Tap through shifting gates." },
  { value: "SHOOTER", title: "Top-down shooter", copy: "Move, aim, and survive." },
] as const;

export function CreateStudio({ initialPrompt = "" }: { initialPrompt?: string }) {
  const router = useRouter();
  const { status } = useSession();
  const [input, setInput] = useState<CreateGameInput>({ name: "", ticker: "", description: "", prompt: initialPrompt, category: "RUNNER", visualStyle: "Neon arcade", difficulty: "NORMAL", developerBuyEth: "0", xUrl: "", websiteUrl: "" });
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [step, setStep] = useState(1);
  const previewHtml = useMemo(() => config ? buildGameDocument(config, { versionId: "preview" }) : "", [config]);

  function update<K extends keyof CreateGameInput>(key: K, value: CreateGameInput[K]) { setInput((current) => ({ ...current, [key]: value })); }
  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (![/image\/png/, /image\/jpeg/, /image\/webp/].some((pattern) => pattern.test(file.type)) || file.size > 2 * 1024 * 1024) { setError("Use a PNG, JPEG, or WebP image under 2 MB."); return; }
    const reader = new FileReader(); reader.onload = () => setImageDataUrl(String(reader.result)); reader.readAsDataURL(file);
  }
  async function generate() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/generate/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Generation failed");
      setConfig(body.config); setStep(3); setNotice("Playable preview ready. Test it before saving.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Generation failed"); }
    finally { setBusy(false); }
  }
  async function saveDraft() {
    if (status !== "authenticated") { await signIn("twitter", { callbackUrl: "/create" }); return; }
    if (!config) return;
    if (!imageDataUrl) { setError("Add a token image before saving the launch draft."); setStep(1); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/games", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input, imageDataUrl }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save draft");
      router.push(`/studio/${body.gameId}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save draft"); }
    finally { setBusy(false); }
  }

  return <div className="creator-layout">
    <aside className="creator-steps">
      <div className="eyebrow">New game</div><h1>Build the first playable version.</h1>
      {[{ n: 1, t: "Token details" }, { n: 2, t: "Game direction" }, { n: 3, t: "Preview & save" }].map((item) => <button key={item.n} className={step === item.n ? "step active" : step > item.n ? "step complete" : "step"} onClick={() => setStep(item.n)}><span>{step > item.n ? "✓" : item.n}</span>{item.t}</button>)}
      <div className="security-note"><span>Isolated build</span><p>Your prompt becomes validated configuration, never unrestricted code.</p></div>
    </aside>
    <main className="creator-workspace">
      {step === 1 && <section className="form-section"><div className="section-heading"><div><span>01</span><h2>Token details</h2></div><p>These fields are frozen into the launch metadata.</p></div>
        <div className="field-grid"><label><span>Game name</span><input value={input.name} onChange={(e) => update("name", e.target.value)} placeholder="Neon Burrow" maxLength={48} /></label><label><span>Token ticker</span><div className="prefixed-input"><b>$</b><input value={input.ticker} onChange={(e) => update("ticker", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="BURROW" maxLength={10} /></div></label></div>
        <label><span>Token description</span><textarea value={input.description} onChange={(e) => update("description", e.target.value)} placeholder="A one-line reason to play and follow the project." maxLength={280} /><small>{input.description.length}/280</small></label>
        <div className="upload-row"><label className="image-upload"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseImage} />{imageDataUrl ? <img src={imageDataUrl} alt="Token preview" /> : <span>＋<b>Add token image</b><small>PNG, JPEG or WebP · 2 MB</small></span>}</label><div className="upload-copy"><h3>Permanent token artwork</h3><p>The approved file is hash-addressed and served immutably after launch.</p></div></div>
        <div className="field-grid"><label><span>X link <em>optional</em></span><input value={input.xUrl} onChange={(e) => update("xUrl", e.target.value)} placeholder="https://x.com/yourgame" /></label><label><span>Website <em>optional</em></span><input value={input.websiteUrl} onChange={(e) => update("websiteUrl", e.target.value)} placeholder="https://yourgame.xyz" /></label></div>
        <div className="form-footer"><span>Drafts stay private until an on-chain launch confirms.</span><button className="button button-primary" onClick={() => setStep(2)}>Game direction →</button></div>
      </section>}
      {step === 2 && <section className="form-section"><div className="section-heading"><div><span>02</span><h2>Describe the game</h2></div><p>Choose a safe engine, then shape its world.</p></div>
        <label><span>One-prompt game description</span><textarea className="prompt-textarea" value={input.prompt} onChange={(e) => update("prompt", e.target.value)} placeholder="A cyber mouse runs through a collapsing laboratory, collects neurons and avoids security drones." maxLength={900} /><small>{input.prompt.length}/900</small></label>
        <div className="choice-label">Game engine</div><div className="category-grid">{categories.map((category) => <button key={category.value} className={input.category === category.value ? "category-card selected" : "category-card"} onClick={() => update("category", category.value)}><span className={`category-icon icon-${category.value.toLowerCase()}`} /><b>{category.title}</b><small>{category.copy}</small></button>)}</div>
        <div className="field-grid three"><label><span>Visual style</span><select value={input.visualStyle} onChange={(e) => update("visualStyle", e.target.value)}><option>Neon arcade</option><option>Pixel noir</option><option>Bright cartoon</option><option>Retro terminal</option><option>Cosmic minimal</option></select></label><label><span>Difficulty</span><select value={input.difficulty} onChange={(e) => update("difficulty", e.target.value as CreateGameInput["difficulty"])}><option value="EASY">Easy</option><option value="NORMAL">Normal</option><option value="HARD">Hard</option></select></label><label><span>Developer buy</span><div className="suffixed-input"><input value="0" disabled aria-label="Developer buy is disabled in Phase 1" /><b>ETH</b></div><small>Disabled for Phase 1 safety</small></label></div>
        <div className="estimate-bar"><div><span>Generation</span><b>About 10–20 seconds</b></div><div><span>pons launch cost</span><b>Read live before approval</b></div><div><span>Network</span><b>Robinhood Chain</b></div></div>
        <div className="form-footer"><button className="text-button" onClick={() => setStep(1)}>← Back</button><button className="button button-primary" disabled={busy} onClick={generate}>{busy ? "Building preview…" : "Generate playable preview ↗"}</button></div>
      </section>}
      {step === 3 && <section className="preview-section"><div className="section-heading"><div><span>03</span><h2>Test the build</h2></div><p>Nothing is on-chain yet.</p></div>
        {config ? <><GameFrame title={config.title} previewHtml={previewHtml} /><div className="preview-meta"><div><span>Engine</span><b>{config.category.toLowerCase()}</b></div><div><span>Difficulty</span><b>{config.difficulty.toLowerCase()}</b></div><div><span>Runtime</span><b>v1 · sandboxed</b></div><div><span>Controls</span><b>keyboard + touch</b></div></div></> : <div className="empty-preview"><span>◫</span><h3>No preview yet</h3><p>Describe the game and generate its first build.</p><button className="button button-quiet" onClick={() => setStep(2)}>Go to game direction</button></div>}
        {notice && <p className="success-copy">{notice}</p>}{error && <p className="error-copy">{error}</p>}
        <div className="launch-review"><div><h3>Ready to keep this version?</h3><p>Save it as an immutable draft, connect a verified wallet, then read the current pons cost before signing.</p></div><div className="review-actions"><button className="button button-quiet" disabled={busy} onClick={generate}>Regenerate</button><button className="button button-primary" disabled={!config || busy} onClick={saveDraft}>{status === "authenticated" ? busy ? "Saving…" : "Save draft & continue" : "Sign in with X to save"}</button></div></div>
      </section>}
      {error && step !== 3 && <p className="error-copy form-error">{error}</p>}
    </main>
  </div>;
}
