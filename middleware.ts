import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  const isEmbed = request.nextUrl.pathname.startsWith("/embed/");
  let csp: string | null = null;
  if (!isEmbed) {
    csp = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://rpc.mainnet.chain.robinhood.com https://*.walletconnect.com wss://*.walletconnect.com wss://relay.walletconnect.org https://api.web3modal.org https://rpc.walletconnect.org https://pulse.walletconnect.org https://secure.walletconnect.org",
      "frame-src 'self' https://verify.walletconnect.com https://secure.walletconnect.org",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; ");
    // Next reads the request CSP to discover and apply the nonce to its own
    // bootstrap scripts. The same policy is returned to the browser below.
    requestHeaders.set("Content-Security-Policy", csp);
  }
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (csp) {
    response.headers.set("Content-Security-Policy", csp);
  }
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  if (!isEmbed) response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.svg).*)"] };
