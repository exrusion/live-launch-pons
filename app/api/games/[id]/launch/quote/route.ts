import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { auth } from "@/lib/auth";
import { ZERO_ADDRESS } from "@/lib/chain";
import { transaction } from "@/lib/db";
import { buildPonsParams, launchCalldata, readPonsLaunchTerms, simulatePonsLaunch, transactionFingerprint } from "@/lib/pons";
import { enqueueSponsoredLaunch } from "@/lib/queue";
import { assertSponsorCanFundLaunch, hasSponsorRebateConfig, sponsorFundingAddress } from "@/lib/rebates";
import { requireSameOrigin, safeError } from "@/lib/security";

export const maxDuration = 30;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    if (process.env.PONS_LAUNCH_ENABLED !== "true") {
      return NextResponse.json({ error: "Live pons launching is paused." }, { status: 503 });
    }
    const session = await auth();
    if (!session?.user?.id || session.user.accountStatus !== "ACTIVE") {
      return NextResponse.json({ error: "Connect and verify a wallet before launching.", code: "CREATOR_SESSION_REQUIRED" }, { status: 401 });
    }
    const { id: gameId } = await context.params;
    const body = await request.json();
    if (!isAddress(body.walletAddress)) return NextResponse.json({ error: "Verify a wallet first." }, { status: 400 });
    const creatorWallet = getAddress(body.walletAddress);
    let idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.slice(0, 100) : randomUUID();
    const existing = await transaction(async (client) => {
      const result = await client.query(
        `SELECT id,wallet_address,factory_address,pair_token,launch_config_id::text,launch_fee_wei::text,
           token_params,status,transaction_hash,token_address,free_credit_id,sponsored_launch,quote_expires_at
         FROM pons_launches WHERE user_id=$1 AND idempotency_key=$2 LIMIT 1`,
        [session.user!.id, idempotencyKey],
      );
      return result.rows[0] || null;
    });
    if (existing) {
      const expectedCreator = existing.sponsored_launch
        ? getAddress(existing.token_params.creatorFeeRecipient)
        : getAddress(existing.wallet_address);
      if (expectedCreator !== creatorWallet) {
        return NextResponse.json({ error: "This launch request belongs to a different wallet." }, { status: 409 });
      }
      if (["FAILED", "EXPIRED"].includes(existing.status)) {
        // A terminal request key is safe to replace. This also makes the first
        // click after the sponsored-flow migration work without a second try.
        idempotencyKey = randomUUID();
      } else if (existing.sponsored_launch) {
        if (existing.status === "AWAITING_SIGNATURE") await enqueueSponsoredLaunch(existing.id);
        return NextResponse.json({
          sponsored: true,
          launchId: existing.id,
          status: existing.status,
          transactionHash: existing.transaction_hash,
          tokenAddress: existing.token_address,
          tradingUrl: existing.token_address ? `https://www.ponsfamily.com/launchpad/${existing.token_address}` : null,
          walletAddress: creatorWallet,
          payerAddress: getAddress(existing.wallet_address),
          creatorFeeRecipient: creatorWallet,
          chainId: 4663,
          factory: existing.factory_address,
          quoteExpiresAt: new Date(existing.quote_expires_at).toISOString(),
          costs: { launchFeeWei: existing.launch_fee_wei, developerBuyWei: "0", gas: "Paid by platform wallet" },
          freeCredit: { requested: true, sponsorReady: true, method: "Platform wallet pays the Pons fee and network gas" },
          reused: true,
        });
      } else if (existing.status !== "AWAITING_SIGNATURE" || new Date(existing.quote_expires_at) <= new Date()) {
        return NextResponse.json({ error: "This launch request already has a different or expired quote." }, { status: 409 });
      } else {
        const terms = await readPonsLaunchTerms(creatorWallet, getAddress(existing.pair_token));
        if (terms.configId.toString() !== existing.launch_config_id || terms.launchFee.toString() !== existing.launch_fee_wei) {
          return NextResponse.json({ error: "The live pons launch terms changed. Create a new quote." }, { status: 409 });
        }
        await simulatePonsLaunch(creatorWallet, existing.token_params, terms.configId, getAddress(existing.pair_token), terms.launchFee);
        return NextResponse.json({
          sponsored: false,
          launchId: existing.id,
          status: existing.status,
          walletAddress: creatorWallet,
          chainId: 4663,
          factory: existing.factory_address,
          functionName: "launchToken",
          args: [existing.token_params, existing.launch_config_id, existing.pair_token],
          value: existing.launch_fee_wei,
          calldata: launchCalldata(existing.token_params, terms.configId, getAddress(existing.pair_token)),
          quoteExpiresAt: new Date(existing.quote_expires_at).toISOString(),
          costs: { launchFeeWei: existing.launch_fee_wei, developerBuyWei: "0", gas: "Estimated in wallet" },
          freeCredit: { requested: false, sponsorReady: hasSponsorRebateConfig(), method: null },
          config: {
            supply: terms.config.supply.toString(),
            curveFeeBps: terms.config.curveFeeBps.toString(),
            graduationThreshold: terms.config.graduationThreshold.toString(),
          },
          reused: true,
        });
      }
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
         JOIN wallets w ON w.user_id=g.owner_user_id AND w.address_normalized=$3 AND w.chain_id=4663 AND w.verified_at IS NOT NULL
         LEFT JOIN free_launch_credits f ON f.user_id=g.owner_user_id
         WHERE g.id=$1 AND g.owner_user_id=$2 LIMIT 1`,
        [gameId, session.user!.id, creatorWallet.toLowerCase()],
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
    if (wantsFreeCredit && !sponsorReady) {
      return NextResponse.json({ error: "Your free launch credit is saved, but the platform launch wallet is not ready." }, { status: 409 });
    }
    const payer = wantsFreeCredit ? sponsorFundingAddress() : creatorWallet;
    const terms = await readPonsLaunchTerms(payer, ZERO_ADDRESS);
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
      creator: creatorWallet,
      creatorTaxBps: 0,
      buybackEnabled: false,
      expectedEconomics: terms.expectedEconomics,
    });
    await simulatePonsLaunch(payer, tokenParams, terms.configId, ZERO_ADDRESS, terms.launchFee);
    const calldata = launchCalldata(tokenParams, terms.configId, ZERO_ADDRESS);
    const fingerprint = transactionFingerprint(tokenParams, terms.configId, ZERO_ADDRESS, terms.launchFee);
    const quoteExpiresAt = new Date(Date.now() + (wantsFreeCredit ? 24 * 60 : 15) * 60 * 1000);

    await transaction(async (client) => {
      let creditId: string | null = null;
      let sponsorReserveWei = "0";
      if (wantsFreeCredit) {
        const capacity = await assertSponsorCanFundLaunch(terms.launchFee, terms.factory, calldata, { client });
        sponsorReserveWei = capacity.reserveWei;
        const credit = await client.query<{ id: string; status: string }>(
          "SELECT id,status FROM free_launch_credits WHERE user_id=$1 FOR UPDATE",
          [session.user!.id],
        );
        if (!credit.rows[0] || credit.rows[0].status !== "AVAILABLE") throw new Error("FREE_CREDIT_NOT_AVAILABLE");
        creditId = credit.rows[0].id;
        await client.query(
          `UPDATE free_launch_credits SET status='RESERVED',reserved_wallet_address=$2,reservation_expires_at=$3,updated_at=now() WHERE id=$1`,
          [creditId, creatorWallet.toLowerCase(), quoteExpiresAt],
        );
      }
      await client.query(
        `INSERT INTO pons_launches(id,game_id,game_version_id,user_id,wallet_address,idempotency_key,factory_address,pair_token,launch_config_id,launch_fee_wei,expected_economics,salt,token_params,transaction_fingerprint,status,free_credit_id,rebate_reserved_wei,quote_expires_at,sponsored_launch)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,'AWAITING_SIGNATURE',$15,$16,$17,$18)`,
        [launchId, gameId, gameResult.version_id, session.user!.id, payer.toLowerCase(), idempotencyKey, terms.factory, ZERO_ADDRESS, terms.configId.toString(), terms.launchFee.toString(), terms.expectedEconomics, tokenParams.salt, JSON.stringify(tokenParams), fingerprint, creditId, sponsorReserveWei, quoteExpiresAt, wantsFreeCredit],
      );
      await client.query("UPDATE games SET status='LAUNCHING',updated_at=now() WHERE id=$1", [gameId]);
      await client.query(
        `INSERT INTO audit_logs(actor_user_id,actor_type,action,resource_type,resource_id,after_data)
         VALUES($1,'USER','PONS_LAUNCH_PREPARED','PONS_LAUNCH',$2,$3::jsonb)`,
        [session.user!.id, launchId, JSON.stringify({ payer, creatorWallet, configId: terms.configId.toString(), launchFee: terms.launchFee.toString(), sponsored: wantsFreeCredit, sponsorReserveWei })],
      );
    });

    if (wantsFreeCredit) await enqueueSponsoredLaunch(launchId);
    const common = {
      launchId,
      status: "AWAITING_SIGNATURE",
      walletAddress: creatorWallet,
      chainId: 4663,
      factory: terms.factory,
      quoteExpiresAt: quoteExpiresAt.toISOString(),
      costs: {
        launchFeeWei: terms.launchFee.toString(),
        developerBuyWei: "0",
        gas: wantsFreeCredit ? "Paid by platform wallet" : "Estimated in wallet",
      },
      freeCredit: {
        requested: wantsFreeCredit,
        sponsorReady,
        method: wantsFreeCredit ? "Platform wallet pays the Pons fee and network gas" : null,
      },
      config: {
        supply: terms.config.supply.toString(),
        curveFeeBps: terms.config.curveFeeBps.toString(),
        graduationThreshold: terms.config.graduationThreshold.toString(),
      },
    };
    if (wantsFreeCredit) {
      return NextResponse.json({ ...common, sponsored: true, payerAddress: payer, creatorFeeRecipient: creatorWallet });
    }
    return NextResponse.json({
      ...common,
      sponsored: false,
      functionName: "launchToken",
      args: [tokenParams, terms.configId.toString(), ZERO_ADDRESS],
      value: terms.launchFee.toString(),
      calldata,
    });
  } catch (error) {
    const rawMessage = safeError(error);
    const message = /SPONSORED_LAUNCH_WALLET_UNFUNDED|SPONSORED_LAUNCH_CAPACITY_RESERVED|SPONSORED_LAUNCH_PREFLIGHT_FAILED/.test(rawMessage)
      ? "The platform launch wallet cannot safely cover the Pons fee and network gas right now. Your credit remains available."
      : /REBATE_AMOUNT_EXCEEDS_OPERATOR_CAP|SPONSORED_LAUNCH_DAILY_BUDGET_RESERVED/.test(rawMessage)
        ? "The free-launch platform budget is currently full. Your credit remains available."
        : rawMessage;
    const status = /FREE_CREDIT|duplicate key|platform launch wallet|platform budget/.test(message) ? 409 : 400;
    const publicMessage = /pons_launches_one_active_per_game_idx|duplicate key/.test(message)
      ? "This game already has an active or confirmed pons launch."
      : message;
    return NextResponse.json({ error: publicMessage }, { status });
  }
}
