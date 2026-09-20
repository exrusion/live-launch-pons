"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import type { CreateGameInput, GameConfig } from "@/lib/types";
import {
  clearCreateDraft,
  forgetTabDraftId,
  getOrCreateTabDraftId,
  persistCreateDraft,
  restoreCreateDraft,
  type CreateDraftPayload,
} from "@/lib/create-draft-storage";
import { GameFrame } from "@/components/game-frame";

const categories = [
  { value: "RUNNER", title: "Endless runner", copy: "Jump, dodge, and collect." },
  { value: "FLAPPY", title: "Flappy-style", copy: "Tap through shifting gates." },
  { value: "SHOOTER", title: "Top-down shooter", copy: "Move, aim, and survive." },
] as const;

const promptIdeas = [
  { title: "Cloud courier", category: "RUNNER", style: "Pastel cloud", difficulty: "EASY", prompt: "A tiny robot courier races across floating cloud cities, jumps over broken sky bridges, collects glowing parcels, and escapes a playful storm." },
  { title: "Moon mouse", category: "FLAPPY", style: "Cosmic minimal", difficulty: "NORMAL", prompt: "A brave moon mouse pilots a pocket rocket through moving satellite gates, collects cheese stars, and avoids sleepy space drones." },
  { title: "Neon defender", category: "SHOOTER", style: "Arcade noir", difficulty: "HARD", prompt: "A neon guardian protects a midnight arcade from waves of corrupted bots, rescues lost pixels, and unlocks stronger energy weapons." },
  { title: "Jungle dash", category: "RUNNER", style: "Bright cartoon", difficulty: "NORMAL", prompt: "A cheerful explorer dashes through a living jungle temple, swings past traps, collects ancient fruit, and outruns a giant stone guardian." },
] as const;

function validOptionalUrl(value: string | undefined) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function validateGameInput(input: CreateGameInput): { message: string; step: 1 | 2 } | null {
  if (input.name.trim().length < 2) return { message: "Enter a game name with at least 2 characters.", step: 1 };
  if (!/^[A-Z0-9]{2,10}$/.test(input.ticker.trim().toUpperCase())) return { message: "Enter a token ticker using 2–10 letters or numbers.", step: 1 };
  if (input.description.trim().length < 8) return { message: "Add a token description with at least 8 characters.", step: 1 };
  if (!validOptionalUrl(input.xUrl)) return { message: "Enter a valid X link, or leave it blank.", step: 1 };
  if (!validOptionalUrl(input.websiteUrl)) return { message: "Enter a valid website link, or leave it blank.", step: 1 };
  if (input.prompt.trim().length < 15) return { message: "Describe the game in at least 15 characters.", step: 2 };
  return null;
}

export function CreateStudio({ initialPrompt = "", cspNonce }: { initialPrompt?: string; cspNonce: string }) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [input, setInput] = useState<CreateGameInput>({ name: "", ticker: "", description: "", prompt: initialPrompt, category: "RUNNER", visualStyle: "Neon arcade", difficulty: "NORMAL", developerBuyEth: "0", xUrl: "", websiteUrl: "" });
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [imageReading, setImageReading] = useState(false);
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [previewToken, setPreviewToken] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [restoreNotice, setRestoreNotice] = useState("");
  const [step, setStep] = useState(1);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const draftClearedRef = useRef(false);
  const draftIdRef = useRef<string | null>(null);
  const draftInteractionRef = useRef(false);
  const storageQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const autoSaveTimerRef = useRef<number | null>(null);
  const generationRevisionRef = useRef(0);
  const imageReaderRef = useRef<FileReader | null>(null);
  const imageReadRevisionRef = useRef(0);

  function draftPayload(): CreateDraftPayload {
    return { input, imageDataUrl, config, previewToken, previewHtml, step };
  }

  function enqueueStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
    const queued = storageQueueRef.current.catch(() => undefined).then(operation);
    storageQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }

  useEffect(() => {
    let cancelled = false;
    const draftId = getOrCreateTabDraftId();
    draftIdRef.current = draftId;
    const restore = async () => {
      try {
        const draft = draftId ? await restoreCreateDraft(draftId) : null;
        if (cancelled || !draft || draftInteractionRef.current) return;
        setInput({ developerBuyEth: "0", xUrl: "", websiteUrl: "", ...draft.input });
        setImageDataUrl(draft.imageDataUrl);
        setConfig(draft.config);
        setPreviewToken(draft.previewToken);
        setPreviewHtml(draft.previewHtml);
        setStep(Math.min(3, Math.max(1, Math.trunc(draft.step))));
        setRestoreNotice(draft.previewNeedsRegeneration
          ? "Restored your game details and image. Rebuild the preview once to upgrade it to the current runtime."
          : "Restored your saved game draft. You can continue where you left off.");
      } finally {
        if (!cancelled) setDraftHydrated(true);
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!draftHydrated || draftClearedRef.current || !draftIdRef.current) return;
    const draftId = draftIdRef.current;
    const hasDraftContent = Boolean(
      input.name || input.ticker || input.description || input.prompt || input.xUrl || input.websiteUrl
      || input.category !== "RUNNER" || input.visualStyle !== "Neon arcade" || input.difficulty !== "NORMAL"
      || (input.developerBuyEth && input.developerBuyEth !== "0")
      || imageDataUrl || config || previewToken || previewHtml || step > 1,
    );
    const snapshot = draftPayload();
    const timer = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      if (draftClearedRef.current) return;
      if (hasDraftContent) void enqueueStorageOperation(() => persistCreateDraft(draftId, snapshot));
      else void enqueueStorageOperation(() => clearCreateDraft(draftId));
    }, 150);
    autoSaveTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (autoSaveTimerRef.current === timer) autoSaveTimerRef.current = null;
    };
  }, [config, draftHydrated, imageDataUrl, input, previewHtml, previewToken, step]);

  useEffect(() => () => {
    imageReadRevisionRef.current += 1;
    imageReaderRef.current?.abort();
  }, []);

  function invalidatePreview() {
    generationRevisionRef.current += 1;
    setConfig(null);
    setPreviewToken("");
    setPreviewHtml("");
    setNotice("");
  }

  function update<K extends keyof CreateGameInput>(key: K, value: CreateGameInput[K]) {
    if (input[key] === value) return;
    draftInteractionRef.current = true;
    setInput((current) => ({ ...current, [key]: value }));
    invalidatePreview();
  }

  function applyPromptIdea(idea: (typeof promptIdeas)[number]) {
    draftInteractionRef.current = true;
    setInput((current) => ({
      ...current,
      prompt: idea.prompt,
      category: idea.category,
      visualStyle: idea.style,
      difficulty: idea.difficulty,
    }));
    invalidatePreview();
  }

  function surpriseMe() {
    const currentIndex = promptIdeas.findIndex((idea) => idea.prompt === input.prompt);
    applyPromptIdea(promptIdeas[(currentIndex + 1 + Math.floor(Math.random() * (promptIdeas.length - 1))) % promptIdeas.length]);
  }

  function goToStep(nextStep: number) {
    draftInteractionRef.current = true;
    if (nextStep === 2) {
      const validation = validateGameInput({ ...input, prompt: input.prompt.length >= 15 ? input.prompt : "temporary prompt" });
      if (validation?.step === 1) {
        setError(validation.message);
        setStep(1);
        return;
      }
    }
    setError("");
    setStep(nextStep);
  }

  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const imageReadRevision = imageReadRevisionRef.current + 1;
    imageReadRevisionRef.current = imageReadRevision;
    imageReaderRef.current?.abort();
    imageReaderRef.current = null;
    setImageReading(false);
    if (![/image\/png/, /image\/jpeg/, /image\/webp/].some((pattern) => pattern.test(file.type)) || file.size > 2 * 1024 * 1024) {
      setError("Use a PNG, JPEG, or WebP image under 2 MB.");
      event.currentTarget.value = "";
      return;
    }
    draftInteractionRef.current = true;
    invalidatePreview();
    setImageReading(true);
    const reader = new FileReader();
    imageReaderRef.current = reader;
    reader.onload = () => {
      if (imageReadRevision !== imageReadRevisionRef.current) return;
      setImageDataUrl(String(reader.result));
      setError("");
      setImageReading(false);
      imageReaderRef.current = null;
    };
    reader.onerror = () => {
      if (imageReadRevision !== imageReadRevisionRef.current) return;
      setError("Could not read that image. Choose another file.");
      setImageReading(false);
      imageReaderRef.current = null;
    };
    reader.onabort = () => {
      if (imageReadRevision !== imageReadRevisionRef.current) return;
      setImageReading(false);
      imageReaderRef.current = null;
    };
    reader.readAsDataURL(file);
  }

  async function generate() {
    if (imageReading) { setError("Wait for the token image to finish processing."); return; }
    const validation = validateGameInput(input);
    if (validation) {
      setError(validation.message);
      setStep(validation.step);
      return;
    }
    const generationRevision = generationRevisionRef.current + 1;
    generationRevisionRef.current = generationRevision;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/generate/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Generation failed");
      if (!body.previewToken || typeof body.previewToken !== "string") throw new Error("Preview verification failed. Generate it again.");
      if (!body.previewHtml || typeof body.previewHtml !== "string") throw new Error("Playable preview output was missing. Generate it again.");
      if (!body.config || typeof body.config !== "object") throw new Error("Game configuration was missing. Generate it again.");
      if (generationRevision !== generationRevisionRef.current) return;
      const generatedConfig = body.config as GameConfig;
      const mode = generatedConfig.generation?.mode;
      setConfig(generatedConfig); setPreviewToken(body.previewToken); setPreviewHtml(body.previewHtml); setStep(3);
      setNotice(mode === "ai"
        ? "AI-directed playable preview ready. Test it before saving."
        : mode === "fallback"
          ? "The AI service was temporarily unavailable, so a safe playable fallback was built instead."
          : "Playable template ready. AI capacity is temporarily unavailable, so this build stayed local.");
    } catch (cause) { if (generationRevision === generationRevisionRef.current) setError(cause instanceof Error ? cause.message : "Generation failed"); }
    finally { setBusy(false); }
  }

  async function saveDraft() {
    if (status === "loading" || authBusy) return;
    if (imageReading) { setError("Wait for the token image to finish processing."); return; }
    if (!config || !previewToken || !previewHtml) { setError("Generate a fresh playable preview before saving."); setStep(2); return; }
    if (!imageDataUrl) { setError("Add a token image before saving the launch draft."); setStep(1); return; }
    if (status !== "authenticated" || !session?.user?.xId) {
      const draftId = draftIdRef.current || getOrCreateTabDraftId();
      if (!draftId) {
        setError("Browser storage is required to preserve this draft during X sign-up.");
        return;
      }
      draftIdRef.current = draftId;
      if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
      setAuthBusy(true);
      setError("");
      try {
        const committed = await enqueueStorageOperation(() => persistCreateDraft(draftId, draftPayload()));
        if (!committed.localStorage) {
          setError("Your draft could not be preserved for the X sign-up round trip. Free some browser storage and try again.");
          return;
        }
        await signIn("twitter", { callbackUrl: "/create" });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not open X sign-up.");
      } finally {
        setAuthBusy(false);
      }
      return;
    }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/games", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input, config, imageDataUrl, previewToken }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save draft");
      draftClearedRef.current = true;
      if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
      const draftId = draftIdRef.current;
      if (draftId) {
        await enqueueStorageOperation(() => clearCreateDraft(draftId));
        forgetTabDraftId(draftId);
        draftIdRef.current = null;
      }
      router.push(`/studio/${body.gameId}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save draft"); }
    finally { setBusy(false); }
  }

  if (!draftHydrated) return <div className="creator-layout" aria-busy="true">
    <aside className="creator-steps">
      <div className="eyebrow">New game</div><h1>Build the first playable version.</h1>
      <div className="security-note"><span>Protected recovery</span><p>Your saved image, prompt and exact playable preview are being restored.</p></div>
    </aside>
    <section className="creator-workspace">
      <div className="empty-preview" role="status" aria-live="polite"><span>↻</span><h2>Restoring your draft…</h2><p>Keeping this screen locked until recovery finishes.</p></div>
    </section>
  </div>;

  return <div className="creator-layout">
    <aside className="creator-steps">
      <div className="eyebrow">New game</div><h1>Build the first playable version.</h1>
      {[{ n: 1, t: "Token details" }, { n: 2, t: "Game direction" }, { n: 3, t: "Preview & save" }].map((item) => <button key={item.n} className={step === item.n ? "step active" : step > item.n ? "step complete" : "step"} aria-current={step === item.n ? "step" : undefined} onClick={() => goToStep(item.n)}><span>{step > item.n ? "✓" : item.n}</span>{item.t}</button>)}
      <div className="security-note"><span>Isolated AI build</span><p>AI directs a validated blueprint while the executable runtime stays sandboxed.</p></div>
    </aside>
    <section className="creator-workspace">
      {restoreNotice && <p className="success-copy" role="status" aria-live="polite">{restoreNotice}</p>}
      {step === 1 && <section className="form-section"><div className="section-heading"><div><span>01</span><h2>Token details</h2></div><p>These fields are frozen into the launch metadata.</p></div>
        <div className="field-grid"><label><span>Game name</span><input value={input.name} onChange={(e) => update("name", e.target.value)} placeholder="Neon Burrow" maxLength={48} /></label><label><span>Token ticker</span><div className="prefixed-input"><b>$</b><input value={input.ticker} onChange={(e) => update("ticker", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="BURROW" maxLength={10} /></div></label></div>
        <label><span>Token description</span><textarea value={input.description} onChange={(e) => update("description", e.target.value)} placeholder="A one-line reason to play and follow the project." maxLength={280} /><small>{input.description.length}/280</small></label>
        <div className="upload-row"><label className="image-upload" aria-busy={imageReading}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseImage} />{imageDataUrl ? <img src={imageDataUrl} alt="Token preview" /> : <span>＋<b>Add token image</b><small>PNG, JPEG or WebP · 2 MB</small></span>}</label><div className="upload-copy"><h3>Permanent token artwork</h3><p>{imageReading ? <span role="status">Processing the selected image…</span> : "The approved file is hash-addressed and served immutably after launch."}</p></div></div>
        <div className="field-grid"><label><span>X link <em>optional</em></span><input value={input.xUrl} onChange={(e) => update("xUrl", e.target.value)} placeholder="https://x.com/yourgame" /></label><label><span>Website <em>optional</em></span><input value={input.websiteUrl} onChange={(e) => update("websiteUrl", e.target.value)} placeholder="https://yourgame.xyz" /></label></div>
        <div className="form-footer"><span>Drafts stay private until an on-chain launch confirms.</span><button className="button button-primary" onClick={() => goToStep(2)}>Game direction →</button></div>
      </section>}
      {step === 2 && <section className="form-section"><div className="section-heading"><div><span>02</span><h2>Shape your game</h2></div><p>Start with an idea or let AI prepare one.</p></div>
        <div className="prompt-assist"><div><span>AI prompt starters</span><p>Pick a ready-made concept. You can edit every word before generating.</p></div><button className="prompt-surprise" type="button" onClick={surpriseMe}>✦ Surprise me</button></div>
        <div className="prompt-idea-grid">{promptIdeas.map((idea) => <button key={idea.title} type="button" className={input.prompt === idea.prompt ? "prompt-idea selected" : "prompt-idea"} onClick={() => applyPromptIdea(idea)}><b>{idea.title}</b><small>{idea.category.toLowerCase()} · {idea.style}</small></button>)}</div>
        <label><span>Your game idea</span><textarea className="prompt-textarea" value={input.prompt} onChange={(e) => update("prompt", e.target.value)} placeholder="Describe the hero, world, challenge and what the player collects…" maxLength={900} /><small>{input.prompt.length}/900</small></label>
        <div className="choice-label">Choose how it plays</div><div className="category-grid">{categories.map((category) => <button key={category.value} className={input.category === category.value ? "category-card selected" : "category-card"} aria-pressed={input.category === category.value} onClick={() => update("category", category.value)}><span className={`category-icon icon-${category.value.toLowerCase()}`} /><b>{category.title}</b><small>{category.copy}</small></button>)}</div>
        <div className="field-grid three"><label><span>Visual style</span><select value={input.visualStyle} onChange={(e) => update("visualStyle", e.target.value)}><option>Neon arcade</option><option>Pixel noir</option><option>Bright cartoon</option><option>Retro terminal</option><option>Cosmic minimal</option></select></label><label><span>Difficulty</span><select value={input.difficulty} onChange={(e) => update("difficulty", e.target.value as CreateGameInput["difficulty"])}><option value="EASY">Easy</option><option value="NORMAL">Normal</option><option value="HARD">Hard</option></select></label><label><span>Developer buy</span><div className="suffixed-input"><input value="0" disabled aria-label="Developer buy is disabled in Phase 1" /><b>ETH</b></div><small>Disabled for Phase 1 safety</small></label></div>
        <div className="estimate-bar"><div><span>AI build</span><b>Ready in about 10–20 seconds</b></div><div><span>Launch price</span><b>Shown before wallet approval</b></div><div><span>Network</span><b>Robinhood Chain</b></div></div>
        <div className="form-footer"><button className="text-button" onClick={() => goToStep(1)}>← Back</button><button className="button button-primary" disabled={busy || imageReading} onClick={generate}>{busy ? "Building preview…" : imageReading ? "Processing image…" : "Generate playable preview ↗"}</button></div>
      </section>}
      {step === 3 && <section className="preview-section"><div className="section-heading"><div><span>03</span><h2>Test the build</h2></div><p>Nothing is on-chain yet.</p></div>
        {config && previewHtml ? <><GameFrame title={config.title} previewHtml={previewHtml} cspNonce={cspNonce} /><div className="preview-meta"><div><span>Engine</span><b>{config.category.toLowerCase()}</b></div><div><span>Difficulty</span><b>{config.difficulty.toLowerCase()}</b></div><div><span>Generation</span><b>{config.generation?.mode === "ai" ? `AI · ${config.generation.model}` : config.generation?.mode === "fallback" ? "safe fallback" : "template"}</b></div><div><span>Runtime</span><b>v3 · sandboxed</b></div></div></> : <div className="empty-preview"><span>◫</span><h3>No preview yet</h3><p>Describe the game and generate its first build.</p><button className="button button-quiet" onClick={() => goToStep(2)}>Go to game direction</button></div>}
        {notice && <p className="success-copy" role="status">{notice}</p>}{error && <p className="error-copy" role="alert">{error}</p>}
        <div className="launch-review"><div><h3>Ready to keep this version?</h3><p>{status === "authenticated" && session?.user?.xId ? "Save this playable version, then connect your wallet when you are ready to launch." : "Continue with X to save your draft and unlock your one-time launch credit. Your work stays here during sign-up."}</p></div><div className="review-actions"><button className="button button-quiet" disabled={busy || authBusy || imageReading} onClick={generate}>Regenerate</button><button className="button button-primary" disabled={!config || !previewToken || !previewHtml || busy || authBusy || imageReading || status === "loading"} onClick={saveDraft}>{imageReading ? "Processing image…" : status === "loading" ? "Checking X…" : status === "authenticated" && session?.user?.xId ? busy ? "Saving…" : "Save draft & continue" : authBusy ? "Opening X…" : "Continue with X to save"}</button></div></div>
      </section>}
      {error && step !== 3 && <p className="error-copy form-error" role="alert">{error}</p>}
    </section>
  </div>;
}
