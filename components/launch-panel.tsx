"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useSignMessage, useSwitchChain, useWriteContract } from "wagmi";
import { formatEther, getAddress, type Address } from "viem";
import { PONS_FACTORY_ABI } from "@/lib/pons-abi";
import { robinhoodChain } from "@/lib/chain";

type Quote = {
  sponsored: false; launchId: string; walletAddress: Address; factory: Address; args: [Record<string, unknown>, string, Address]; value: string; quoteExpiresAt: string;
  costs: { launchFeeWei: string; developerBuyWei: string; gas: string };
  freeCredit: { requested: boolean; sponsorReady: boolean; method: string | null };
  config: { supply: string; curveFeeBps: string; graduationThreshold: string };
};

export type LaunchState = {
  id: string;
  status: string;
  transactionHash: string | null;
  tokenAddress: string | null;
  errorDetail: string | null;
  tradingUrl: string | null;
  quoteExpiresAt: string | null;
  freeCreditRequested: boolean;
  sponsoredLaunch: boolean;
  rebateStatus: string | null;
  rebateTxHash: string | null;
  rebateErrorDetail: string | null;
};

type SavedLaunch = {
  id: string;
  status: string;
  transaction_hash?: string | null;
  token_address?: string | null;
  error_detail?: string | null;
  quote_expires_at?: string | null;
  free_credit_id?: string | null;
  sponsored_launch?: boolean;
  rebate_status?: string | null;
  rebate_tx_hash?: string | null;
  rebate_error_detail?: string | null;
};

const SIGNING_SAFETY_BUFFER_MS = 2 * 60 * 1000;
const ACTIVE_LAUNCH_STATUSES = new Set(["QUOTING", "AWAITING_SIGNATURE", "SUBMITTED", "CONFIRMING", "CONFIRMED"]);
const POLLING_LAUNCH_STATUSES = new Set(["SUBMITTED", "CONFIRMING"]);
const RECOVERABLE_QUOTE_STATUSES = new Set(["AWAITING_SIGNATURE", "EXPIRED"]);

function savedLaunchState(savedLaunch: SavedLaunch, requestedCredit = false, fallbackTradingUrl: string | null = null): LaunchState {
  const tokenAddress = savedLaunch.token_address || null;
  return {
    id: savedLaunch.id,
    status: savedLaunch.status,
    transactionHash: savedLaunch.transaction_hash || null,
    tokenAddress,
    errorDetail: savedLaunch.error_detail || null,
    tradingUrl: tokenAddress ? `https://www.ponsfamily.com/launchpad/${tokenAddress}` : fallbackTradingUrl,
    quoteExpiresAt: savedLaunch.quote_expires_at || null,
    freeCreditRequested: Boolean(savedLaunch.free_credit_id) || requestedCredit,
    sponsoredLaunch: Boolean(savedLaunch.sponsored_launch),
    rebateStatus: savedLaunch.rebate_status || null,
    rebateTxHash: savedLaunch.rebate_tx_hash || null,
    rebateErrorDetail: savedLaunch.rebate_error_detail || null,
  };
}

function launchStatusCopy(launch: LaunchState | null) {
  if (!launch) return "Ready for wallet verification";
  if (launch.status === "CONFIRMED" && launch.sponsoredLaunch) return "Free launch confirmed. The platform wallet paid the Pons fee and network gas.";
  if (launch.status === "CONFIRMED") return launch.rebateStatus === "SENT"
    ? "Launch confirmed and the exact pons fee was reimbursed."
    : launch.rebateStatus === "FAILED"
      ? "Launch confirmed. The reimbursement needs operator attention."
      : launch.freeCreditRequested
        ? "Launch confirmed. Reimbursement processing continues safely in the background."
        : "Launch confirmed through the official pons factory.";
  if (launch.status === "CONFIRMING") return launch.sponsoredLaunch ? "Platform launch found. Waiting for on-chain confirmations…" : "Transaction found. Waiting for on-chain confirmations…";
  if (launch.status === "SUBMITTED") return launch.sponsoredLaunch ? "Platform wallet submitted the free launch. Waiting for confirmations…" : "Transaction submitted. Waiting for independent on-chain verification…";
  if (launch.status === "AWAITING_SIGNATURE") return launch.sponsoredLaunch ? "Platform wallet is preparing your free launch…" : "A live launch quote is already reserved for this game.";
  if (launch.status === "QUOTING") return "A launch quote is already being prepared for this game.";
  if (launch.status === "FAILED") return "The last launch failed. Verify your wallet to try again.";
  if (launch.status === "EXPIRED") return "The previous quote expired. Verify your wallet for a fresh quote.";
  return "Ready for wallet verification";
}

export function LaunchPanel({ gameId, creditStatus, sponsorReady, initialLaunch }: { gameId: string; creditStatus?: string; sponsorReady: boolean; initialLaunch: LaunchState | null }) {
  const router = useRouter();
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const submissionRecoveryRef = useRef<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [useCredit, setUseCredit] = useState(creditStatus === "AVAILABLE" && sponsorReady);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [launchState, setLaunchState] = useState<LaunchState | null>(initialLaunch);
  const [status, setStatus] = useState(() => launchStatusCopy(initialLaunch));
  const [error, setError] = useState(() => initialLaunch?.status === "FAILED" ? initialLaunch.errorDetail || "On-chain verification failed." : initialLaunch?.rebateStatus === "FAILED" ? initialLaunch.rebateErrorDetail || "The reimbursement is recorded for operator review." : "");
  const [busy, setBusy] = useState(false);
  const [recoveringSubmission, setRecoveringSubmission] = useState(false);
  const [txHash, setTxHash] = useState(initialLaunch?.transactionHash || "");
  const [confirmedToken, setConfirmedToken] = useState(initialLaunch?.tokenAddress || "");
  const [tradingUrl, setTradingUrl] = useState(initialLaunch?.tradingUrl || "");
  const [rebateStatus, setRebateStatus] = useState(initialLaunch?.rebateStatus || "");
  const [rebateTxHash, setRebateTxHash] = useState(initialLaunch?.rebateTxHash || "");
  const hasActiveLaunch = Boolean(launchState && ACTIVE_LAUNCH_STATUSES.has(launchState.status));
  const isAwaitingSignature = launchState?.status === "AWAITING_SIGNATURE";
  const isPollingLaunch = Boolean(launchState && (POLLING_LAUNCH_STATUSES.has(launchState.status) || (launchState.sponsoredLaunch && launchState.status === "AWAITING_SIGNATURE")));
  const isConfirmed = launchState?.status === "CONFIRMED";

  function applyLaunchState(nextLaunch: LaunchState) {
    setLaunchState(nextLaunch);
    setTxHash((current) => nextLaunch.transactionHash || (RECOVERABLE_QUOTE_STATUSES.has(nextLaunch.status) ? current : ""));
    setConfirmedToken(nextLaunch.tokenAddress || "");
    setTradingUrl(nextLaunch.tradingUrl || "");
    setRebateStatus(nextLaunch.rebateStatus || "");
    setRebateTxHash(nextLaunch.rebateTxHash || "");
  }

  useEffect(() => { setVerified(false); setQuote(null); }, [isConnected, address]);

  useEffect(() => {
    if (creditStatus === "AVAILABLE") setUseCredit(sponsorReady);
  }, [creditStatus, sponsorReady]);

  useEffect(() => {
    setLaunchState(initialLaunch);
    setStatus(launchStatusCopy(initialLaunch));
    setError(initialLaunch?.status === "FAILED" ? initialLaunch.errorDetail || "On-chain verification failed." : initialLaunch?.rebateStatus === "FAILED" ? initialLaunch.rebateErrorDetail || "The reimbursement is recorded for operator review." : "");
    setTxHash((current) => initialLaunch?.transactionHash || (initialLaunch && RECOVERABLE_QUOTE_STATUSES.has(initialLaunch.status) ? current : ""));
    setConfirmedToken(initialLaunch?.tokenAddress || "");
    setTradingUrl(initialLaunch?.tradingUrl || "");
    setRebateStatus(initialLaunch?.rebateStatus || "");
    setRebateTxHash(initialLaunch?.rebateTxHash || "");
    if (initialLaunch?.status !== "AWAITING_SIGNATURE" && initialLaunch?.status !== "EXPIRED") setQuote(null);
  }, [gameId, initialLaunch?.id, initialLaunch?.status, initialLaunch?.transactionHash, initialLaunch?.tokenAddress, initialLaunch?.errorDetail, initialLaunch?.tradingUrl, initialLaunch?.quoteExpiresAt, initialLaunch?.freeCreditRequested, initialLaunch?.sponsoredLaunch, initialLaunch?.rebateStatus, initialLaunch?.rebateTxHash, initialLaunch?.rebateErrorDetail]);

  useEffect(() => {
    if (!launchState || (!POLLING_LAUNCH_STATUSES.has(launchState.status) && !(launchState.status === "CONFIRMED" && !launchState.sponsoredLaunch && ["PENDING", "SENDING"].includes(launchState.rebateStatus || "")))) return;
    let cancelled = false;
    const activeQuote = quote?.launchId === launchState.id ? quote : undefined;
    trackLaunch(launchState.id, launchState.freeCreditRequested, activeQuote, () => cancelled).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Launch recovery will retry when this page opens again.");
    });
    return () => { cancelled = true; };
  // Primitive dependencies keep one loop per durable state transition. Repeated
  // snapshots with the same status do not start a second loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchState?.id, launchState?.status, launchState?.rebateStatus, quote?.launchId]);

  useEffect(() => {
    if (!launchState || !["QUOTING", "AWAITING_SIGNATURE"].includes(launchState.status)) return;
    let cancelled = false;
    async function refreshReservedQuote() {
      try {
        const response = await fetch(`/api/launches/${launchState!.id}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || cancelled || !data.launch) return;
        const refreshed = savedLaunchState(data.launch, launchState!.freeCreditRequested, launchState!.tradingUrl);
        if (refreshed.status !== launchState!.status || refreshed.transactionHash || refreshed.tokenAddress) {
          applyLaunchState(refreshed);
          setStatus(launchStatusCopy(refreshed));
          if (refreshed.status === "FAILED") setError(refreshed.errorDetail || "On-chain verification failed.");
          if (["FAILED", "CONFIRMED"].includes(refreshed.status) || (refreshed.status === "EXPIRED" && !txHash)) router.refresh();
        } else if (refreshed.quoteExpiresAt && Date.now() >= new Date(refreshed.quoteExpiresAt).getTime()) {
          setStatus("This quote has expired. Waiting for the saved reservation to unlock…");
        }
      } catch {
        // The database worker remains authoritative. A transient refresh failure
        // must not make the client offer a conflicting quote.
      }
    }
    if (launchState.quoteExpiresAt && Date.now() >= new Date(launchState.quoteExpiresAt).getTime()) void refreshReservedQuote();
    const interval = window.setInterval(refreshReservedQuote, 5000);
    return () => { cancelled = true; window.clearInterval(interval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchState?.id, launchState?.status, launchState?.quoteExpiresAt]);

  useEffect(() => {
    if (!isConnected || !address) return;
    const walletKey = `pons-launch-quote:${gameId}:${address.toLowerCase()}`;
    const legacyKey = `pons-launch-quote:${gameId}`;
    try {
      const saved = localStorage.getItem(walletKey) || localStorage.getItem(legacyKey);
      if (!saved) return;
      const restored = JSON.parse(saved) as Quote;
      if (!restored.launchId || !restored.walletAddress || getAddress(restored.walletAddress) !== getAddress(address) || !launchState || restored.launchId !== launchState.id) {
        localStorage.removeItem(walletKey);
        localStorage.removeItem(legacyKey);
        return;
      }
      const savedHash = localStorage.getItem(`pons-launch-tx:${restored.launchId}`);
      if (savedHash && RECOVERABLE_QUOTE_STATUSES.has(launchState.status)) {
        setQuote(restored);
        setVerified(true);
        setTxHash(savedHash);
        setStatus("Recovering your submitted launch…");
        void recoverSubmission(restored, savedHash);
        return;
      }
      if (launchState.status !== "AWAITING_SIGNATURE") {
        localStorage.removeItem(walletKey);
        localStorage.removeItem(legacyKey);
        if (launchState.transactionHash) localStorage.removeItem(`pons-launch-tx:${restored.launchId}`);
        setQuote(null);
        return;
      }
      if (Date.now() >= new Date(restored.quoteExpiresAt).getTime()) {
        localStorage.removeItem(walletKey);
        localStorage.removeItem(legacyKey);
        setQuote(null);
        setStatus("This quote has expired. Waiting for the saved reservation to unlock…");
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
  }, [gameId, isConnected, address, launchState?.id, launchState?.status, launchState?.transactionHash]);

  async function trackLaunch(launchId: string, requestedCredit: boolean, activeQuote?: Quote, isCancelled: () => boolean = () => false) {
    let launchConfirmed = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 4000));
      if (isCancelled()) return;
      const check = await fetch(`/api/launches/${launchId}`, { cache: "no-store" });
      const data = await check.json();
      if (!check.ok) throw new Error(data.error || "Could not read the saved launch state");
      if (isCancelled()) return;
      const savedLaunch = data.launch as SavedLaunch;
      if (!savedLaunch) throw new Error("The saved launch could not be found");
      const nextLaunch = savedLaunchState(savedLaunch, requestedCredit);
      applyLaunchState(nextLaunch);
      if (savedLaunch.status === "CONFIRMED") {
        launchConfirmed = true;
        if (!isConfirmed) router.refresh();
        if (activeQuote) {
          try {
            localStorage.removeItem(`pons-launch-quote:${gameId}:${activeQuote.walletAddress.toLowerCase()}`);
            localStorage.removeItem(`pons-launch-quote:${gameId}`);
            localStorage.removeItem(`pons-launch-tx:${launchId}`);
          } catch {}
        }
        if (nextLaunch.sponsoredLaunch) { setStatus("Free launch confirmed. The platform wallet paid the Pons fee and network gas."); return; }
        if (!nextLaunch.freeCreditRequested) { setStatus("Launch confirmed through the official pons factory."); return; }
        if (savedLaunch.rebate_status === "SENT") { setStatus("Launch confirmed and the exact pons fee was reimbursed."); return; }
        if (savedLaunch.rebate_status === "FAILED") {
          setStatus("Launch confirmed. The reimbursement needs operator attention.");
          setError(savedLaunch.rebate_error_detail || "The failed reimbursement is recorded and visible to operators.");
          return;
        }
        setStatus(savedLaunch.rebate_status === "SENDING" ? "Launch confirmed. Reimbursement sent; waiting for confirmations…" : "Launch confirmed. Reimbursement queued…");
      }
      if (savedLaunch.status === "CONFIRMING") setStatus(nextLaunch.sponsoredLaunch ? "Platform launch found. Waiting for on-chain confirmations…" : "Transaction found. Waiting for on-chain confirmations…");
      if (savedLaunch.status === "SUBMITTED") setStatus(nextLaunch.sponsoredLaunch ? "Platform wallet submitted the free launch. Waiting for confirmations…" : "Transaction submitted. Waiting for independent on-chain verification…");
      if (savedLaunch.status === "FAILED") {
        setQuote(null);
        setStatus("The last launch failed. Verify your wallet to try again.");
        router.refresh();
        throw new Error(savedLaunch.error_detail || "On-chain verification failed");
      }
    }
    setStatus(launchConfirmed ? "Launch confirmed. Reimbursement processing continues safely in the background." : "Still confirming. You can safely leave this page and check the dashboard later.");
  }

  async function recoverSubmission(activeQuote: Quote, hash: string) {
    const recoveryKey = `${activeQuote.launchId}:${hash.toLowerCase()}`;
    if (submissionRecoveryRef.current === recoveryKey) return;
    submissionRecoveryRef.current = recoveryKey;
    setRecoveringSubmission(true);
    setError("");
    setStatus("Recovering your submitted launch…");
    try {
      await recordSubmission(activeQuote, hash);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not attach the submitted transaction yet.");
      setStatus("Your transaction hash is saved. Resume recovery without sending another transaction.");
    } finally {
      if (submissionRecoveryRef.current === recoveryKey) submissionRecoveryRef.current = null;
      setRecoveringSubmission(false);
    }
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
    setLaunchState((current) => ({
      id: activeQuote.launchId,
      status: "SUBMITTED",
      transactionHash: hash,
      tokenAddress: current?.tokenAddress || null,
      errorDetail: null,
      tradingUrl: current?.tradingUrl || null,
      quoteExpiresAt: current?.quoteExpiresAt || activeQuote.quoteExpiresAt,
      freeCreditRequested: trackedQuote.freeCredit.requested,
      sponsoredLaunch: false,
      rebateStatus: current?.rebateStatus || "NOT_APPLICABLE",
      rebateTxHash: current?.rebateTxHash || null,
      rebateErrorDetail: null,
    }));
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
    if (hasActiveLaunch) {
      setError("This game already has an active or confirmed pons launch. The saved launch must finish before another quote can be created.");
      setStatus(launchStatusCopy(launchState));
      return;
    }
    setBusy(true); setError(""); setStatus(useCredit ? "Preparing your platform-sponsored launch…" : "Reading pons V2 contracts…");
    try {
      const pendingKey = `pons-launch-pending:${gameId}:${address.toLowerCase()}`;
      let idempotencyKey = crypto.randomUUID();
      try {
        idempotencyKey = localStorage.getItem(pendingKey) || idempotencyKey;
        localStorage.setItem(pendingKey, idempotencyKey);
      } catch {}
      const response = await fetch(`/api/games/${gameId}/launch/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: address, useFreeCredit: useCredit, idempotencyKey }) });
      const body = await response.json();
      if (!response.ok) {
        try { localStorage.removeItem(pendingKey); } catch {}
        throw new Error(body.error || "Could not prepare launch");
      }
      if (body.sponsored) {
        setQuote(null);
        setTxHash(body.transactionHash || "");
        const sponsoredState: LaunchState = {
          id: body.launchId,
          status: body.status || "AWAITING_SIGNATURE",
          transactionHash: body.transactionHash || null,
          tokenAddress: body.tokenAddress || null,
          errorDetail: null,
          tradingUrl: body.tradingUrl || null,
          quoteExpiresAt: body.quoteExpiresAt,
          freeCreditRequested: true,
          sponsoredLaunch: true,
          rebateStatus: "NOT_APPLICABLE",
          rebateTxHash: null,
          rebateErrorDetail: null,
        };
        setLaunchState(sponsoredState);
        setStatus(launchStatusCopy(sponsoredState));
        try {
          localStorage.removeItem(`pons-launch-quote:${gameId}:${address.toLowerCase()}`);
          localStorage.removeItem(`pons-launch-quote:${gameId}`);
          localStorage.removeItem(pendingKey);
        } catch {}
        return;
      }
      setQuote(body as Quote);
      setTxHash("");
      setLaunchState({
        id: body.launchId,
        status: "AWAITING_SIGNATURE",
        transactionHash: null,
        tokenAddress: null,
        errorDetail: null,
        tradingUrl: null,
        quoteExpiresAt: body.quoteExpiresAt,
        freeCreditRequested: Boolean(body.freeCredit?.requested),
        sponsoredLaunch: false,
        rebateStatus: "NOT_APPLICABLE",
        rebateTxHash: null,
        rebateErrorDetail: null,
      });
      setStatus("Live quote ready. Your wallet will show the exact transaction before approval.");
      try {
        localStorage.setItem(`pons-launch-quote:${gameId}:${address.toLowerCase()}`, JSON.stringify(body));
        localStorage.removeItem(pendingKey);
      } catch {}
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not prepare launch"); setStatus("Quote failed"); }
    finally { setBusy(false); }
  }

  async function launch() {
    if (!quote || !address) return;
    if (txHash || recoveringSubmission) {
      setError("A transaction is already saved for this launch. Resume recovery instead of sending another transaction.");
      return;
    }
    if (getAddress(quote.walletAddress) !== getAddress(address)) {
      setQuote(null); setVerified(false);
      setError("This quote belongs to a different wallet. Verify the connected wallet and read a new quote.");
      setStatus("Wallet changed");
      return;
    }
    if (Date.now() + SIGNING_SAFETY_BUFFER_MS >= new Date(quote.quoteExpiresAt).getTime()) {
      setQuote(null);
      setError("This quote is too close to expiry to sign safely. It will unlock after expiry, then you can read a fresh quote.");
      setStatus("Waiting for the saved quote to expire safely…");
      return;
    }
    let submittedHash = "";
    setBusy(true); setError(""); setStatus("Confirm the pons launch in your wallet…");
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const params = quote.args[0] as never;
      const hash = await writeContractAsync({ address: getAddress(quote.factory), abi: PONS_FACTORY_ABI, functionName: "launchToken", args: [params, BigInt(quote.args[1]), getAddress(quote.args[2])], value: BigInt(quote.value), chainId: robinhoodChain.id });
      submittedHash = hash;
      setTxHash(hash);
      setStatus("Transaction submitted. Waiting for independent on-chain verification…");
      try { localStorage.setItem(`pons-launch-tx:${quote.launchId}`, hash); } catch {}
      await recordSubmission(quote, hash);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Launch failed");
      setStatus(submittedHash ? "Your transaction hash is saved. Resume recovery without sending another transaction." : "Launch stopped. The draft and free credit are preserved unless a launch confirmed.");
    }
    finally { setBusy(false); }
  }

  return <div className="launch-panel">
    <div className="launch-panel-head"><div><span className="live-dot" />Live pons V2</div><small>Robinhood Chain · {launchState?.sponsoredLaunch || useCredit ? "platform-sponsored" : "user-signed"}</small></div>
    <div className="launch-status"><span>{isConfirmed ? "✓" : busy || isPollingLaunch ? "…" : "→"}</span><div><b>{status}</b>{address && <small>{address.slice(0, 8)}…{address.slice(-6)}</small>}</div></div>
    {!sponsorReady && creditStatus === "AVAILABLE" && <div className="credit-warning"><b>Free credit protected</b><p>The platform launch wallet is not ready yet. You can keep the credit or turn it off and launch from your own wallet.</p></div>}
    {creditStatus === "AVAILABLE" && <label className="switch-row"><input type="checkbox" checked={useCredit} disabled={!sponsorReady || Boolean(quote) || hasActiveLaunch} onChange={(event) => setUseCredit(event.target.checked)} /><span><b>Use one free sponsored launch</b><small>{sponsorReady ? "Platform wallet pays the Pons fee and network gas" : "Platform wallet unavailable"}</small></span></label>}
    {quote && <div className="cost-card"><div><span>pons launch fee</span><b>{formatEther(BigInt(quote.costs.launchFeeWei))} ETH</b></div><div><span>Network gas</span><b>{quote.costs.gas}</b></div><div><span>Curve trade fee</span><b>{Number(quote.config.curveFeeBps) / 100}%</b></div><div><span>Graduation target</span><b>{formatEther(BigInt(quote.config.graduationThreshold))} ETH</b></div></div>}
    <div className="risk-copy">pons V2 audits are still in progress. Tokens are volatile. {useCredit || launchState?.sponsoredLaunch ? "The platform wallet submits this one free launch; your connected wallet is not charged." : "Check the target, value, and chain in your wallet before approval."}</div>
    {error && <p className="error-copy">{error}</p>}
    {txHash && <a className="tx-link" href={`https://robinhoodchain.blockscout.com/tx/${txHash}`} target="_blank" rel="noreferrer">View submitted transaction ↗</a>}
    {!launchState?.sponsoredLaunch && rebateStatus && rebateStatus !== "NOT_APPLICABLE" && <div className={rebateStatus === "FAILED" ? "failure-card" : "credit-warning"}><b>Fee reimbursement: {rebateStatus.toLowerCase()}</b><p>{rebateStatus === "SENT" ? "The exact verified launch fee was returned after two confirmations." : rebateStatus === "FAILED" ? "The launch remains live; this payout is recorded for operator review." : "The durable worker will resume this payout if it is interrupted."}</p></div>}
    {!launchState?.sponsoredLaunch && rebateTxHash && <a className="tx-link" href={`https://robinhoodchain.blockscout.com/tx/${rebateTxHash}`} target="_blank" rel="noreferrer">View reimbursement transaction ↗</a>}
    {confirmedToken && <a className="button button-primary button-wide" href={`/game/${confirmedToken}`}>Open permanent game page</a>}
    {tradingUrl && <a className="tx-link" href={tradingUrl} target="_blank" rel="noreferrer">Trade on pons ↗</a>}
    {!isConfirmed && <div className="launch-actions">{isPollingLaunch ? <p className="muted-copy">{launchState?.sponsoredLaunch ? "The platform wallet is processing this free launch. You can safely leave; it continues without this browser." : "Confirmation is saved in the database and will continue without this browser."}</p> : quote && txHash ? <button className="button button-primary button-wide" disabled={recoveringSubmission || busy} onClick={() => recoverSubmission(quote, txHash)}>{recoveringSubmission ? "Recovering…" : "Resume submitted launch"}</button> : hasActiveLaunch && !quote ? <p className="muted-copy">{isAwaitingSignature ? launchState?.sponsoredLaunch ? "The platform wallet is preparing this free launch. No payment confirmation is required in your wallet." : "Reconnect the original wallet and browser session to sign this reserved quote. It will expire safely if left unsigned." : "The saved launch is active. This page will not create a conflicting quote."}</p> : !isConnected ? <p className="muted-copy">Connect a wallet from the top bar first.</p> : !verified ? <button className="button button-primary button-wide" disabled={busy} onClick={verifyWallet}>{busy ? "Verifying…" : "Verify connected wallet"}</button> : !quote ? <button className="button button-primary button-wide" disabled={busy || hasActiveLaunch} onClick={getQuote}>{busy ? useCredit ? "Starting free launch…" : "Reading contracts…" : useCredit ? "Launch free with platform wallet" : "Read exact launch cost"}</button> : <button className="button button-primary button-wide" disabled={busy || recoveringSubmission || Boolean(txHash)} onClick={launch}>{busy || recoveringSubmission ? "Waiting…" : "Launch game and token"}</button>}</div>}
  </div>;
}
