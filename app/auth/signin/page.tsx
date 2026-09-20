"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";

export default function SignInPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => { fetch("/api/config").then((r) => r.json()).then((data) => setEnabled(Boolean(data.xAuth))).catch(() => setEnabled(false)); }, []);
  return <main className="shell narrow-page"><div className="auth-card"><span className="logo-mark large"><i /><i /><i /></span><span className="eyebrow">Creator access</span><h1>One verified X account. One launch credit.</h1><p>X gives the entitlement a durable account ID. Your username can change without creating another credit.</p><button className="button button-primary button-wide" disabled={!enabled} onClick={() => signIn("twitter", { callbackUrl: "/dashboard" })}>{enabled === null ? "Checking X…" : enabled ? "Continue with X" : "X OAuth setup required"}</button>{enabled === false && <div className="setup-callout"><b>Owner setup needed</b><p>The site is live, but X client credentials have not been added yet. No account is treated as verified until OAuth is connected.</p></div>}<Link href="/" className="text-button">← Back home</Link></div></main>;
}
