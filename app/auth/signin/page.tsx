"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";

type PublicConfig = { xAuth?: boolean; freeLaunchRebate?: boolean };

export default function SignInPage() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    setAuthError(new URLSearchParams(window.location.search).has("error"));
    fetch("/api/config", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: PublicConfig) => setConfig(data))
      .catch(() => setConfig({ xAuth: false, freeLaunchRebate: false }));
  }, []);

  const enabled = config?.xAuth === true;
  function continueWithX() {
    const requested = new URLSearchParams(window.location.search).get("callbackUrl");
    const callbackUrl = requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/dashboard";
    void signIn("twitter", { callbackUrl });
  }
  return (
    <main className="shell narrow-page auth-page">
      <section className="auth-card">
        <div className="auth-brand-lockup">
          <span className="logo-mark large" aria-hidden="true"><img src="/gamepad-logo.png" alt="" /></span>
          <span className="eyebrow">One free creator launch</span>
        </div>
        <h1>Launch your first game with X.</h1>
        <p>Verify one X account to unlock one free Pons launch. The platform wallet pays the launch fee and network gas; your connected wallet stays the creator recipient.</p>
        <div className="state-row" aria-label="How the launch credit works">
          <span>Sign in</span><i>→</i><span>Build</span><i>→</i><span>Launch</span>
        </div>
        <button
          className="button button-primary button-wide"
          disabled={config === null || !enabled}
          onClick={continueWithX}
        >
          {config === null ? "Checking X…" : enabled ? "Continue with X" : "X sign-in unavailable"}
        </button>
        {authError ? (
          <p className="auth-error" role="alert">X could not complete sign-in. Please try once more.</p>
        ) : null}
        {config && !enabled ? (
          <div className="setup-callout">
            <b>Owner setup needed</b>
            <p>Add the X OAuth client ID and secret on the server to enable verified sign-ups.</p>
          </div>
        ) : null}
        {config?.xAuth && !config.freeLaunchRebate ? (
          <div className="setup-callout">
            <b>Credit ready, sponsorship pending</b>
            <p>Your account can be verified now. The launch credit becomes redeemable when the sponsor wallet is enabled.</p>
          </div>
        ) : null}
        <Link href="/" className="text-button">← Back home</Link>
      </section>
    </main>
  );
}
