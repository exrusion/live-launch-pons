import { Queue } from "bullmq";
import { redis } from "@/lib/redis";

export const PONS_LAUNCH_QUEUE = "pons-launch-verification";

export type PonsLaunchJob = {
  launchId: string;
};

type QueueScope = typeof globalThis & {
  __ponsLaunchQueue?: Queue<PonsLaunchJob>;
};

function launchQueue() {
  const connection = redis();
  if (!connection) return null;
  const scope = globalThis as QueueScope;
  if (!scope.__ponsLaunchQueue) {
    scope.__ponsLaunchQueue = new Queue<PonsLaunchJob>(PONS_LAUNCH_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 12,
        backoff: { type: "exponential", delay: 3_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    });
    scope.__ponsLaunchQueue.on("error", (error) => {
      console.warn("launch_queue_error", { message: error.message });
    });
  }
  return scope.__ponsLaunchQueue;
}

/**
 * Queue delivery is an acceleration path. A false return deliberately leaves
 * durable database state for the polling worker to recover.
 */
export async function enqueueLaunchVerification(launchId: string) {
  const queue = launchQueue();
  if (!queue) return false;
  try {
    await queue.add("verify-launch", { launchId }, { jobId: `verify-${launchId}` });
    return true;
  } catch (error) {
    console.warn("launch_enqueue_failed", {
      launchId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}

export async function enqueueSponsoredLaunch(launchId: string) {
  const queue = launchQueue();
  if (!queue) return false;
  try {
    await queue.add("submit-sponsored-launch", { launchId }, { jobId: `sponsor-${launchId}` });
    return true;
  } catch (error) {
    console.warn("sponsored_launch_enqueue_failed", {
      launchId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}
