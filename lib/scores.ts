import { canonicalJson, sha256 } from "@/lib/security";
import type { GameCategory } from "@/lib/types";

export type ReplayEvent = { t: number; type: string; x?: number; y?: number };

export function validateReplay(input: {
  category: GameCategory;
  score: number;
  durationMs: number;
  events: ReplayEvent[];
  seedHash: string;
  speed?: number;
  difficulty?: "EASY" | "NORMAL" | "HARD";
}) {
  if (!Number.isSafeInteger(input.score) || input.score < 0) return { valid: false, reason: "INVALID_SCORE" };
  if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 500 || input.durationMs > 60 * 60 * 1000) return { valid: false, reason: "INVALID_DURATION" };
  if (!Array.isArray(input.events) || input.events.length > 1800) return { valid: false, reason: "INVALID_EVENT_LOG" };
  let previous = -1;
  const allowed = new Set(
    input.category === "SHOOTER"
      ? ["fire", "move", "hit", "pause", "resume"]
      : input.category === "FLAPPY"
        ? ["flap", "gate", "pause", "resume"]
        : ["jump", "collect", "pause", "resume"],
  );
  let paused = false;
  for (const event of input.events) {
    if (!Number.isSafeInteger(event.t) || event.t < previous || event.t > input.durationMs + 500 || !allowed.has(event.type)) return { valid: false, reason: "INVALID_EVENT_SEQUENCE" };
    if (event.type === "pause") {
      if (paused) return { valid: false, reason: "INVALID_PAUSE_SEQUENCE" };
      paused = true;
    }
    if (event.type === "resume") {
      if (!paused) return { valid: false, reason: "INVALID_PAUSE_SEQUENCE" };
      paused = false;
    }
    if ((event.type === "fire" || event.type === "move") && (!Number.isFinite(event.x) || !Number.isFinite(event.y) || event.x! < 0 || event.x! > 960 || event.y! < 0 || event.y! > 540)) {
      return { valid: false, reason: "INVALID_POINTER_EVENT" };
    }
    previous = event.t;
  }
  const inputTypes = input.category === "SHOOTER" ? new Set(["fire", "move"]) : input.category === "FLAPPY" ? new Set(["flap"]) : new Set(["jump"]);
  const activeEvents = input.events.filter((event) => inputTypes.has(event.type));
  const minimumSpacing = input.category === "SHOOTER" ? 20 : 70;
  for (let index = 1; index < activeEvents.length; index += 1) {
    if (activeEvents[index].t - activeEvents[index - 1].t < minimumSpacing) return { valid: false, reason: "INPUT_RATE_EXCEEDED" };
  }
  let computedScore = 0;
  let tolerance = 0;
  if (input.category === "RUNNER") {
    const collects = input.events.filter((event) => event.type === "collect");
    if (collects.length > Math.ceil(input.durationMs / 300) + 1) return { valid: false, reason: "COLLECT_RATE_EXCEEDED" };
    for (let index = 1; index < collects.length; index += 1) if (collects[index].t - collects[index - 1].t < 250) return { valid: false, reason: "COLLECT_RATE_EXCEEDED" };
    const difficulty = input.difficulty === "HARD" ? 1.22 : input.difficulty === "EASY" ? 0.84 : 1;
    const pace = (input.speed ?? 1) * difficulty;
    computedScore = Math.floor((input.durationMs * pace) / 10) + collects.length * 25;
    tolerance = 5;
  } else if (input.category === "FLAPPY") {
    const gates = input.events.filter((event) => event.type === "gate");
    if (gates.length > Math.ceil(input.durationMs / 650) + 1) return { valid: false, reason: "GATE_RATE_EXCEEDED" };
    for (let index = 1; index < gates.length; index += 1) if (gates[index].t - gates[index - 1].t < 600) return { valid: false, reason: "GATE_RATE_EXCEEDED" };
    computedScore = gates.length * 100;
  } else {
    const fires = input.events.filter((event) => event.type === "fire");
    const hits = input.events.filter((event) => event.type === "hit");
    if (hits.length > fires.length) return { valid: false, reason: "HIT_WITHOUT_FIRE" };
    if (hits.length > Math.ceil(input.durationMs / 280) + 1) return { valid: false, reason: "HIT_RATE_EXCEEDED" };
    for (let index = 1; index < hits.length; index += 1) if (hits[index].t - hits[index - 1].t < 240) return { valid: false, reason: "HIT_RATE_EXCEEDED" };
    const availableShots = [...fires];
    for (const hit of hits) {
      const shotIndex = availableShots.findIndex((shot) => shot.t <= hit.t && hit.t - shot.t <= 2_500);
      if (shotIndex < 0) return { valid: false, reason: "HIT_WITHOUT_FIRE" };
      availableShots.splice(shotIndex, 1);
    }
    computedScore = Math.floor((input.durationMs * 8) / 1_000) + hits.length * 50;
    tolerance = 1;
  }
  if (Math.abs(input.score - computedScore) > tolerance) return { valid: false, reason: "SCORE_REPLAY_MISMATCH", computedScore };
  const replayHash = sha256(canonicalJson({ seedHash: input.seedHash, durationMs: input.durationMs, score: input.score, events: input.events }));
  return { valid: true, reason: null, replayHash, computedScore };
}
