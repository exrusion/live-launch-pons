"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { robinhoodChain } from "@/lib/chain";

function short(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function walletDetails(name: string) {
  const normalized = name.toLowerCase();

  if (normalized.includes("walletconnect")) {
    return { title: "WalletConnect", detail: "Scan QR or open a mobile wallet" };
  }
  if (normalized.includes("metamask")) {
    return { title: "MetaMask", detail: "Browser extension or mobile app" };
  }
  if (normalized.includes("trust")) {
    return { title: "Trust Wallet", detail: "Browser extension or mobile app" };
  }
  if (normalized.includes("coinbase")) {
    return { title: "Coinbase Wallet", detail: "Browser extension or mobile app" };
  }
  if (normalized.includes("rabby")) {
    return { title: "Rabby Wallet", detail: "Browser extension" };
  }

  return {
    title: normalized === "injected" ? "Browser wallet" : name,
    detail: "Installed wallet",
  };
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
  const availableConnectors = connectors.filter((connector, index, list) => {
    const identity = `${connector.name}:${connector.id}`.toLowerCase();
    return list.findIndex((candidate) => `${candidate.name}:${candidate.id}`.toLowerCase() === identity) === index;
  });
  const hasWalletConnectConnector = availableConnectors.some((connector) => connector.name.toLowerCase().includes("walletconnect"));

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
          ? "Choose an installed wallet, or connect from your phone with WalletConnect."
          : "Choose any compatible wallet installed in this browser."}</p>
        {availableConnectors.map((connector) => {
          const details = walletDetails(connector.name);
          return (
            <button className="wallet-option" key={connector.uid} disabled={isPending} onClick={() => connect({ connector, chainId: robinhoodChain.id })}>
              <span>{details.title}</span><small>{details.detail}</small>
            </button>
          );
        })}
      </div>}
    </div>
  );
}
