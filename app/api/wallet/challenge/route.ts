import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { attachCreatorCookie, ensureCreator } from "@/lib/auth";
import { query } from "@/lib/db";
import { makeNonce, requireSameOrigin, safeError, sha256 } from "@/lib/security";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const body = await request.json();
    if (!isAddress(body.address)) return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 });
    const creator = await ensureCreator(request);
    const session = creator.session;
    const address = getAddress(body.address);
    const nonce = makeNonce(18);
    const domain = request.nextUrl.host;
    const uri = request.nextUrl.origin;
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 10 * 60 * 1000);
    const message = `${domain} wants you to connect this wallet to Pons Game Studio:\n${address}\n\nVerify wallet ownership. This does not submit a transaction or cost gas.\n\nURI: ${uri}\nVersion: 1\nChain ID: 4663\nNonce: ${nonce}\nIssued At: ${issuedAt.toISOString()}\nExpiration Time: ${expiresAt.toISOString()}`;
    await query(
      "INSERT INTO wallet_nonces(user_id,address_normalized,nonce_hash,domain,message,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
      [session.user.id, address.toLowerCase(), sha256(nonce), domain, message, expiresAt],
    );
    return attachCreatorCookie(
      NextResponse.json({ message, expiresAt: expiresAt.toISOString() }, { headers: { "Cache-Control": "no-store" } }),
      creator.cookie,
    );
  } catch (error) {
    return NextResponse.json({ error: safeError(error) }, { status: 400 });
  }
}
