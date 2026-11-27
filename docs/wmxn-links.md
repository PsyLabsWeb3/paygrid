# wMXN payment links for Web and MiniPay

Creators can select wMXN in the request form; the connected wallet receives the payment. The same link opens in a normal browser or MiniPay. Web users connect an injected wallet or WalletConnect when configured; MiniPay keeps automatic connection. wMXN links offer direct wMXN payment, with approval limited to the exact amount. Dollar swaps, card and Fonbnk are unavailable for these links. A creator does not need wMXN to request payment; the payer needs the requested wMXN. The backend creation wallet pays the link creation transaction fee and is separate from the dedicated x402 payer.

## Configuration

Backend environment (API and indexer):

```dotenv
CHAIN_ID=42220
CELO_RPC_URL=https://forno.celo.org
PAYGRID_LINK_ADDRESS=0x31Aa9Ba23e4CAC3f41d88fb1C904067c0b3dda89
PAYGRID_ROUTER_ADDRESS=0x8d290c97100f0e87e04Efd1a790F27004fA3f08B
RIPIO_WMXN_ADDRESS=0x337E7456B420bD3481e7FA61fA9850343d610d34
WMXN_LINKS_ENABLED=false
```

`RIPIO_WMXN_ADDRESS` is the existing shared token setting; direct links do not require Ripio API access or enabling the Ripio canary. The flag controls new public wMXN requests. Existing requests remain payable when creation is disabled. Keep x402 flags as configured independently.

The database needs the existing migrations `20260805000014_ripio_wmxn_canary.sql`, `20260924000015_odeleite_partner_links.sql` and `202610150001_wmxn_partner_precision.sql`, including their preceding migrations. No new migration or contract deployment is needed. The service probes atomic link columns before submitting a creation transaction. wMXN remains unavailable if storage, token decimals, network, token allowlist or the active Link/Router binding fails validation.

Frontend build environment:

```dotenv
NEXT_PUBLIC_APP_ENV=production
NEXT_PUBLIC_CHAIN_ID=42220
NEXT_PUBLIC_CELO_RPC_URL=https://forno.celo.org
NEXT_PUBLIC_BACKEND_URL=https://api.celopaygrid.xyz
NEXT_PUBLIC_PAYGRID_ROUTER_ADDRESS=0x8d290c97100f0e87e04Efd1a790F27004fA3f08B
NEXT_PUBLIC_PAYGRID_LINK_ADDRESS=0x31Aa9Ba23e4CAC3f41d88fb1C904067c0b3dda89
```

Set the canonical mainnet USDm/USDC/USDT addresses for the existing dollar flows as usual. Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` for QR/mobile-wallet connection outside MiniPay. Public values are embedded at build time; redeploy the frontend after changing them. wMXN availability comes from `GET /api/links/config`, rather than a frontend-only flag. Sepolia does not advertise wMXN.

## Deployment and checks

1. Deploy the backend image with `WMXN_LINKS_ENABLED=false`. Preserve production secrets and existing flags. On a small VPS, use the established image build process with sufficient Node heap or build off-host.
2. Run `docker compose -f docker-compose.prod.yml run --rm --no-deps backend node dist/payment-links-preflight.js`. It checks proposed wMXN readiness regardless of the creation flag, reports the creator balance and sends no transaction. It must report `wMXN.enabled: true`; also ensure the creation wallet has network fees available.
3. Deploy the frontend to its existing host with the public mainnet settings above. Keep API and indexer token/router settings consistent.
4. Set `WMXN_LINKS_ENABLED=true` in `backend/.env`, then recreate API and indexer: `docker compose -f docker-compose.prod.yml up -d --no-build --force-recreate backend indexer`. Confirm `GET /api/links/config` advertises wMXN and `/health` reports chain 42220.
5. Create a small wMXN request in a web wallet and in MiniPay, then verify the shared URL displays the exact token and amount. This creates a link on-chain and uses backend network fees. Pay only an explicitly approved amount, check approval/payment receipts, transfer and indexer status. Try a second payment and confirm the paid link cannot settle again. Device-level MiniPay and real mainnet transfer checks remain required before claiming production validation.

Rollback sets `WMXN_LINKS_ENABLED=false` and recreates the API. It hides new wMXN creation while preserving settlement of existing requests. Keep the indexer running.

## Amounts and API

Use decimal strings, never floating-point conversion. The API stores `amount_atomic` as text, 18 settlement decimals and `accepted_payer_assets: ["wMXN"]`. The numeric display column limits new requests to 18 whole digits. Excess fractional digits, exponent notation, zero amounts and expired creation times fail before signing. Queries and calldata use the atomic value when available, including values above signed 64-bit range. Legacy dollar links keep their existing conversion choices.

`GET /api/links/:id` includes `amountAtomic`, `tokenAddress`, `chainId`, `settlementDecimals` and accepted payer assets. `POST /api/links/:id/pay` with `method: "crypto", payerToken: "wMXN"` returns exact approval and payment calldata plus the chain ID. The client checks the network and receipt success before reporting a payment. Contract fees are read from the active router; the checked mainnet router charged 1 bp on 2026-11-27.

## Validation evidence

- Offline HTTP tests cover creation, signed transaction calldata, durable atomic amount, link detail, exact quote/payment, disabled capability, fiat/conversion rejection and missing storage/router/token readiness.
- Frontend tests cover token selection, mainnet capability gating, precision limits and existing dollar asset sets. Backend and frontend production builds must pass.
- Read-only mainnet preflight passed on 2026-11-27 against the configured database and active contracts. Browser preview uses fixture data and verifies the long decimal amount, wallet connection and wMXN-only checkout. No funds were moved during implementation.
