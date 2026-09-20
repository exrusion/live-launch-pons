import assert from "node:assert/strict";
import test from "node:test";
import { generateGameConfigWithAi, type AiProviderConfig } from "@/lib/ai-game-generator";

const input = {
  name: "Neon Burrow",
  ticker: "BURROW",
  description: "A tiny arcade chase through a neural lab.",
  prompt: "Make a cyber mouse runner through a collapsing laboratory with neuron collectibles",
  category: "RUNNER" as const,
  visualStyle: "Neon arcade",
  difficulty: "NORMAL" as const,
  developerBuyEth: "0",
  xUrl: "",
  websiteUrl: "",
};

const config: AiProviderConfig = {
  baseUrl: "https://gateway.example/v1",
  apiKey: "test-provider-key-never-used-outside-tests",
  model: "fast-code-model",
  fallbackModel: "fast-flash-model",
  timeoutMs: 5_000,
  maxCompletionTokens: 900,
};

const blueprint = {
  instructions: "Jump over patrol drones and collect every bright neuron.",
  story: "A courier mouse races through a failing neural vault before the lights go dark.",
  palette: {
    background: "#07111f",
    primary: "#67f7c1",
    accent: "#ffd45c",
    danger: "#ff5577",
    text: "#f7fbff",
  },
  character: { shape: "neural courier mouse", label: "courier mouse" },
  obstacle: { shape: "patrol drone", label: "patrol drone" },
  collectible: { shape: "bright neuron", label: "neuron" },
  speed: 1.08,
  soundStyle: "arcade" as const,
  mechanics: {
    worldPattern: "circuit" as const,
    playerForm: "runner" as const,
    obstacleForm: "drone" as const,
    collectibleForm: "neuron" as const,
    gravity: 0.96,
    jumpPower: 1.08,
    spawnRate: 1.05,
    collectibleRate: 1.1,
    obstacleScale: 0.9,
    enemyAggression: 1,
    projectileSpeed: 1,
  },
};

function completion(value: unknown, model = config.model) {
  return new Response(JSON.stringify({
    model,
    choices: [{ message: { content: typeof value === "string" ? value : JSON.stringify(value) } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("an OpenAI-compatible provider produces a strict blueprint without exposing the API key", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const result = await generateGameConfigWithAi(input, {
    config,
    fetchImpl: async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      return completion(blueprint);
    },
  });

  assert.equal(requestUrl, "https://gateway.example/v1/chat/completions");
  assert.equal(new Headers(requestInit?.headers).get("authorization"), `Bearer ${config.apiKey}`);
  const requestBody = JSON.parse(String(requestInit?.body));
  assert.equal(requestBody.model, "fast-code-model");
  assert.equal(requestBody.stream, false);
  assert.equal(result.outcome.mode, "ai");
  assert.equal(result.config.generation?.provider, "gateway.example");
  assert.equal(result.config.generation?.model, "fast-code-model");
  assert.equal(result.config.title, input.name);
  assert.equal(result.config.category, input.category);
  assert.equal(result.config.difficulty, input.difficulty);
  assert.equal(result.config.story, blueprint.story);
  assert.doesNotMatch(JSON.stringify(result), /test-provider-key/);
});

test("missing AI configuration uses the deterministic engine without a network request", async () => {
  let calls = 0;
  const result = await generateGameConfigWithAi(input, {
    config: null,
    fetchImpl: async () => {
      calls += 1;
      throw new Error("should not be called");
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.outcome.mode, "deterministic");
  assert.equal(result.config.generation?.mode, "deterministic");
});

test("an unavailable primary model can use the configured fast fallback model", async () => {
  const models: string[] = [];
  const result = await generateGameConfigWithAi(input, {
    config,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      models.push(body.model);
      return body.model === config.model
        ? new Response("unavailable", { status: 503 })
        : completion(blueprint, body.model);
    },
  });
  assert.deepEqual(models, ["fast-code-model", "fast-flash-model"]);
  assert.equal(result.outcome.mode, "ai");
  assert.equal(result.config.generation?.model, "fast-flash-model");
});

test("a model-specific spending or allowlist response can use the configured fallback", async () => {
  for (const status of [402, 403]) {
    const models: string[] = [];
    const result = await generateGameConfigWithAi(input, {
      config,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        models.push(body.model);
        return body.model === config.model ? new Response(null, { status }) : completion(blueprint, body.model);
      },
    });
    assert.deepEqual(models, ["fast-code-model", "fast-flash-model"]);
    assert.equal(result.config.generation?.mode, "ai");
    assert.equal(result.config.generation?.attempts, 2);
  }
});

test("malformed or hostile model output fails closed to the trusted runtime", async () => {
  const invalid = { ...blueprint, extraExecutableCode: "<script>fetch('https://evil.invalid')</script>" };
  const result = await generateGameConfigWithAi(input, {
    config: { ...config, fallbackModel: undefined },
    fetchImpl: async () => completion(invalid),
  });
  assert.equal(result.outcome.mode, "fallback");
  assert.equal(result.outcome.code, "INVALID_BLUEPRINT");
  assert.equal(result.config.generation?.mode, "fallback");
  assert.doesNotMatch(JSON.stringify(result.config), /evil\.invalid|<script/i);
});

test("timeouts and credential failures do not leak upstream details", async () => {
  const timeout = new Error("secret upstream detail");
  timeout.name = "AbortError";
  let timeoutCalls = 0;
  const timedOut = await generateGameConfigWithAi(input, {
    config,
    fetchImpl: async () => {
      timeoutCalls += 1;
      throw timeout;
    },
  });
  assert.equal(timedOut.outcome.code, "TIMEOUT");
  assert.equal(timeoutCalls, 1);
  assert.doesNotMatch(JSON.stringify(timedOut), /secret upstream detail/);

  let calls = 0;
  const unauthorized = await generateGameConfigWithAi(input, {
    config,
    fetchImpl: async () => {
      calls += 1;
      return new Response("do not expose this body", { status: 401 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(unauthorized.outcome.code, "HTTP_401");
  assert.doesNotMatch(JSON.stringify(unauthorized), /do not expose this body/);
});

test("the deadline covers a stalled response body and does not start a second paid request", async () => {
  let calls = 0;
  const result = await generateGameConfigWithAi(input, {
    config: { ...config, timeoutMs: 50 },
    fetchImpl: async (_url, init) => {
      calls += 1;
      const signal = init?.signal;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"model":"fast-code-model","choices":['));
          signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")));
        },
      }), { status: 200 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.outcome.code, "TIMEOUT");
  assert.equal(result.config.generation?.mode, "fallback");
});

test("chunked oversized responses fail closed and reported model provenance is preserved", async () => {
  const oversized = await generateGameConfigWithAi(input, {
    config: { ...config, fallbackModel: undefined },
    fetchImpl: async () => new Response(new Uint8Array(129 * 1024), { status: 200 }),
  });
  assert.equal(oversized.outcome.code, "OVERSIZE");

  const routedModel = await generateGameConfigWithAi(input, {
    config: { ...config, fallbackModel: undefined },
    fetchImpl: async () => completion(blueprint, "unexpected-model"),
  });
  assert.equal(routedModel.config.generation?.mode, "ai");
  assert.equal(routedModel.config.generation?.model, "unexpected-model");
});
