"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { robinhoodChain } from "@/lib/chain";

function short(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function walletDetails(name: string) {
  const normalized = name.toLowerCase();

  if (normalized.includes("walletconnect")) {
    return { title: "WalletConnect", detail: "Mobile or QR", mark: "WC" };
  }
  if (normalized.includes("metamask")) {
    return { title: "MetaMask", detail: "Extension or app", mark: "MM" };
  }
  if (normalized.includes("trust")) {
    return { title: "Trust Wallet", detail: "Extension or app", mark: "TW" };
  }
  if (normalized.includes("coinbase")) {
    return { title: "Coinbase Wallet", detail: "Extension or app", mark: "CB" };
  }
  if (normalized.includes("rabby")) {
    return { title: "Rabby Wallet", detail: "Browser extension", mark: "RB" };
  }
  if (normalized.includes("phantom")) {
    return { title: "Phantom", detail: "Extension or app", mark: "PH" };
  }

  return {
    title: normalized === "injected" ? "Browser wallet" : name,
    detail: "Detected wallet",
    mark: "BR",
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
  const chooserTitleId = useId();
  const uniqueConnectors = connectors.filter((connector, index, list) => {
    const identity = `${connector.name}:${connector.id}`.toLowerCase();
    return list.findIndex((candidate) => `${candidate.name}:${candidate.id}`.toLowerCase() === identity) === index;
  });
  const hasNamedWallet = uniqueConnectors.some((connector) => !["injected", "browser wallet"].includes(connector.name.toLowerCase()));
  const availableConnectors = uniqueConnectors.filter((connector) => !hasNamedWallet || !["injected", "browser wallet"].includes(connector.name.toLowerCase()));
  const hasWalletConnectConnector = availableConnectors.some((connector) => connector.name.toLowerCase().includes("walletconnect"));

  useEffect(() => {
    if (!open) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const walletBackdrop = open && typeof document !== "undefined"
    ? createPortal(<div className="wallet-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />, document.body)
    : null;

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
        <button className="wallet-pill" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog">
          <span className={chainId === robinhoodChain.id ? "wallet-dot" : "wallet-dot warning"} />{short(address)}
        </button>
        {open && <>
          {walletBackdrop}
          <div className="wallet-popover wallet-sheet wallet-connected-sheet" role="dialog" aria-modal="true" aria-labelledby={chooserTitleId}>
            <div className="wallet-sheet-head">
              <div>
                <span className="wallet-sheet-kicker">Wallet</span>
                <strong id={chooserTitleId}>Connected</strong>
              </div>
              <button className="wallet-sheet-close" type="button" aria-label="Close wallet menu" onClick={() => setOpen(false)}>×</button>
            </div>
            <div className="wallet-account-card">
              <span className="wallet-account-mark">{verified ? "✓" : "W"}</span>
              <div>
                <strong>{short(address)}</strong>
                <small>{chainId === robinhoodChain.id ? "Robinhood Chain · 4663" : "Switch to Robinhood Chain"}</small>
              </div>
              <span className={chainId === robinhoodChain.id ? "wallet-network-state" : "wallet-network-state warning"}>
                {chainId === robinhoodChain.id ? "Ready" : "Switch"}
              </span>
            </div>
            {!verified && <button className="button button-primary button-small wallet-verify-button" onClick={verify} disabled={busy}>{busy ? "Checking wallet…" : "Verify wallet"}</button>}
            {verified && <p className="wallet-status-card success-copy"><span>✓</span> Verified for this session</p>}
            {error && <p className="error-copy">{error}</p>}
            <button className="wallet-disconnect" type="button" onClick={() => { disconnect(); setOpen(false); setVerified(false); setError(""); }}>Disconnect wallet</button>
          </div>
        </>}
      </div>
    );
  }

  return (
    <div className="wallet-wrap">
      <button className="button button-quiet button-small" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog">Connect wallet</button>
      {open && <>
        {walletBackdrop}
        <div className="wallet-popover wallet-sheet" role="dialog" aria-modal="true" aria-labelledby={chooserTitleId}>
          <div className="wallet-sheet-head">
            <div>
              <span className="wallet-sheet-kicker">Robinhood Chain</span>
              <strong id={chooserTitleId}>Choose a wallet</strong>
            </div>
            <button className="wallet-sheet-close" type="button" aria-label="Close wallet chooser" onClick={() => setOpen(false)}>×</button>
          </div>
          <p className="wallet-sheet-copy">{hasWalletConnectConnector
            ? "Use an installed wallet or connect from your phone."
            : "Choose an installed EVM wallet to continue."}</p>
          <div className="wallet-option-list" aria-busy={isPending}>
            {availableConnectors.map((connector) => {
              const details = walletDetails(connector.name);
              return (
                <button className="wallet-option" key={connector.uid} disabled={isPending} onClick={() => connect({ connector, chainId: robinhoodChain.id })}>
                  <span className="wallet-option-icon" aria-hidden="true">{details.mark}</span>
                  <span className="wallet-option-copy"><strong>{details.title}</strong><small>{details.detail}</small></span>
                  <span className="wallet-option-arrow" aria-hidden="true">→</span>
                </button>
              );
            })}
          </div>
          <p className="wallet-sheet-foot"><span className="wallet-dot" /> Transactions stay in your wallet</p>
        </div>
      </>}
    </div>
  );
}
