import os from "node:os";
import { Worker, type Job } from "bullmq";
import { db, hasDatabase, query, transaction } from "../lib/db";
import { finalizeLaunch, markLaunchFailed } from "../lib/launches";
import { PONS_LAUNCH_QUEUE, type PonsLaunchJob } from "../lib/queue";
import { createWorkerRedis, hasRedis } from "../lib/redis";
import { hasSponsorSigningConfig, processNextRebate } from "../lib/rebates";

const workerId = `${os.hostname()}:${process.pid}`;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function releaseExpiredReservations() {
  await transaction(async (client) => {
    const expired = await client.query<{ id: string; free_credit_id: string | null }>(
      `UPDATE pons_launches SET status='EXPIRED',rebate_reserved_wei=0,error_code='QUOTE_EXPIRED',error_detail='Wallet signature was not submitted before quote expiry.',updated_at=now()
       WHERE status='AWAITING_SIGNATURE' AND quote_expires_at<now() RETURNING id,free_credit_id`,
    );
    for (const row of expired.rows) {
      if (row.free_credit_id) await client.query("UPDATE free_launch_credits SET status='AVAILABLE',reserved_wallet_address=NULL,reservation_expires_at=NULL,updated_at=now() WHERE id=$1 AND status='RESERVED'", [row.free_credit_id]);
    }
  });
}

async function processLaunchById(id: string) {
  const connection = await db().connect();
  let submittedAt: Date | null = null;
  try {
    const state = await connection.query<{ status: string; submitted_at: Date | null }>("SELECT status,submitted_at FROM pons_launches WHERE id=$1", [id]);
    if (!state.rows[0] || !["SUBMITTED", "CONFIRMING"].includes(state.rows[0].status)) return false;
    submittedAt = state.rows[0].submitted_at;
    const lock = await connection.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [`pons-launch:${id}`]);
    if (!lock.rows[0]?.locked) throw new Error("LAUNCH_LOCK_BUSY");
    try {
      await finalizeLaunch(id);
    } finally {
      await connection.query("SELECT pg_advisory_unlock(hashtext($1))", [`pons-launch:${id}`]);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "verification error";
    if (/REVERTED|MISMATCH|WRONG_|MISSING|INVALID/.test(detail)) {
      await markLaunchFailed(id, "VERIFICATION_FAILED", detail);
      return true;
    }
    const ageMs = submittedAt ? Date.now() - submittedAt.getTime() : 0;
    const looksDropped = /not found|transaction.*missing|timeout|timed out/i.test(detail);
    if ((looksDropped && ageMs > 6 * 60 * 60 * 1000) || ageMs > 24 * 60 * 60 * 1000) {
      await markLaunchFailed(id, "TRANSACTION_DROPPED_OR_STUCK", detail);
      return true;
    }
    console.warn("launch_verification_pending", { launchId: id, detail });
    throw error;
  } finally {
    connection.release();
  }
  return true;
}

async function processNextLaunch() {
  const result = await query<{ id: string }>(
    `SELECT id FROM pons_launches WHERE status IN ('SUBMITTED','CONFIRMING') ORDER BY updated_at ASC LIMIT 1`,
  );
  const launch = result.rows[0];
  if (!launch) return false;
  return processLaunchById(launch.id);
}

function startQueueWorker() {
  if (!hasRedis()) return null;
  const connection = createWorkerRedis();
  const worker = new Worker<PonsLaunchJob>(
    PONS_LAUNCH_QUEUE,
    async (job: Job<PonsLaunchJob>) => {
      if (job.name !== "verify-launch" || !job.data.launchId) throw new Error("INVALID_JOB");
      await processLaunchById(job.data.launchId);
    },
    { connection, concurrency: 4 },
  );
  worker.on("completed", (job) => console.log("launch_job_completed", { launchId: job.data.launchId }));
  worker.on("failed", (job, error) => {
    console.warn("launch_job_failed", { launchId: job?.data.launchId, message: error.message });
  });
  worker.on("error", (error) => console.warn("launch_worker_redis_error", { message: error.message }));
  return { worker, connection };
}

async function loop() {
  if (!hasDatabase()) throw new Error("DATABASE_URL is required for the worker");
  await query("SELECT 1");
  if (process.env.FREE_LAUNCH_REBATE_ENABLED === "true" && !hasSponsorSigningConfig()) {
    throw new Error("FREE_LAUNCH_REBATE_ENABLED requires a valid worker signing key, sponsor settings, and operator caps");
  }
  const queueWorker = startQueueWorker();
  console.log("worker_ready", { workerId, queue: queueWorker ? "redis" : "postgres" });
  let maintenanceAt = 0;
  while (true) {
    if (Date.now() > maintenanceAt) {
      try {
        await releaseExpiredReservations();
      } catch (error) {
        console.error("worker_maintenance_error", { workerId, message: error instanceof Error ? error.message : "unknown" });
      }
      maintenanceAt = Date.now() + 60_000;
    }
    const [launchResult, rebateResult] = await Promise.allSettled([processNextLaunch(), processNextRebate()]);
    if (launchResult.status === "rejected") {
      console.error("launch_worker_cycle_error", { workerId, message: launchResult.reason instanceof Error ? launchResult.reason.message : "unknown" });
    }
    if (rebateResult.status === "rejected") {
      console.error("rebate_worker_cycle_error", { workerId, message: rebateResult.reason instanceof Error ? rebateResult.reason.message : "unknown" });
    }
    const launchWorked = launchResult.status === "fulfilled" && launchResult.value;
    const rebateWorked = rebateResult.status === "fulfilled" && rebateResult.value;
    if (!launchWorked && !rebateWorked) await delay(launchResult.status === "rejected" || rebateResult.status === "rejected" ? 5000 : 3000);
  }
}

loop().finally(async () => db().end());
