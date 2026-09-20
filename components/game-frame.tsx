"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyPreviewNonce } from "@/lib/preview-html";

type GameMessage = { source: string; type: string; payload: { score?: number; durationMs?: number; metric?: string; events?: unknown[] } };

export function GameFrame({ publicId, versionId, title, previewHtml, cspNonce }: { publicId?: string; versionId?: string; title: string; previewHtml?: string; cspNonce?: string }) {
  const run = useRef<{ runId: string; runToken: string } | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [scoreStatus, setScoreStatus] = useState("");
  const [activeDocumentNonce, setActiveDocumentNonce] = useState("");
  useEffect(() => {
    const documentNonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce || cspNonce || "";
    setActiveDocumentNonce(documentNonce);
  }, [cspNonce]);
  const displayPreviewHtml = useMemo(
    () => previewHtml && activeDocumentNonce ? applyPreviewNonce(previewHtml, activeDocumentNonce) : undefined,
    [previewHtml, activeDocumentNonce],
  );
  const beginRun = useCallback(async () => {
    if (!publicId || previewHtml || run.current) return;
    const response = await fetch(`/api/game/${encodeURIComponent(publicId)}/runs`, { method: "POST" });
    if (response.ok) run.current = await response.json();
  }, [publicId, previewHtml]);
  useEffect(() => { beginRun().catch(() => undefined); }, [beginRun]);
  useEffect(() => {
    async function onMessage(event: MessageEvent<GameMessage>) {
      if (event.source !== frame.current?.contentWindow || event.data?.source !== "pons-game" || !run.current) return;
      if (event.data.type === "game_start") {
        await fetch(`/api/runs/${run.current.runId}/start`, { method: "POST" });
        return;
      }
      if (event.data.type !== "game_over") return;
      setScoreStatus("Validating run…");
      const response = await fetch(`/api/runs/${run.current.runId}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runToken: run.current.runToken, ...event.data.payload }) });
      const body = await response.json();
      setScoreStatus(response.ok ? "Score passed replay checks and was added." : body.error || body.reason || "Score not accepted.");
      run.current = null;
      await beginRun();
    }
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [beginRun]);
  return <div className="game-stage"><iframe ref={frame} title={title} src={previewHtml ? undefined : `/embed/${versionId}?presentation=clean`} srcDoc={displayPreviewHtml} sandbox="allow-scripts allow-pointer-lock" allow="fullscreen" />{scoreStatus && <div className="score-toast">{scoreStatus}</div>}</div>;
}
