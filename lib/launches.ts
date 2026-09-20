import { getAddress, isHash, type Address, type Hex } from "viem";
import type { PoolClient } from "pg";
import { query, transaction } from "@/lib/db";
import { explorerTokenUrl, ponsTradingUrl, type PonsTokenParams, verifyPonsLaunch } from "@/lib/pons";
import { safeError } from "@/lib/security";
import type { RebateStatus } from "@/lib/types";

type LaunchRow = {
  id: string;
  game_id: string;
  game_version_id: string;
  user_id: string;
  wallet_address: string;
  factory_address: string;
  pair_token: string;
  launch_config_id: string;
  launch_fee_wei: string;
  token_params: PonsTokenParams;
  transaction_hash: string | null;
  free_credit_id: string | null;
  status: string;
  rebate_status: RebateStatus;
};

export async function launchById(id: string, userId?: string) {
  const result = await query(
    `SELECT p.id,p.game_id,p.game_version_id,p.user_id,p.wallet_address,p.chain_id,p.factory_address,
       p.pair_token,p.launch_config_id::text,p.launch_fee_wei::text,p.status,p.transaction_hash,
       p.receipt_block::text,p.token_address,p.curve_address,p.quote_expires_at,p.created_at,p.updated_at,
       p.error_code,p.error_detail,p.free_credit_id,p.rebate_status,p.rebate_tx_hash,
       p.rebate_error_code,p.rebate_error_detail,p.rebate_started_at,p.rebate_broadcast_at,p.rebate_sent_at,
       g.name AS game_name,g.ticker
     FROM pons_launches p JOIN games g ON g.id=p.game_id
     WHERE p.id::text=$1 ${userId ? "AND p.user_id=$2" : ""} LIMIT 1`,
    userId ? [id, userId] : [id],
  );
  return result.rows[0] || null;
}

async function internalLaunchById(id: string) {
  const result = await query<LaunchRow>("SELECT * FROM pons_launches WHERE id=$1 LIMIT 1", [id]);
  return result.rows[0] || null;
}

/**
 * A terminal launch must not strand its game in LAUNCHING. The status guard,
 * token check, and active-launch check make this safe against a concurrent
 * confirmation and ensure a LIVE game is never downgraded.
 */
export async function restoreGameAfterTerminalLaunch(client: PoolClient, gameId: string) {
  await client.query(
    `UPDATE games g SET status='DRAFT',updated_at=now()
     WHERE g.id=$1 AND g.status='LAUNCHING'
       AND NOT EXISTS (SELECT 1 FROM tokens t WHERE t.game_id=g.id)
       AND NOT EXISTS (
         SELECT 1 FROM pons_launches p
         WHERE p.game_id=g.id AND p.status IN ('SUBMITTED','CONFIRMING','CONFIRMED')
       )`,
    [gameId],
  );
}

export async function markLaunchFailed(id: string, code: string, detail: string) {
  await transaction(async (client) => {
    const locked = await client.query<{ free_credit_id: string | null; game_id: string; status: string }>("SELECT free_credit_id,game_id,status FROM pons_launches WHERE id=$1 FOR UPDATE", [id]);
    const row = locked.rows[0];
    if (!row || row.status === "CONFIRMED") return;
    await client.query("UPDATE pons_launches SET status='FAILED',rebate_reserved_wei=0,error_code=$2,error_detail=$3,updated_at=now() WHERE id=$1", [id, code, detail.slice(0, 500)]);
    if (row.free_credit_id) {
      await client.query(
        `UPDATE free_launch_credits SET status='AVAILABLE',reserved_wallet_address=NULL,reservation_expires_at=NULL,updated_at=now()
         WHERE id=$1 AND status='RESERVED'`,
        [row.free_credit_id],
      );
    }
    await restoreGameAfterTerminalLaunch(client, row.game_id);
  });
}

export async function finalizeLaunch(id: string) {
  const launch = await internalLaunchById(id);
  if (!launch) throw new Error("LAUNCH_NOT_FOUND");
  if (launch.status === "CONFIRMED") return launch;
  if (!launch.transaction_hash || !isHash(launch.transaction_hash)) throw new Error("TRANSACTION_NOT_SUBMITTED");
  await query("UPDATE pons_launches SET status='CONFIRMING',updated_at=now() WHERE id=$1 AND status IN ('SUBMITTED','CONFIRMING')", [id]);
  try {
    const verified = await verifyPonsLaunch({
      transactionHash: launch.transaction_hash as Hex,
      factory: getAddress(launch.factory_address) as Address,
      wallet: getAddress(launch.wallet_address) as Address,
      configId: BigInt(launch.launch_config_id),
      pairToken: getAddress(launch.pair_token) as Address,
      launchFee: BigInt(launch.launch_fee_wei),
      params: launch.token_params,
    });
    await transaction(async (client) => {
      const locked = await client.query<LaunchRow>("SELECT * FROM pons_launches WHERE id=$1 FOR UPDATE", [id]);
      if (!locked.rows[0] || locked.rows[0].status === "CONFIRMED") return;
      await client.query(
        `INSERT INTO tokens(game_id,launch_id,chain_id,address,address_normalized,curve_address,launch_transaction_hash,confirmed_block,pons_url,explorer_url)
         VALUES($1,$2,4663,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT(game_id) DO NOTHING`,
        [launch.game_id, id, verified.token, verified.token.toLowerCase(), verified.curve, launch.transaction_hash, verified.receipt.blockNumber.toString(), ponsTradingUrl(verified.token), explorerTokenUrl(verified.token)],
      );
      await client.query(
        `UPDATE pons_launches SET status='CONFIRMED',receipt_block=$2,token_address=$3,curve_address=$4,
         rebate_status=CASE WHEN free_credit_id IS NOT NULL THEN 'PENDING' ELSE 'NOT_APPLICABLE' END,
         rebate_error_code=NULL,rebate_error_detail=NULL,updated_at=now(),error_code=NULL,error_detail=NULL WHERE id=$1`,
        [id, verified.receipt.blockNumber.toString(), verified.token, verified.curve],
      );
      await client.query("UPDATE games SET status='LIVE',updated_at=now() WHERE id=$1", [launch.game_id]);
      await client.query("UPDATE game_versions SET status='PUBLISHED',published_at=COALESCE(published_at,now()) WHERE id=$1", [launch.game_version_id]);
      if (launch.free_credit_id) {
        await client.query(
          `UPDATE free_launch_credits SET status='USED',used_launch_id=$2,reservation_expires_at=NULL,updated_at=now() WHERE id=$1 AND status='RESERVED'`,
          [launch.free_credit_id, id],
        );
      }
      await client.query(
        `INSERT INTO audit_logs(actor_user_id,actor_type,action,resource_type,resource_id,after_data)
         VALUES($1,'SYSTEM','PONS_LAUNCH_CONFIRMED','PONS_LAUNCH',$2,$3::jsonb)`,
        [launch.user_id, id, JSON.stringify({ token: verified.token, curve: verified.curve, block: verified.receipt.blockNumber.toString() })],
      );
      if (launch.free_credit_id) {
        await client.query(
          `INSERT INTO audit_logs(actor_user_id,actor_type,action,resource_type,resource_id,after_data)
           VALUES($1,'SYSTEM','PONS_REBATE_PENDING','PONS_LAUNCH',$2,$3::jsonb)`,
          [launch.user_id, id, JSON.stringify({ status: "PENDING", recipient: launch.wallet_address, amountWei: launch.launch_fee_wei })],
        );
      }
    });
    return launchById(id);
  } catch (error) {
    const detail = safeError(error);
    if (/REVERTED|MISMATCH|WRONG_|MISSING|INVALID/.test(detail)) await markLaunchFailed(id, "VERIFICATION_FAILED", detail);
    throw error;
  }
}
