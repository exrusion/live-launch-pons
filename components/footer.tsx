import Link from "next/link";
import { Logo } from "@/components/logo";

export function Footer() {
  return <footer className="site-footer"><div className="shell footer-grid">
    <div><Logo /><p>Independent game interface built on the public pons protocol. Not operated by or endorsed by Pons Labs.</p></div>
    <div><strong>Build</strong><Link href="/create">Create a game</Link><Link href="/explore">Explore games</Link><Link href="/dashboard">Creator dashboard</Link></div>
    <div><strong>Read</strong><Link href="/how-it-works">How it works</Link><Link href="/docs">Documentation</Link><a href="https://docs.ponsfamily.com/v2" target="_blank" rel="noreferrer">pons V2 docs</a></div>
    <div><strong>Legal</strong><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><span>Robinhood Chain · 4663</span></div>
  </div><div className="shell footer-bottom"><span>© 2026 pons game studio</span><span>Every launch is signed by your wallet.</span></div></footer>;
}
