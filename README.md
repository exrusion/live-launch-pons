# Pons Game Studio

Describe a game, generate a controlled HTML5 build, and launch its token through the official pons V2 contracts on Robinhood Chain.

## Local setup

1. Copy `.env.example` to `.env.local` and fill the required values.
2. Run `pnpm install`, `pnpm migrate`, `pnpm seed`, then `pnpm dev`.
3. Run the worker separately with `pnpm worker` when Redis is configured.

The app never stores creator wallet keys. A connected wallet signs every Pons launch transaction. Free launch credits are consumed only after a verified `TokenLaunched` receipt.

## Fee reimbursement safety

The free first launch is a post-confirmation reimbursement: the creator signs and pays the official pons transaction, then the worker sends exactly the persisted `launch_fee_wei`. Configure `SPONSOR_ADDRESS`, `MAX_FREE_LAUNCH_REBATE_WEI`, and `FREE_LAUNCH_DAILY_BUDGET_WEI` on the web service for live funding and liability preflights. Configure the same values plus `SPONSOR_PRIVATE_KEY` only on the worker. The derived key address must match `SPONSOR_ADDRESS`.

The signed reimbursement hash and raw transaction are persisted before broadcast. Retries rebroadcast that same transaction, preventing duplicate transfers after a process crash. Status moves through `PENDING`, `SENDING`, and `SENT` after two confirmations; terminal failures remain visible as `FAILED` with an audit trail. Disable `FREE_LAUNCH_REBATE_ENABLED` to stop new quotes and payouts without losing recorded commitments.

## Production variable checklist

- Required and provisioned: `DATABASE_URL`, `REDIS_URL`, `NEXTAUTH_SECRET`, `APP_URL`, `NEXTAUTH_URL`, `PONS_LAUNCH_ENABLED`, chain RPC/factory values, and feature gates.
- Owner-required for creator accounts: `X_CLIENT_ID` and `X_CLIENT_SECRET`; register `/api/auth/callback/twitter` on the final public origin.
- Owner-required for free-launch reimbursement: `SPONSOR_ADDRESS` on web and worker, `SPONSOR_PRIVATE_KEY` on the worker only, funded Robinhood Chain ETH, per-launch/daily caps, then `FREE_LAUNCH_REBATE_ENABLED=true` on both services.
- Optional: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` for QR/deep-link WalletConnect in addition to injected browser wallets.
- Optional generation/storage adapters: `AI_*` and `S3_*`; deterministic local generation and PostgreSQL immutable asset storage work when these are blank.
