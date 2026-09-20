import { NextResponse } from "next/server";
import { databaseReady, serviceHeartbeatReady } from "@/lib/db";
import { probePonsInfrastructure } from "@/lib/pons";
import { hasSponsorRebateConfig } from "@/lib/rebates";
import { hasRedis, redisReady, workerHeartbeatReady } from "@/lib/redis";
import { aiConfigurationStatus } from "@/lib/ai-game-generator";
import { aiBudgetConfigurationStatus } from "@/lib/ai-budget";

export const dynamic = "force-dynamic";

type InfrastructureProbe = Awaited<ReturnType<typeof probePonsInfrastructure>>;

let infrastructureProbe: { checkedAt: number; value: InfrastructureProbe } = {
  checkedAt: 0,
  value: { chainRpc: false, ponsFactory: false, ponsLaunchEnabled: false },
};
let infrastructureProbeInFlight: Promise<InfrastructureProbe> | null = null;

async function infrastructureReady() {
  if (Date.now() - infrastructureProbe.checkedAt < 30_000) return infrastructureProbe.value;
  if (!infrastructureProbeInFlight) {
    infrastructureProbeInFlight = probePonsInfrastructure(8_000)
      .then((value) => {
        infrastructureProbe = { checkedAt: Date.now(), value };
        return value;
      })
      .catch(() => {
        const value = { chainRpc: false, ponsFactory: false, ponsLaunchEnabled: false };
        infrastructureProbe = { checkedAt: Date.now(), value };
        return value;
      })
      .finally(() => {
        infrastructureProbeInFlight = null;
      });
  }
  return infrastructureProbeInFlight;
}

export async function GET() {
  const databaseConfigured = Boolean(process.env.DATABASE_URL);
  const redisConfigured = hasRedis();
  const [database, redis, workerRedis, workerDatabase, infrastructure] = await Promise.all([
    databaseReady(),
    redisConfigured ? redisReady() : Promise.resolve(false),
    redisConfigured ? workerHeartbeatReady() : Promise.resolve(null),
    databaseConfigured ? serviceHeartbeatReady("worker") : Promise.resolve(false),
    infrastructureReady(),
  ]);
  const worker = workerDatabase || workerRedis === true;
  const live = process.env.NODE_ENV === "production" ? databaseConfigured && database : database || !databaseConfigured;
  const ready = live && worker;
  const ponsLaunchConfigured = process.env.PONS_LAUNCH_ENABLED === "true";
  const sponsorRebateConfigured = hasSponsorRebateConfig();
  const aiStatus = aiConfigurationStatus();
  const aiBudgetStatus = aiBudgetConfigurationStatus();
  const aiReady = aiStatus.configured && aiStatus.valid && aiBudgetStatus.valid && redisConfigured && redis === true;
  const healthy = ready && infrastructure.chainRpc && infrastructure.ponsFactory &&
    (!ponsLaunchConfigured || infrastructure.ponsLaunchEnabled) && (!redisConfigured || redis) &&
    (!aiStatus.configured || aiReady);
  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      service: "pons-game-studio",
      live,
      ready,
      healthy,
      database,
      databaseConfigured,
      redis: redisConfigured ? redis : null,
      redisConfigured,
      worker,
      workerDatabase,
      workerRedis,
      creatorSessions: Boolean(process.env.CREATOR_SESSION_SECRET || process.env.NEXTAUTH_SECRET),
      aiConfigured: aiStatus.configured,
      aiConfigValid: aiStatus.valid,
      aiBudgetConfigValid: aiBudgetStatus.valid,
      aiReady,
      aiModel: aiStatus.model,
      ponsLaunch: ponsLaunchConfigured,
      freeLaunchRebate: sponsorRebateConfigured,
      freeLaunchRebateEnabled: process.env.FREE_LAUNCH_REBATE_ENABLED === "true",
      hasSponsorRebateConfig: sponsorRebateConfigured,
      chainId: 4663,
      chainRpc: infrastructure.chainRpc,
      ponsFactory: infrastructure.ponsFactory,
      ponsLaunchEnabled: infrastructure.ponsLaunchEnabled,
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
