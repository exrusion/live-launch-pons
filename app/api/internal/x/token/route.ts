import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CALLBACK_URL = "https://gamepad.markets/api/auth/callback/twitter";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";

function secretsMatch(expected: string, provided: string) {
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length > 0
    && expectedBytes.length === providedBytes.length
    && timingSafeEqual(expectedBytes, providedBytes);
}

export async function POST(request: Request) {
  const expectedBrokerSecret = process.env.GAMEPAD_X_BROKER_SECRET?.trim() || "";
  const providedBrokerSecret = (request.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "");
  if (!secretsMatch(expectedBrokerSecret, providedBrokerSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const body = input as Record<string, unknown>;
  const code = typeof body.code === "string" ? body.code : "";
  const redirectUri = typeof body.redirectUri === "string" ? body.redirectUri : "";
  const codeVerifier = typeof body.codeVerifier === "string" ? body.codeVerifier : "";
  if (
    !code
    || code.length > 4096
    || redirectUri !== CALLBACK_URL
    || codeVerifier.length < 43
    || codeVerifier.length > 128
  ) {
    return NextResponse.json({ error: "Invalid token request" }, { status: 400 });
  }

  const clientId = process.env.X_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.X_CLIENT_SECRET?.trim() || "";
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "X OAuth is not configured" }, { status: 503 });
  }

  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
    cache: "no-store",
  });

  const tokenBody = await tokenResponse.text();
  return new NextResponse(tokenBody, {
    status: tokenResponse.status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}
