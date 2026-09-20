import { NextResponse } from "next/server";
import { databaseReady } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const database = await databaseReady();
  const databaseConfigured = Boolean(process.env.DATABASE_URL);
  const ok = process.env.NODE_ENV === "production" ? databaseConfigured && database : database || !databaseConfigured;
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", service: "pons-game-studio", database, databaseConfigured, chainId: 4663, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
