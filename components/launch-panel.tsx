"use client";

import { useEffect, useState } from "react";
import { useAccount, useSignMessage, useSwitchChain, useWriteContract } from "wagmi";
import { formatEther, getAddress, type Address } from "viem";
import { PONS_FACTORY_ABI } from "@/lib/pons-abi";
import { robinhoodChain } from "@/lib/chain";

type Quote = {
  launchId: string; walletAddress: Address; factory: Address; args: [Record<string, unknown>, string, Address]; value: string; quoteExpiresAt: string;
  costs: { launchFeeWei: string; developerBuyWei: string; gas: string };
  freeCredit: { requested: boolean; sponsorReady: boolean; method: string | null };
  config: { supply: string; curveFeeBps: string; graduationThreshold: string };
};

const SIGNING_SAFETY_BUFFER_MS = 2 * 60 * 1000;

export function LaunchPanel({ gameId, creditStatus, sponsorReady }: { gameId: string; creditStatus?: string; sponsorReady: boolean }) {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const [verified, setVerified] = useState(false);
  const [useCredit, setUseCredit] = useState(creditStatus === "AVAILABLE" && sponsorReady);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [status, setStatus] = useState("Ready for wallet verification");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [confirmedToken, setConfirmedToken] = useState("");
  const [rebateStatus, setRebateStatus] = useState("");
  const [rebateTxHash, setRebateTxHash] = useState("");

  useEffect(() => { setVerified(false); setQuote(null); }, [isConnected, address]);
  useEffect(() => {
    if (!isConnected || !address) return;
    const walletKey = `pons-launch-quote:${gameId}:${address.toLowerCase()}`;
    const legacyKey = `pons-launch-quote:${gameId}`;
    try {
      const saved = localStorage.getItem(walletKey) || localStorage.getItem(legacyKey);
      if (!saved) return;
      const restored = JSON.parse(saved) as Quote;
      if (!restored.launchId || !restored.walletAddress || getAddress(restored.walletAddress) !== getAddress(address)) {
        localStorage.removeItem(walletKey);
        localStorage.removeItem(legacyKey);
        return;
      }
      const savedHash = localStorage.getItem(`pons-launch-tx:${restored.launchId}`);
      if (savedHash) {
        setQuote(restored);
        setVerified(true);
        setTxHash(savedHash);
        setStatus("Recovering your submitted launch…");
        recordSubmission(restored, savedHash).catch((cause) => setError(cause instanceof Error ? cause.message : "Recovery will retry when this page opens again."));
        return;
      }
      if (Date.now() >= new Date(restored.quoteExpiresAt).getTime()) {
        localStorage.removeItem(walletKey);
        localStorage.removeItem(legacyKey);
        return;
      }
      setQuote(restored);
      setVerified(true);
      if (localStorage.getItem(legacyKey)) {
        localStorage.setItem(walletKey, saved);
        localStorage.removeItem(legacyKey);
      }
    } catch {
      localStorage.removeItem(walletKey);
      localStorage.removeItem(legacyKey);
    }
  // Wallet binding prevents a restored quote from being signed by another account.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, isConnected, address]);

  async function trackLaunch(activeQuote: Quote) {
    let launchConfirmed = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const check = await fetch(`/api/launches/${activeQuote.launchId}`, { cache: "no-store" });
      const data = await check.json();
      if (data.launch?.status === "CONFIRMED") {
        launchConfirmed = true;
        setConfirmedToken(data.launch.token_address);
        setRebateStatus(data.launch.rebate_status || "");
        setRebateTxHash(data.launch.rebate_tx_hash || "");
        try {
          localStorage.removeItem(`pons-launch-quote:${gameId}:${activeQuote.walletAddress.toLowerCase()}`);
          localStorage.removeItem(`pons-launch-quote:${gameId}`);
          localStorage.removeItem(`pons-launch-tx:${activeQuote.launchId}`);
        } catch {}
        if (!activeQuote.freeCredit.requested) { setStatus("Launch confirmed through the official pons factory."); return; }
        if (data.launch.rebate_status === "SENT") { setStatus("Launch confirmed and the exact pons fee was reimbursed."); return; }
        if (data.launch.rebate_status === "FAILED") {
          setStatus("Launch confirmed. The reimbursement needs operator attention.");
          setError(data.launch.rebate_error_detail || "The failed reimbursement is recorded and visible to operators.");
          return;
        }
        setStatus(data.launch.rebate_status === "SENDING" ? "Launch confirmed. Reimbursement sent; waiting for confirmations…" : "Launch confirmed. Reimbursement queued…");
      }
      if (data.launch?.status === "FAILED") throw new Error(data.launch.error_detail || "On-chain verification failed");
    }
    setStatus(launchConfirmed ? "Launch confirmed. Reimbursement processing continues safely in the background." : "Still confirming. You can safely leave this page and check the dashboard later.");
  }

  async function recordSubmission(activeQuote: Quote, hash: string) {
    const submitted = await fetch(`/api/launches/${activeQuote.launchId}/submitted`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transactionHash: hash }) });
    const submittedBody = await submitted.json();
    if (!submitted.ok) throw new Error(submittedBody.error || "Could not record transaction");
    const rebateEligible = submittedBody.rebate?.eligible !== false;
    const trackedQuote = rebateEligible ? activeQuote : { ...activeQuote, freeCredit: { ...activeQuote.freeCredit, requested: false } };
    if (activeQuote.freeCredit.requested && !rebateEligible) {
      setError(submittedBody.rebate?.reason || "The transaction is recorded, but this launch no longer has a fee reimbursement attached.");
    }
    setQuote(trackedQuote);
    await trackLaunch(trackedQuote);
  }

  async function verifyWallet() {
    if (!address) return;
    setBusy(true); setError(""); setStatus("Waiting for wallet signature…");
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const challenge = await fetch("/api/wallet/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }) });
      const data = await challenge.json(); if (!challenge.ok) throw new Error(data.error || "Challenge failed");
      const signature = await signMessageAsync({ message: data.message });
      const response = await fetch("/api/wallet/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, message: data.message, signature }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Verification failed");
      setVerified(true); setStatus("Wallet verified. Read the live launch quote next.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Wallet verification failed"); setStatus("Verification stopped"); }
    finally { setBusy(false); }
  }

  async function getQuote() {
    if (!address) return;
    setBusy(true); setError(""); setStatus("Reading pons V2 contracts…");
    try {
      const response = await fetch(`/api/games/${gameId}/launch/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: address, useFreeCredit: useCredit, idempotencyKey: crypto.randomUUID() }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not prepare launch");
      setQuote(body); setStatus("Live quote ready. Your wallet will show the exact transaction before approval.");
      try { localStorage.setItem(`pons-launch-quote:${gameId}:${address.toLowerCase()}`, JSON.stringify(body)); } catch {}
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not prepare launch"); setStatus("Quote failed"); }
    finally { setBusy(false); }
  }

  async function launch() {
    if (!quote || !address) return;
    if (getAddress(quote.walletAddress) !== getAddress(address)) {
      setQuote(null); setVerified(false);
      setError("This quote belongs to a different wallet. Verify the connected wallet and read a new quote.");
      setStatus("Wallet changed");
      return;
    }
    if (Date.now() + SIGNING_SAFETY_BUFFER_MS >= new Date(quote.quoteExpiresAt).getTime()) {
      setQuote(null);
      setError("This quote is too close to expiry to sign safely. Read a fresh quote so the economics and reimbursement stay pinned.");
      setStatus("Fresh quote required");
      return;
    }
    setBusy(true); setError(""); setStatus("Confirm the pons launch in your wallet…");
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const params = quote.args[0] as never;
      const hash = await writeContractAsync({ address: getAddress(quote.factory), abi: PONS_FACTORY_ABI, functionName: "launchToken", args: [params, BigInt(quote.args[1]), getAddress(quote.args[2])], value: BigInt(quote.value), chainId: robinhoodChain.id });
      setTxHash(hash); setStatus("Transaction submitted. Waiting for independent on-chain verification…");
      try { localStorage.setItem(`pons-launch-tx:${quote.launchId}`, hash); } catch {}
      await recordSubmission(quote, hash);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Launch failed"); setStatus("Launch stopped. The draft and free credit are preserved unless a launch confirmed."); }
    finally { setBusy(false); }
  }

  return <div className="launch-panel">
    <div className="launch-panel-head"><div><span className="live-dot" />Live pons V2</div><small>Robinhood Chain · user-signed</small></div>
    <div className="launch-status"><span>{confirmedToken ? "✓" : busy ? "…" : "→"}</span><div><b>{status}</b>{address && <small>{address.slice(0, 8)}…{address.slice(-6)}</small>}</div></div>
    {!sponsorReady && creditStatus === "AVAILABLE" && <div className="credit-warning"><b>Free credit protected</b><p>The reimbursement wallet is not funded yet. You can keep the credit and launch by paying the live pons fee yourself.</p></div>}
    {creditStatus === "AVAILABLE" && <label className="switch-row"><input type="checkbox" checked={useCredit} disabled={!sponsorReady || Boolean(quote)} onChange={(event) => setUseCredit(event.target.checked)} /><span><b>Use free launch credit</b><small>{sponsorReady ? "Verified pons fee reimbursed after confirmation" : "Awaiting sponsor funding"}</small></span></label>}
    {quote && <div className="cost-card"><div><span>pons launch fee</span><b>{formatEther(BigInt(quote.costs.launchFeeWei))} ETH</b></div><div><span>Network gas</span><b>{quote.costs.gas}</b></div><div><span>Curve trade fee</span><b>{Number(quote.config.curveFeeBps) / 100}%</b></div><div><span>Graduation target</span><b>{formatEther(BigInt(quote.config.graduationThreshold))} ETH</b></div></div>}
    <div className="risk-copy">pons V2 audits are still in progress. Tokens are volatile. Check the target, value, and chain in your wallet before approval.</div>
    {error && <p className="error-copy">{error}</p>}
    {txHash && <a className="tx-link" href={`https://robinhoodchain.blockscout.com/tx/${txHash}`} target="_blank" rel="noreferrer">View submitted transaction ↗</a>}
    {rebateStatus && <div className={rebateStatus === "FAILED" ? "failure-card" : "credit-warning"}><b>Fee reimbursement: {rebateStatus.toLowerCase()}</b><p>{rebateStatus === "SENT" ? "The exact verified launch fee was returned after two confirmations." : rebateStatus === "FAILED" ? "The launch remains live; this payout is recorded for operator review." : "The durable worker will resume this payout if it is interrupted."}</p></div>}
    {rebateTxHash && <a className="tx-link" href={`https://robinhoodchain.blockscout.com/tx/${rebateTxHash}`} target="_blank" rel="noreferrer">View reimbursement transaction ↗</a>}
    {confirmedToken && <a className="button button-primary button-wide" href={`/game/${confirmedToken}`}>Open permanent game page</a>}
    {!confirmedToken && <div className="launch-actions">{!isConnected ? <p className="muted-copy">Connect a wallet from the top bar first.</p> : !verified ? <button className="button button-primary button-wide" disabled={busy} onClick={verifyWallet}>{busy ? "Verifying…" : "Verify connected wallet"}</button> : !quote ? <button className="button button-primary button-wide" disabled={busy} onClick={getQuote}>{busy ? "Reading contracts…" : "Read exact launch cost"}</button> : <button className="button button-primary button-wide" disabled={busy} onClick={launch}>{busy ? "Waiting…" : "Launch game and token"}</button>}</div>}
  </div>;
}
