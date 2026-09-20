"use client";
import Link from "next/link";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { WalletButton } from "@/components/wallet-button";
export function Header() {
  const [menu, setMenu] = useState(false);
  return <header className="site-header"><div className="shell header-inner"><Logo />
    <nav className={menu ? "site-nav nav-open" : "site-nav"} aria-label="Main navigation"><Link href="/explore" onClick={() => setMenu(false)}>Explore</Link><Link href="/create" onClick={() => setMenu(false)}>Create</Link><Link href="/dashboard" onClick={() => setMenu(false)}>My games</Link><Link href="/how-it-works" onClick={() => setMenu(false)}>How it works</Link></nav>
    <div className="header-actions"><WalletButton /><Link className="button button-primary button-small" href="/create">Build a game</Link><button className="menu-button" onClick={() => setMenu((value) => !value)} aria-label="Toggle menu" aria-expanded={menu}>{menu ? "Close" : "Menu"}</button></div>
  </div></header>;
}
