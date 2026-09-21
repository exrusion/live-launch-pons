"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";

type PublicConfig = { xAuth?: boolean; freeLaunchRebate?: boolean };

export default function SignInPage() {
  const [config, setConfig] = useState<PublicConfig | null>(null);

  useEffect(() => {
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
    <main className="shell narrow-page">
      <section className="auth-card">
        <span className="logo-mark large" aria-hidden="true"><img src="/gamepad-logo.png" alt="" /></span>
        <span className="eyebrow">One-time creator credit</span>
        <h1>Launch your first game with X.</h1>
        <p>Verify one X account to unlock one Pons launch-fee credit. After confirmation, the verified launch fee is returned automatically; network gas still applies.</p>
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
