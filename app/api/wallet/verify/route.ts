import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress, verifyMessage } from "viem";
import { auth } from "@/lib/auth";
import { transaction } from "@/lib/db";
import { requireSameOrigin, safeError } from "@/lib/security";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const session = await auth();
    if (!session?.user?.id || !session.user.xId || session.user.accountStatus !== "ACTIVE") {
      return NextResponse.json(
        { error: "Continue with X before verifying a launch wallet.", code: "X_AUTH_REQUIRED" },
        { status: 401 },
      );
    }
    const body = await request.json();
    if (!isAddress(body.address) || typeof body.signature !== "string" || typeof body.message !== "string") return NextResponse.json({ error: "Invalid verification payload." }, { status: 400 });
    const address = getAddress(body.address);
    const valid = await verifyMessage({ address, message: body.message, signature: body.signature });
    if (!valid) return NextResponse.json({ error: "Signature verification failed." }, { status: 400 });
    const result = await transaction(async (client) => {
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [session.user!.id]);
      const challenge = await client.query<{ id: string; message: string }>(
        `SELECT id,message FROM wallet_nonces WHERE user_id=$1 AND address_normalized=$2 AND consumed_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [session.user!.id, address.toLowerCase()],
      );
      if (!challenge.rows[0] || challenge.rows[0].message !== body.message) throw new Error("CHALLENGE_NOT_FOUND_OR_EXPIRED");
      await client.query("UPDATE wallet_nonces SET consumed_at=now() WHERE id=$1", [challenge.rows[0].id]);
      await client.query("UPDATE wallets SET is_primary=false WHERE user_id=$1", [session.user!.id]);
      const wallet = await client.query<{ id: string }>(
        `INSERT INTO wallets(user_id,chain_id,address,address_normalized,verified_at,is_primary)
         VALUES($1,4663,$2,$3,now(),true)
         ON CONFLICT(chain_id,address_normalized) DO UPDATE SET verified_at=now(),is_primary=true
         WHERE wallets.user_id=EXCLUDED.user_id RETURNING id`,
        [session.user!.id, address, address.toLowerCase()],
      );
      if (!wallet.rows[0]) throw new Error("WALLET_ALREADY_LINKED_TO_ANOTHER_ACCOUNT");
      return wallet.rows[0];
    });
    return NextResponse.json({ verified: true, walletId: result.id, address });
  } catch (error) {
    return NextResponse.json({ error: safeError(error) }, { status: 400 });
  }
}
