"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { robinhoodChain } from "@/lib/chain";

function short(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function WalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  const hasWalletConnectConnector = connectors.some((connector) => connector.name.includes("WalletConnect"));

  async function verify() {
    if (!address) return;
    setBusy(true); setError("");
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const challenge = await fetch("/api/wallet/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }) });
      const challengeBody = await challenge.json();
      if (!challenge.ok) throw new Error(challengeBody.error || "Could not create wallet challenge");
      const signature = await signMessageAsync({ message: challengeBody.message });
      const response = await fetch("/api/wallet/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, message: challengeBody.message, signature }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Wallet verification failed");
      setVerified(true); setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet verification failed");
    } finally { setBusy(false); }
  }

  if (isConnected && address) {
    return (
      <div className="wallet-wrap">
        <button className="wallet-pill" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          <span className={chainId === robinhoodChain.id ? "wallet-dot" : "wallet-dot warning"} />{short(address)}
        </button>
        {open && <div className="wallet-popover">
          <div><strong>{short(address)}</strong><small>{chainId === robinhoodChain.id ? "Robinhood Chain" : "Wrong network"}</small></div>
          {!verified && <button className="button button-primary button-small" onClick={verify} disabled={busy}>{busy ? "Check wallet…" : "Verify wallet"}</button>}
          {verified && <p className="success-copy">Wallet verified for this session.</p>}
          {error && <p className="error-copy">{error}</p>}
          <button className="text-button" onClick={() => disconnect()}>Disconnect</button>
        </div>}
      </div>
    );
  }

  return (
    <div className="wallet-wrap">
      <button className="button button-quiet button-small" onClick={() => setOpen((value) => !value)}>Connect wallet</button>
      {open && <div className="wallet-popover">
        <strong>Choose a wallet</strong>
        <p className="muted-copy">{hasWalletConnectConnector
          ? "Use an installed browser wallet, or scan with WalletConnect."
          : "Use an installed browser wallet such as MetaMask or Trust Wallet."}</p>
        {connectors.map((connector) => (
          <button className="wallet-option" key={connector.uid} disabled={isPending} onClick={() => connect({ connector, chainId: robinhoodChain.id })}>
            <span>{connector.name.includes("WalletConnect") ? "WalletConnect" : "Browser wallet"}</span><small>{connector.name.includes("WalletConnect") ? "Scan or deep link" : "MetaMask / Trust"}</small>
          </button>
        ))}
      </div>}
    </div>
  );
}
