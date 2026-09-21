import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { launchById } from "@/lib/launches";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || session.user.accountStatus !== "ACTIVE") {
    return NextResponse.json({ error: "Connect and verify a wallet before launching.", code: "CREATOR_SESSION_REQUIRED" }, { status: 401 });
  }
  const { id } = await context.params;
  const launch = await launchById(id, session.user.id);
  if (!launch) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ launch }, { headers: { "Cache-Control": "no-store" } });
}
