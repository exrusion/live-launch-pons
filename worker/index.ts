// Load local environment values before importing modules that construct RPC,
// database, or queue clients. Railway injects production values before start.
export {};

if (process.env.NODE_ENV !== "production") {
  try {
    process.loadEnvFile(".env.local");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

const { runWorker } = await import("./runtime");
await runWorker();
