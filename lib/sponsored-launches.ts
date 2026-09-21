import { getAddress, isAddress, isHash, keccak256, type Address, type Hex } from "viem";
import { robinhoodChain } from "@/lib/chain";
import { query, transaction } from "@/lib/db";
import { markLaunchFailed } from "@/lib/launches";
import { launchCalldata, publicClient, simulatePonsLaunch, type PonsTokenParams } from "@/lib/pons";
import {
  assertSponsorCanFundLaunch,
  nextSponsorNonce,
  sponsorSigningWallet,
} from "@/lib/rebates";
import { safeError } from "@/lib/security";

type SponsoredLaunchRow = {
  id: string;
  game_id: string;
  game_version_id: string;
  user_id: string;
  wallet_address: string;
  chain_id: number;
  factory_address: string;
  pair_token: string;
  launch_config_id: string;
  launch_fee_wei: string;
  token_params: PonsTokenParams;
  status: string;
  transaction_hash: string | null;
  free_credit_id: string | null;
  sponsored_launch: boolean;
  sponsored_signed_transaction: string | null;
  sponsored_nonce: string | null;
  sponsored_attempts: number;
};

function redactedError(error: unknown) {
  const key = process.env.SPONSOR_PRIVATE_KEY;
  const detail = safeError(error);
  return key ? detail.replaceAll(key, "[redacted]") : detail;
}

async function noteAttempt(id: string, code: string | null, detail: string | null, broadcast = false) {
  await query(
    `UPDATE pons_launches SET sponsored_attempts=sponsored_attempts+1,sponsored_last_attempt_at=now(),
       sponsored_broadcast_at=CASE WHEN $4 THEN COALESCE(sponsored_broadcast_at,now()) ELSE sponsored_broadcast_at END,
       sponsored_next_attempt_at=now() + LEAST(300,(5 * power(2,LEAST(sponsored_attempts,6)))::int) * interval '1 second',
       error_code=$2,error_detail=$3,updated_at=now()
     WHERE id=$1 AND sponsored_launch=true AND status='AWAITING_SIGNATURE'`,
    [id, code, detail?.slice(0, 500) || null, broadcast],
  );
}

async function prepareSponsoredLaunch(id: string) {
  return transaction(async (client) => {
    const { account, client: walletClient } = sponsorSigningWallet();
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`pons-sponsor-nonce:${account.address.toLowerCase()}`]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`pons-sponsor-reserve:${account.address.toLowerCase()}`]);
    const locked = await client.query<SponsoredLaunchRow>("SELECT * FROM pons_launches WHERE id=$1 FOR UPDATE", [id]);
    const row = locked.rows[0];
    if (!row || !row.sponsored_launch || row.status !== "AWAITING_SIGNATURE") return row || null;
    if (row.sponsored_signed_transaction && row.transaction_hash) return row;
    if (!row.free_credit_id) throw new Error("SPONSORED_LAUNCH_REQUIRES_FREE_CREDIT");
    if (row.chain_id !== robinhoodChain.id) throw new Error("SPONSORED_LAUNCH_WRONG_CHAIN");
    if (!isAddress(row.wallet_address) || getAddress(row.wallet_address) !== account.address) {
      throw new Error("SPONSORED_LAUNCH_PAYER_MISMATCH");
    }
    if (!isAddress(row.factory_address) || !isAddress(row.pair_token)) throw new Error("SPONSORED_LAUNCH_ADDRESS_INVALID");

    const factory = getAddress(row.factory_address);
    const pairToken = getAddress(row.pair_token);
    const configId = BigInt(row.launch_config_id);
    const value = BigInt(row.launch_fee_wei);
    const data = launchCalldata(row.token_params, configId, pairToken);
    await simulatePonsLaunch(account.address, row.token_params, configId, pairToken, value);
    const capacity = await assertSponsorCanFundLaunch(value, factory, data, { client, excludeLaunchId: id });
    const networkNonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
    const reserved = await client.query<{ max_nonce: string | null }>(
      `SELECT max(nonce_value)::text AS max_nonce FROM (
         SELECT rebate_nonce AS nonce_value FROM pons_launches
          WHERE chain_id=$1 AND rebate_sponsor_address=$2 AND rebate_nonce IS NOT NULL
         UNION ALL
         SELECT sponsored_nonce AS nonce_value FROM pons_launches
          WHERE chain_id=$1 AND wallet_address=$2 AND sponsored_nonce IS NOT NULL
       ) reserved_nonces`,
      [robinhoodChain.id, account.address.toLowerCase()],
    );
    const nonce = nextSponsorNonce(networkNonce, reserved.rows[0]?.max_nonce || null);
    const common = {
      account,
      chain: robinhoodChain,
      to: factory,
      data,
      value,
      nonce,
      gas: capacity.fees.gasLimit,
    } as const;
    const signed = capacity.fees.type === "eip1559"
      ? await walletClient.signTransaction({
          ...common,
          type: "eip1559",
          maxFeePerGas: capacity.fees.maxFeePerGas,
          maxPriorityFeePerGas: capacity.fees.maxPriorityFeePerGas,
        })
      : await walletClient.signTransaction({ ...common, type: "legacy", gasPrice: capacity.fees.gasPrice });
    const hash = keccak256(signed);
    const updated = await client.query<SponsoredLaunchRow>(
      `UPDATE pons_launches SET transaction_hash=$2,sponsored_signed_transaction=$3,sponsored_nonce=$4,
         sponsored_last_attempt_at=now(),sponsored_next_attempt_at=now(),rebate_reserved_wei=$5,
         error_code=NULL,error_detail=NULL,updated_at=now()
       WHERE id=$1 AND sponsored_launch=true AND status='AWAITING_SIGNATURE' RETURNING *`,
      [id, hash, signed, nonce.toString(), capacity.reserveWei],
    );
    await client.query(
      `INSERT INTO audit_logs(actor_user_id,actor_type,action,resource_type,resource_id,after_data)
       VALUES($1,'SYSTEM','PONS_SPONSORED_LAUNCH_SIGNED','PONS_LAUNCH',$2,$3::jsonb)`,
      [row.user_id, id, JSON.stringify({ transactionHash: hash, payer: account.address, nonce })],
    );
    return updated.rows[0] || null;
  });
}

async function broadcastSponsoredLaunch(row: SponsoredLaunchRow) {
  if (!row.transaction_hash || !isHash(row.transaction_hash) || !row.sponsored_signed_transaction) {
    throw new Error("SPONSORED_LAUNCH_SIGNED_STATE_INVALID");
  }
  const hash = row.transaction_hash as Hex;
  let known = false;
  try {
    await publicClient.getTransaction({ hash });
    known = true;
  } catch {
    // The exact persisted transaction has not reached this RPC yet.
  }
  if (!known) {
    try {
      const { client } = sponsorSigningWallet();
      const broadcastHash = await client.sendRawTransaction({ serializedTransaction: row.sponsored_signed_transaction as Hex });
      if (broadcastHash.toLowerCase() !== hash.toLowerCase()) throw new Error("SPONSORED_LAUNCH_HASH_MISMATCH");
      await noteAttempt(row.id, null, null, true);
    } catch (error) {
      const detail = redactedError(error);
      if (/already known|known transaction/i.test(detail)) {
        await noteAttempt(row.id, null, null, true);
      } else if (/SPONSORED_LAUNCH_HASH_MISMATCH/i.test(detail)) {
        throw error;
      } else {
        await noteAttempt(row.id, "SPONSORED_LAUNCH_BROADCAST_PENDING", detail);
        return false;
      }
    }
  }
  await transaction(async (client) => {
    const updated = await client.query<SponsoredLaunchRow>(
      `UPDATE pons_launches SET status='SUBMITTED',submitted_at=COALESCE(submitted_at,now()),
         sponsored_broadcast_at=COALESCE(sponsored_broadcast_at,now()),sponsored_next_attempt_at=NULL,
         error_code=NULL,error_detail=NULL,updated_at=now()
       WHERE id=$1 AND sponsored_launch=true AND status='AWAITING_SIGNATURE' AND transaction_hash=$2 RETURNING *`,
      [row.id, hash],
    );
    if (!updated.rows[0]) return;
    await client.query(
      `INSERT INTO audit_logs(actor_user_id,actor_type,action,resource_type,resource_id,after_data)
       VALUES($1,'SYSTEM','PONS_SPONSORED_LAUNCH_SUBMITTED','PONS_LAUNCH',$2,$3::jsonb)`,
      [row.user_id, row.id, JSON.stringify({ transactionHash: hash, payer: row.wallet_address })],
    );
  });
  return true;
}

export async function processSponsoredLaunchForId(id: string) {
  let row: SponsoredLaunchRow | null = null;
  try {
    row = await prepareSponsoredLaunch(id);
    if (!row || !row.sponsored_launch || row.status !== "AWAITING_SIGNATURE") return false;
    return await broadcastSponsoredLaunch(row);
  } catch (error) {
    const detail = redactedError(error);
    const terminal = /REQUIRES_FREE_CREDIT|WRONG_CHAIN|PAYER_MISMATCH|ADDRESS_INVALID|HASH_MISMATCH|INVALID_|PONS_LAUNCH_GATE_CLOSED|PONS_CONFIG_DISABLED|NO_ACTIVE_PONS_CONFIG|revert/i.test(detail);
    if (terminal) {
      await markLaunchFailed(id, "SPONSORED_LAUNCH_FAILED", detail);
    } else {
      await noteAttempt(id, "SPONSORED_LAUNCH_PROCESSING_PENDING", detail);
    }
    return true;
  }
}

export async function processNextSponsoredLaunch() {
  const result = await query<{ id: string }>(
    `SELECT id FROM pons_launches
     WHERE sponsored_launch=true AND status='AWAITING_SIGNATURE'
       AND (sponsored_next_attempt_at IS NULL OR sponsored_next_attempt_at<=now())
     ORDER BY COALESCE(sponsored_next_attempt_at,created_at) ASC,updated_at ASC LIMIT 1`,
  );
  if (!result.rows[0]) return false;
  return processSponsoredLaunchForId(result.rows[0].id);
}
