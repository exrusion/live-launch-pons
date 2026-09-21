import { NextRequest, NextResponse } from "next/server";
import { getAddress, isHash, type Address, type Hex } from "viem";
import { auth } from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { enqueueLaunchVerification } from "@/lib/queue";
import { preflightSubmittedPonsTransaction, type PonsTokenParams } from "@/lib/pons";
import { checkRateLimit } from "@/lib/rate-limit";
import { assertSponsorCanReimburse } from "@/lib/rebates";
import { requireSameOrigin, safeError } from "@/lib/security";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const session = await auth();
    if (!session?.user?.id || session.user.accountStatus !== "ACTIVE") {
      return NextResponse.json({ error: "Connect and verify a wallet before launching.", code: "CREATOR_SESSION_REQUIRED" }, { status: 401 });
    }
    const { id } = await context.params;
    const body = await request.json();
    if (!isHash(body.transactionHash)) return NextResponse.json({ error: "Invalid transaction hash." }, { status: 400 });
    const rate = await checkRateLimit(`launch-submit:${session.user.id}`, 20, 60 * 60);
    if (!rate.allowed) return NextResponse.json({ error: "Too many launch submissions. Try again later." }, { status: 429 });
    const snapshotResult = await query<{
      status: string;
      transaction_hash: string | null;
      wallet_address: string;
      factory_address: string;
      pair_token: string;
      launch_config_id: string;
      launch_fee_wei: string;
      token_params: PonsTokenParams;
      free_credit_id: string | null;
      sponsored_launch: boolean;
    }>(
      `SELECT status,transaction_hash,wallet_address,factory_address,pair_token,launch_config_id,launch_fee_wei,token_params,free_credit_id,sponsored_launch
       FROM pons_launches WHERE id=$1 AND user_id=$2 LIMIT 1`,
      [id, session.user.id],
    );
    const snapshot = snapshotResult.rows[0];
    if (!snapshot) return NextResponse.json({ error: "Launch quote not found." }, { status: 404 });
    if (snapshot.sponsored_launch) {
      return NextResponse.json({ error: "This free launch is submitted by the platform worker; no creator-wallet transaction is accepted." }, { status: 409 });
    }
    if (["SUBMITTED", "CONFIRMING", "CONFIRMED"].includes(snapshot.status)) {
      if (snapshot.transaction_hash?.toLowerCase() !== body.transactionHash.toLowerCase()) {
        return NextResponse.json({ error: "A different transaction is already attached to this launch." }, { status: 409 });
      }
      const queued = snapshot.status === "CONFIRMED" ? false : await enqueueLaunchVerification(id);
      return NextResponse.json({ id, status: snapshot.status, transaction_hash: snapshot.transaction_hash, rebate: { eligible: Boolean(snapshot.free_credit_id), reason: null }, verification: snapshot.status === "CONFIRMED" ? "CONFIRMED" : queued ? "QUEUED" : "POLLING" }, { status: snapshot.status === "CONFIRMED" ? 200 : 202 });
    }
    if (!["AWAITING_SIGNATURE", "EXPIRED"].includes(snapshot.status)) {
      return NextResponse.json({ error: "This launch cannot accept a transaction in its current state." }, { status: 409 });
    }
    await preflightSubmittedPonsTransaction({
      transactionHash: body.transactionHash as Hex,
      factory: getAddress(snapshot.factory_address) as Address,
      wallet: getAddress(snapshot.wallet_address) as Address,
      configId: BigInt(snapshot.launch_config_id),
      pairToken: getAddress(snapshot.pair_token) as Address,
      launchFee: BigInt(snapshot.launch_fee_wei),
      params: snapshot.token_params,
    });
    const launch = await transaction(async (client) => {
      const selected = await client.query<{
        id: string;
        status: string;
        free_credit_id: string | null;
        wallet_address: string;
        transaction_hash: string | null;
      }>(
        `SELECT id,status,free_credit_id,wallet_address,transaction_hash FROM pons_launches
         WHERE id=$1 AND user_id=$2 FOR UPDATE`,
        [id, session.user!.id],
      );
      const row = selected.rows[0];
      if (!row) return null;
      if (["SUBMITTED", "CONFIRMING", "CONFIRMED"].includes(row.status) && row.transaction_hash?.toLowerCase() === body.transactionHash.toLowerCase()) {
        return { id: row.id, status: row.status, transaction_hash: row.transaction_hash };
      }
      if (!["AWAITING_SIGNATURE", "EXPIRED"].includes(row.status)) return null;

      let creditId = row.free_credit_id;
      let rebateReason: string | null = null;
      let rebateReserveWei: string | null = null;
      // A transaction may have been approved just before the quote expired.
      // Re-reserve its original credit under the same lock and repeat the
      // sponsor capacity check; if that is impossible, record the launch but
      // report the lost eligibility explicitly to the client and audit log.
      if (row.status === "EXPIRED" && creditId) {
        const credit = await client.query<{ status: string }>("SELECT status FROM free_launch_credits WHERE id=$1 FOR UPDATE", [creditId]);
        const competing = await client.query<{ id: string }>(
          `SELECT id FROM pons_launches WHERE free_credit_id=$1 AND id<>$2
           AND status IN ('QUOTING','AWAITING_SIGNATURE','SUBMITTED','CONFIRMING','CONFIRMED') LIMIT 1`,
          [creditId, id],
        );
        if (credit.rows[0] && !competing.rows[0] && ["AVAILABLE", "RESERVED"].includes(credit.rows[0].status)) {
          try {
            const capacity = await assertSponsorCanReimburse(BigInt(snapshot.launch_fee_wei), getAddress(row.wallet_address), { client, excludeLaunchId: id });
            rebateReserveWei = capacity.reserveWei;
            await client.query(
              `UPDATE free_launch_credits SET status='RESERVED',reserved_wallet_address=$2,
               reservation_expires_at=now()+interval '1 day',updated_at=now() WHERE id=$1`,
              [creditId, row.wallet_address.toLowerCase()],
            );
          } catch {
            creditId = null;
            rebateReason = "The expired reimbursement reservation could not be safely restored; the paid launch is still recorded.";
            await client.query(
              `UPDATE free_launch_credits SET status='AVAILABLE',reserved_wallet_address=NULL,reservation_expires_at=NULL,updated_at=now()
               WHERE id=$1 AND status='RESERVED'`,
              [row.free_credit_id],
            );
          }
        } else {
          creditId = null;
          rebateReason = "This free-launch credit is no longer available; the paid launch is still recorded.";
        }
      }
      const updated = await client.query(
        `UPDATE pons_launches SET transaction_hash=$3,status='SUBMITTED',free_credit_id=$4,
         rebate_reserved_wei=COALESCE($5::numeric,rebate_reserved_wei),submitted_at=COALESCE(submitted_at,now()),
         error_code=NULL,error_detail=NULL,updated_at=now()
         WHERE id=$1 AND user_id=$2 RETURNING id,status,transaction_hash`,
        [id, session.user!.id, body.transactionHash, creditId, creditId ? rebateReserveWei : "0"],
      );
      if (rebateReason) {
        await client.query(
          `INSERT INTO audit_logs(actor_user_id,actor_type,action,resource_type,resource_id,after_data)
           VALUES($1,'SYSTEM','PONS_REBATE_DETACHED','PONS_LAUNCH',$2,$3::jsonb)`,
          [session.user!.id, id, JSON.stringify({ reason: rebateReason, transactionHash: body.transactionHash })],
        );
      }
      return updated.rows[0] ? { ...updated.rows[0], rebateEligible: Boolean(creditId), rebateReason } : null;
    });
    if (!launch) return NextResponse.json({ error: "Launch quote is missing or already submitted." }, { status: 409 });
    const queued = await enqueueLaunchVerification(id);
    return NextResponse.json({ ...launch, rebate: { eligible: launch.rebateEligible, reason: launch.rebateReason }, verification: queued ? "QUEUED" : "POLLING" }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: safeError(error) }, { status: 400 });
  }
}
