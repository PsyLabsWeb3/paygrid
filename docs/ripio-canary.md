# Ripio wMXN mainnet canary

This is an isolated, disabled-by-default flow for one real `SPEI -> wMXN -> Paygrid -> SPEI` test on Celo Mainnet. wMXN is intentionally unavailable in the normal MiniPay token selector.

## Safety gates

`RIPIO_CANARY_ENABLED=false` is the default. When enabled, every quote and run requires:

- chain ID `42220`;
- the configured token to report symbol `wMXN` and 18 decimals;
- Ripio deposit and withdrawal network responses to identify the same wMXN contract on Celo;
- a Celo address from the reusable withdrawal session;
- `PaygridRouterV2.feeBps() == 1`;
- `ROUTER_OWNER_PRIVATE_KEY` to derive the current Router `owner()`;
- the MXN amount to be at or below `RIPIO_CANARY_MAX_MXN` (100 by default).

Failure stops before a quote, order, or payment link is created. The operator key remains server-side and is the existing Router owner key.

## Private data

Run migration `20260805000014_ripio_wmxn_canary.sql`. The three Ripio tables are service-role only. Paygrid stores Ripio IDs and states, the CLABE's final four digits, and an HMAC made with `RIPIO_CLABE_HMAC_SECRET`. It never stores the full CLABE, KYC documents, or RFC.

## API and UI

The authenticated UI is `/ripio-canary`. Its backend surface is:

- `GET/POST /api/ripio/profile`
- `POST /api/ripio/profile/fiat-account`
- `POST /api/ripio/profile/offramp-session`
- `POST /api/ripio/canaries`
- `GET /api/ripio/canaries/:id`
- `POST /api/ripio/canaries/:id/release`
- `POST /api/webhooks/ripio`

Release is limited to Privy IDs in `RIPIO_OPERATOR_PRIVY_IDS` and requires the exact text `RELEASE <run-id>`. The backend rechecks the provider correlation fields, successful ERC-20 transfer to the Router, active link, amount, fee, owner, and contract simulation immediately before signing.

Ripio uses the legacy on-chain `payWithFiat` path, so its on-chain payment-method enum appears as Fonbnk. Supabase records `provider=ripio` and `payment_method=ripio_spei` until a future Router deployment adds a dedicated enum.

## Fee and settlement

The canary does not change the deployed Router. The required effective value is 1 basis point:

```text
fee = gross * 1 / 10,000
net = gross - fee
100 wMXN -> 0.01 wMXN treasury + 99.99 wMXN withdrawal deposit
```

Fonbnk, Ramp, Ripio, the indexer, gifts, and treasury settlement code read the relevant Router's `feeBps()` instead of assuming 50 bps. Each new payment stores `fee_bps`.

## Production sequence

1. Run `npm run ripio:mock-smoke` from `backend/`; it models the full successful lifecycle, provider retry, late event, 1-bp split and final zero Router balance without network calls or funds.
2. Configure production credentials, webhook secret, wMXN address, operator Privy ID, Privy frontend app ID, Router/Link addresses, and the existing owner key.
3. Apply the Supabase migration.
4. Leave the flag false and deploy.
5. Temporarily enable the flag and run `npm run ripio:preflight` from `backend/` (or call `POST /api/ripio/canaries/preflight` while authenticated); this performs no quote, order, link, or transfer.
6. Complete the private profile and verify the Ripio withdrawal address is on Celo.
7. Create one run at or below 100 MXN, send the exact SPEI amount/reference, wait for `READY_FOR_RELEASE`, and release manually.
8. Confirm the treasury fee, Ripio net amount, completed bank transfer, single paid link, and zero unexpected Router balance before disabling the flag again.
