import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { auth } from "@/lib/auth";
import { transaction } from "@/lib/db";
import { ZERO_ADDRESS } from "@/lib/chain";
import { buildPonsParams, launchCalldata, readPonsLaunchTerms, simulatePonsLaunch, transactionFingerprint } from "@/lib/pons";
import { assertSponsorCanReimburse, hasSponsorRebateConfig } from "@/lib/rebates";
import { requireSameOrigin, safeError, sha256 } from "@/lib/security";

export const maxDuration = 30;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    if (process.env.PONS_LAUNCH_ENABLED !== "true") return NextResponse.json({ error: "Live pons launching is paused." }, { status: 503 });
    const session = await auth();
    if (!session?.user?.id || !session.user.xId || session.user.accountStatus !== "ACTIVE") {
      return NextResponse.json({ error: "Continue with X before launching.", code: "X_AUTH_REQUIRED" }, { status: 401 });
    }
    const { id: gameId } = await context.params;
    const body = await request.json();
    if (!isAddress(body.walletAddress)) return NextResponse.json({ error: "Verify a wallet first." }, { status: 400 });
    const wallet = getAddress(body.walletAddress);
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.slice(0, 100) : randomUUID();
    const existing = await transaction(async (client) => {
      const result = await client.query(
        `SELECT id,wallet_address,factory_address,pair_token,launch_config_id::text,launch_fee_wei::text,
           token_params,status,free_credit_id,quote_expires_at
         FROM pons_launches WHERE user_id=$1 AND idempotency_key=$2 LIMIT 1`,
        [session.user!.id, idempotencyKey],
      );
      return result.rows[0] || null;
    });
    if (existing) {
      if (getAddress(existing.wallet_address) !== wallet || existing.status !== "AWAITING_SIGNATURE" || new Date(existing.quote_expires_at) <= new Date()) {
        return NextResponse.json({ error: "This launch request already has a different or expired quote." }, { status: 409 });
      }
      const terms = await readPonsLaunchTerms(wallet, getAddress(existing.pair_token));
      if (terms.configId.toString() !== existing.launch_config_id || terms.launchFee.toString() !== existing.launch_fee_wei) {
        return NextResponse.json({ error: "The live pons launch terms changed. Create a new quote." }, { status: 409 });
      }
      if (existing.free_credit_id) {
        await transaction(async (client) => {
          const capacity = await assertSponsorCanReimburse(terms.launchFee, wallet, { client, excludeLaunchId: existing.id });
          await client.query(
            "UPDATE pons_launches SET rebate_reserved_wei=$2,updated_at=now() WHERE id=$1 AND status='AWAITING_SIGNATURE'",
            [existing.id, capacity.reserveWei],
          );
        });
      }
      await simulatePonsLaunch(wallet, existing.token_params, terms.configId, getAddress(existing.pair_token), terms.launchFee);
      return NextResponse.json({
        launchId: existing.id,
        walletAddress: wallet,
        chainId: 4663,
        factory: existing.factory_address,
        functionName: "launchToken",
        args: [existing.token_params, existing.launch_config_id, existing.pair_token],
        value: existing.launch_fee_wei,
        calldata: launchCalldata(existing.token_params, terms.configId, getAddress(existing.pair_token)),
        quoteExpiresAt: new Date(existing.quote_expires_at).toISOString(),
        costs: { launchFeeWei: existing.launch_fee_wei, developerBuyWei: "0", gas: "Estimated in wallet" },
        freeCredit: { requested: Boolean(existing.free_credit_id), sponsorReady: Boolean(existing.free_credit_id), method: existing.free_credit_id ? "Verified fee reimbursement after confirmation" : null },
        config: {
          supply: terms.config.supply.toString(),
          curveFeeBps: terms.config.curveFeeBps.toString(),
          graduationThreshold: terms.config.graduationThreshold.toString(),
        },
        reused: true,
      });
    }
    const active = await transaction(async (client) => {
      const result = await client.query(
        `SELECT id,status FROM pons_launches
         WHERE game_id=$1 AND user_id=$2 AND status IN ('QUOTING','AWAITING_SIGNATURE','SUBMITTED','CONFIRMING','CONFIRMED') LIMIT 1`,
        [gameId, session.user!.id],
      );
      return result.rows[0] || null;
    });
    if (active) return NextResponse.json({ error: "This game already has an active or confirmed pons launch." }, { status: 409 });

    const gameResult = await transaction(async (client) => {
      const game = await client.query(
        `SELECT g.*,v.id AS version_id,v.config,
          (SELECT a.id FROM assets a WHERE a.game_id=g.id AND a.kind='TOKEN_IMAGE' AND a.immutable=true ORDER BY a.created_at DESC LIMIT 1) AS image_id,
          w.id AS wallet_id,f.id AS credit_id,f.status AS credit_status
         FROM games g JOIN game_versions v ON v.id=g.current_version_id
         JOIN wallets w ON w.user_id=g.owner_user_id AND w.address_normalized=$3 AND w.chain_id=4663
         LEFT JOIN free_launch_credits f ON f.user_id=g.owner_user_id
         WHERE g.id=$1 AND g.owner_user_id=$2 LIMIT 1`,
        [gameId, session.user!.id, wallet.toLowerCase()],
      );
      return game.rows[0] || null;
    });
    if (!gameResult) return NextResponse.json({ error: "Game or verified wallet not found." }, { status: 404 });
    if (!gameResult.image_id) return NextResponse.json({ error: "An immutable token image is required." }, { status: 400 });
    if (BigInt(gameResult.developer_buy_wei || 0) > 0n) {
      return NextResponse.json({ error: "Atomic developer buy is not enabled yet. Set developer buy to 0 for this launch." }, { status: 400 });
    }
    const wantsFreeCredit = Boolean(body.useFreeCredit);
    const sponsorReady = hasSponsorRebateConfig();
    if (wantsFreeCredit && !sponsorReady) return NextResponse.json({ error: "Your free launch credit is saved, but the reimbursement wallet still needs funding." }, { status: 409 });

    const terms = await readPonsLaunchTerms(wallet, ZERO_ADDRESS);
    const launchId = randomUUID();
    const baseUrl = (process.env.APP_URL || request.nextUrl.origin).replace(/\/$/, "");
    const tokenParams = buildPonsParams({
      launchId,
      versionId: gameResult.version_id,
      name: gameResult.name,
      symbol: gameResult.ticker,
      logo: `${baseUrl}/api/assets/${gameResult.image_id}`,
      description: gameResult.description,
      xUrl: gameResult.x_url,
      websiteUrl: gameResult.website_url || `${baseUrl}/game/${gameResult.slug}`,
      creator: wallet,
      creatorTaxBps: 0,
      buybackEnabled: false,
      expectedEconomics: terms.expectedEconomics,
    });
    await simulatePonsLaunch(wallet, tokenParams, terms.configId, ZERO_ADDRESS, terms.launchFee);
    const fingerprint = transactionFingerprint(tokenParams, terms.configId, ZERO_ADDRESS, terms.launchFee);
    const quoteExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await transaction(async (client) => {
      let creditId: string | null = null;
      let rebateReserveWei = "0";
      if (wantsFreeCredit) {
        const capacity = await assertSponsorCanReimburse(terms.launchFee, wallet, { client });
        rebateReserveWei = capacity.reserveWei;
        const credit = await client.query<{ id: string; status: string }>(
          `SELECT id,status FROM free_launch_credits WHERE user_id=$1 FOR UPDATE`,
          [session.user!.id],
        );
        if (!credit.rows[0] || credit.rows[0].status !== "AVAILABLE") throw new Error("FREE_CREDIT_NOT_AVAILABLE");
        creditId = credit.rows[0].id;
        await client.query(
          `UPDATE free_launch_credits SET status='RESERVED',reserved_wallet_address=$2,reservation_expires_at=$3,updated_at=now() WHERE id=$1`,
          [creditId, wallet.toLowerCase(), quoteExpiresAt],
        );
      }
      await client.query(
        `INSERT INTO pons_launches(id,game_id,game_version_id,user_id,wallet_address,idempotency_key,factory_address,pair_token,launch_config_id,launch_fee_wei,expected_economics,salt,token_params,transaction_fingerprint,status,free_credit_id,rebate_reserved_wei,quote_expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,'AWAITING_SIGNATURE',$15,$16,$17)`,
        [launchId, gameId, gameResult.version_id, session.user!.id, wallet, idempotencyKey, terms.factory, ZERO_ADDRESS, terms.configId.toString(), terms.launchFee.toString(), terms.expectedEconomics, tokenParams.salt, JSON.stringify(tokenParams), fingerprint, creditId, rebateReserveWei, quoteExpiresAt],
      );
      await client.query("UPDATE games SET status='LAUNCHING',updated_at=now() WHERE id=$1", [gameId]);
      await client.query(
        `INSERT INTO audit_logs(actor_user_id,actor_type,action,resource_type,resource_id,after_data)
         VALUES($1,'USER','PONS_LAUNCH_PREPARED','PONS_LAUNCH',$2,$3::jsonb)`,
        [session.user!.id, launchId, JSON.stringify({ wallet, configId: terms.configId.toString(), launchFee: terms.launchFee.toString(), useFreeCredit: wantsFreeCredit, rebateReserveWei })],
      );
    });
    return NextResponse.json({
      launchId,
      walletAddress: wallet,
      chainId: 4663,
      factory: terms.factory,
      functionName: "launchToken",
      args: [tokenParams, terms.configId.toString(), ZERO_ADDRESS],
      value: terms.launchFee.toString(),
      calldata: launchCalldata(tokenParams, terms.configId, ZERO_ADDRESS),
      quoteExpiresAt: quoteExpiresAt.toISOString(),
      costs: { launchFeeWei: terms.launchFee.toString(), developerBuyWei: "0", gas: "Estimated in wallet" },
      freeCredit: { requested: wantsFreeCredit, sponsorReady, method: wantsFreeCredit ? "Verified fee reimbursement after confirmation" : null },
      config: {
        supply: terms.config.supply.toString(),
        curveFeeBps: terms.config.curveFeeBps.toString(),
        graduationThreshold: terms.config.graduationThreshold.toString(),
      },
    });
  } catch (error) {
    const rawMessage = safeError(error);
    const message = /REBATE_SPONSOR_UNFUNDED|REBATE_SPONSOR_CAPACITY_RESERVED|REBATE_TRANSFER_PREFLIGHT_FAILED/.test(rawMessage)
      ? "The reimbursement reserve cannot safely cover the live launch fee and transfer gas yet. Your credit remains available."
      : /REBATE_AMOUNT_EXCEEDS_OPERATOR_CAP|REBATE_DAILY_BUDGET_RESERVED/.test(rawMessage)
        ? "The free-launch reimbursement safety budget is currently full. Your credit remains available."
      : rawMessage;
    const status = /FREE_CREDIT|duplicate key/.test(message) ? 409 : 400;
    const publicMessage = /pons_launches_one_active_per_game_idx|duplicate key/.test(message)
      ? "This game already has an active or confirmed pons launch."
      : message;
    return NextResponse.json({ error: publicMessage }, { status });
  }
}
