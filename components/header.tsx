"use client";

import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { WalletButton } from "@/components/wallet-button";

export function Header() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const [xEnabled, setXEnabled] = useState<boolean | null>(null);
  const [xError, setXError] = useState(false);
  const verifiedX = status === "authenticated" && Boolean(session?.user?.xId);

  const loadXConfig = useCallback(async () => {
    setXEnabled(null);
    setXError(false);
    try {
      const response = await fetch("/api/config");
      if (!response.ok) throw new Error("Could not load X configuration");
      const data = await response.json();
      setXEnabled(Boolean(data.xAuth));
    } catch {
      setXEnabled(false);
      setXError(true);
    }
  }, []);

  useEffect(() => { void loadXConfig(); }, [loadXConfig]);

  const useX = () => {
    if (xError) void loadXConfig();
    else if (xEnabled) void signIn("twitter", { callbackUrl: pathname === "/" ? "/dashboard" : pathname });
  };
  const xLabel = xEnabled === null ? "Checking X…" : xEnabled ? "Sign up with X" : xError ? "Retry X" : "X setup pending";

  return <header className="site-header"><div className="shell header-inner">
    <Logo />
    <nav className={menu ? "site-nav nav-open" : "site-nav"} aria-label="Main navigation">
      <Link href="/explore" onClick={() => setMenu(false)}>Explore</Link>
      <Link href="/create" onClick={() => setMenu(false)}>Create</Link>
      <Link href="/dashboard" onClick={() => setMenu(false)}>My games</Link>
      <Link href="/how-it-works" onClick={() => setMenu(false)}>How it works</Link>
      <Link href="/walkthrough" onClick={() => setMenu(false)}>Walkthrough</Link>
      {status !== "loading" && (verifiedX
        ? <button className="mobile-nav-auth" onClick={() => { setMenu(false); void signOut({ callbackUrl: "/" }); }}>Sign out @{session?.user?.xUsername || "creator"}</button>
        : <button className="mobile-nav-auth" disabled={xEnabled === null || (!xEnabled && !xError)} onClick={useX}>{xLabel}</button>)}
    </nav>
    <div className="header-actions">
      <WalletButton />
      {status !== "loading" && (verifiedX
        ? <details className="account-menu">
          <summary className="account-button" aria-label={`Open account menu for @${session?.user?.xUsername || "creator"}`}>
            <span>{session?.user?.image ? <img src={session.user.image} alt="" /> : "@"}</span>
            <b>@{session?.user?.xUsername || "creator"}</b>
          </summary>
          <div className="account-menu-popover">
            <Link href="/dashboard">My games</Link>
            <Link href="/profile">Launch credit</Link>
            <button onClick={() => { void signOut({ callbackUrl: "/" }); }}>Sign out</button>
          </div>
        </details>
        : <button className="x-signup-button" disabled={xEnabled === null || (!xEnabled && !xError)} title={xEnabled === false && !xError ? "X OAuth credentials are required" : undefined} onClick={useX}><span aria-hidden="true">𝕏</span><b>{xLabel}</b></button>)}
      <Link className="button button-primary button-small" href="/create">Build a game</Link>
      <button className="menu-button" onClick={() => setMenu((value) => !value)} aria-label="Toggle menu" aria-expanded={menu}>{menu ? "Close" : "Menu"}</button>
    </div>
  </div></header>;
}
