"use client";

import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { WalletButton } from "@/components/wallet-button";

export function Header() {
  const { data: session, status } = useSession();
  const [menu, setMenu] = useState(false);
  const [xEnabled, setXEnabled] = useState(true);
  useEffect(() => { fetch("/api/config").then((r) => r.json()).then((data) => setXEnabled(Boolean(data.xAuth))).catch(() => undefined); }, []);
  return <header className="site-header"><div className="shell header-inner">
    <Logo />
    <nav className={menu ? "site-nav nav-open" : "site-nav"} aria-label="Main navigation">
      <Link href="/explore" onClick={() => setMenu(false)}>Explore</Link>
      <Link href="/create" onClick={() => setMenu(false)}>Create</Link>
      <Link href="/tournaments" onClick={() => setMenu(false)}>Tournaments</Link>
      <Link href="/how-it-works" onClick={() => setMenu(false)}>How it works</Link>
      <Link href="/docs" onClick={() => setMenu(false)}>Docs</Link>
      {status !== "loading" && (session
        ? <button className="mobile-nav-auth" onClick={() => { setMenu(false); signOut({ callbackUrl: "/" }); }}>Sign out @{session.user?.xUsername || "creator"}</button>
        : <button className="mobile-nav-auth" disabled={!xEnabled} onClick={() => signIn("twitter", { callbackUrl: "/dashboard" })}>{xEnabled ? "Sign in with X" : "X setup pending"}</button>)}
    </nav>
    <div className="header-actions">
      <WalletButton />
      {status !== "loading" && (session ? <Link className="account-button" href="/dashboard"><span>{session.user?.image ? <img src={session.user.image} alt="" /> : "@"}</span><b>@{session.user?.xUsername || "creator"}</b></Link> : <button className="button button-primary button-small" disabled={!xEnabled} title={!xEnabled ? "X OAuth credentials are required" : undefined} onClick={() => signIn("twitter", { callbackUrl: "/dashboard" })}>{xEnabled ? "Sign in with X" : "X setup pending"}</button>)}
      <button className="menu-button" onClick={() => setMenu((value) => !value)} aria-label="Toggle menu">{menu ? "Close" : "Menu"}</button>
    </div>
  </div></header>;
}
