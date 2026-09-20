// Railway accepts one pre-deploy command. Keep schema setup and the idempotent
// demo seed in one process so neither step can be dropped by command parsing.
await import("./migrate.mjs");
await import("./backfill-frozen-documents.ts");
await import("./seed.mjs");
