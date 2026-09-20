"use client";

import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { WalletButton } from "@/components/wallet-button";

export function Header() {
  const { data: session, status } = useSession();
  const [menu, setMenu] = useState(false);
  const [xEnabled, setXEnabled] = useState<boolean | null>(null);
  const [xError, setXError] = useState(false);
  const loadXConfig = useCallback(async () => {
    setXEnabled(null); setXError(false);
    try {
      const response = await fetch("/api/config");
      if (!response.ok) throw new Error("Could not load X configuration");
      const data = await response.json();
      setXEnabled(Boolean(data.xAuth));
    } catch {
      setXEnabled(false); setXError(true);
    }
  }, []);
  useEffect(() => { void loadXConfig(); }, [loadXConfig]);
  const xLabel = xEnabled === null ? "Checking X…" : xEnabled ? "Sign in with X" : xError ? "Retry X" : "X setup pending";
  const useX = () => { if (xError) void loadXConfig(); else if (xEnabled) void signIn("twitter", { callbackUrl: "/dashboard" }); };
  return <header className="site-header"><div className="shell header-inner">
    <Logo />
    <nav className={menu ? "site-nav nav-open" : "site-nav"} aria-label="Main navigation">
      <Link href="/explore" onClick={() => setMenu(false)}>Explore</Link>
      <Link href="/create" onClick={() => setMenu(false)}>Create</Link>
      <Link href="/how-it-works" onClick={() => setMenu(false)}>How it works</Link>
      {status !== "loading" && (session
        ? <button className="mobile-nav-auth" onClick={() => { setMenu(false); signOut({ callbackUrl: "/" }); }}>Sign out @{session.user?.xUsername || "creator"}</button>
        : <button className="mobile-nav-auth" disabled={xEnabled === null || (!xEnabled && !xError)} onClick={useX}>{xLabel}</button>)}
    </nav>
    <div className="header-actions">
      <WalletButton />
      {status !== "loading" && (session ? <Link className="account-button" href="/dashboard"><span>{session.user?.image ? <img src={session.user.image} alt="" /> : "@"}</span><b>@{session.user?.xUsername || "creator"}</b></Link> : <button className="button button-primary button-small" disabled={xEnabled === null || (!xEnabled && !xError)} title={xEnabled === false && !xError ? "X OAuth credentials are required" : undefined} onClick={useX}>{xLabel}</button>)}
      <button className="menu-button" onClick={() => setMenu((value) => !value)} aria-label="Toggle menu" aria-expanded={menu}>{menu ? "Close" : "Menu"}</button>
    </div>
  </div></header>;
}
