# Deployment

## Production Shape

Paygrid production has three public surfaces:

| Surface | Target | Runtime |
|---|---|---|
| `https://celopaygrid.xyz` | Vercel | `minipay/` Next.js app |
| `https://api.celopaygrid.xyz` | VPS + Nginx | `backend` Docker service |
| `https://mcp.celopaygrid.xyz` | VPS + Nginx | `mcp-http` Docker service |

The same VPS also runs the private `indexer` and `treasury-worker` Docker services. Neither has a public port.

The current agent runtime in `agent/` is CLI-based. The remote agent/builder interface is the MCP HTTP service, which signs Paygrid backend requests as an ERC-8004 agent when configured with `AGENT_PRIVATE_KEY` and `ERC8004_AGENT_ID`.

## Celo Mainnet Values

| Item | Value |
|---|---|
| Chain ID | `42220` |
| RPC | `https://forno.celo.org` |
| Explorer | `https://celoscan.io` |
| USDC token | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` |
| USDT token | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` |
| USDm token | `0x765DE816845861e75A25fCA122bb6898B8B1282a` |
| ERC-8004 Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ERC-8004 Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |

For Celo fee abstraction, USDC/USDT gas payment uses adapter addresses, not token addresses. Paygrid contract settlement still uses token addresses.

## Mainnet Launch Gate

Do not deploy to mainnet until:

- `forge test` passes.
- `backend npm run build && npm test` passes.
- `minipay npm run build && npm test` passes.
- `mcp npm test` passes.
- Supabase production has all migrations in `backend/supabase/migrations`.
- Sepolia E2E has passed: create request, pay USDC, indexer marks `paid`, MCP `verify_payment` returns `paid: true`.
- Ramp production key is approved, or card checkout is hidden/disabled in production.
- Deployer wallet has enough CELO for mainnet deployment.
- Backend relayer wallet has enough CELO for mainnet request creation.

## Mainnet Deploy Order

1. Create/confirm production Supabase project.
2. Apply migrations:

```bash
cd backend
cp .env.mainnet.example .env
# fill DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
npm run db:migrate
```

3. Deploy contracts:

```bash
cd contracts
cp .env.mainnet.example .env
# fill PRIVATE_KEY and TREASURY_ADDRESS
set -a && source .env && set +a
forge script script/Deploy.s.sol:Deploy --rpc-url celo-mainnet --broadcast
```

4. Save mainnet contract addresses in:

- `backend/.env`
- `mcp/.env` if needed for metadata.
- Vercel `minipay/` environment variables.
- This document's contract table.

5. Rebuild and restart VPS services:

```bash
sudo docker compose -f docker-compose.prod.yml up -d --build backend indexer treasury-worker mcp-http
sudo docker compose -f docker-compose.prod.yml ps
```

6. Deploy frontend from Vercel with `minipay/` as root directory.
7. Run mainnet smoke test with a tiny stablecoin amount.
8. Register/update ERC-8004 metadata with API, MCP, wallet, and trust fields.

## VPS Setup

Recommended minimum:

- Ubuntu 22.04 LTS
- 1 vCPU
- 1 GB RAM
- 25 GB SSD

Install Docker and Nginx:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git nginx

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

Clone and configure:

```bash
git clone https://github.com/PsyLabs/paygrid.git /opt/paygrid
cd /opt/paygrid
cp backend/.env.mainnet.example backend/.env
cp mcp/.env.mainnet.example mcp/.env
```

Start:

```bash
sudo docker compose -f docker-compose.prod.yml up -d --build
sudo docker compose -f docker-compose.prod.yml logs -f backend
sudo docker compose -f docker-compose.prod.yml logs -f indexer
sudo docker compose -f docker-compose.prod.yml logs -f treasury-worker
sudo docker compose -f docker-compose.prod.yml logs -f mcp-http
```

## Nginx

Backend:

```nginx
server {
    listen 80;
    server_name api.celopaygrid.xyz;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

MCP:

```nginx
server {
    listen 80;
    server_name mcp.celopaygrid.xyz;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

SSL:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.celopaygrid.xyz -d mcp.celopaygrid.xyz
```

## DNS

| Name | Type | Target |
|---|---|---|
| `celopaygrid.xyz` | A/CNAME | Vercel |
| `www.celopaygrid.xyz` | CNAME | `celopaygrid.xyz` |
| `api.celopaygrid.xyz` | A | VPS IP |
| `mcp.celopaygrid.xyz` | A | VPS IP |

## Vercel

Project settings:

```text
Framework: Next.js
Root directory: minipay/
Build command: npm run build
Output directory: .next
```

Environment:

```bash
NEXT_PUBLIC_BACKEND_URL=https://api.celopaygrid.xyz
NEXT_PUBLIC_APP_ENV=production
NEXT_PUBLIC_CHAIN_ID=42220
NEXT_PUBLIC_CELO_RPC_URL=https://forno.celo.org
NEXT_PUBLIC_PAYGRID_LINK_ADDRESS=0x...
NEXT_PUBLIC_PAYGRID_ROUTER_ADDRESS=0x...
NEXT_PUBLIC_PAYGRID_GIFT_VAULT_ADDRESS=0x...
NEXT_PUBLIC_PAYGRID_GIFT_ROUTER_ADDRESS=0x...
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...
NEXT_PUBLIC_MINIPAY_DEEPLINK_ENABLED=false
NEXT_PUBLIC_CELO_ATTRIBUTION_CODE=...
NEXT_PUBLIC_USDC_ADDRESS=0xcebA9300f2b948710d2653dD7B07f33A8B32118C
```

The backend and MCP containers also require `PAYGRID_GIFT_VAULT_ADDRESS` and `PAYGRID_GIFT_ROUTER_ADDRESS`. The backend requires a dedicated `GIFT_CLAIM_SIGNER_PRIVATE_KEY`; its address must match the signer passed to `DeployGifts.s.sol`.

### Treasury Quant Agent

Apply `20260716000007_treasury_quant_agent.sql` and
`20260716000008_treasury_dual_price_monitor.sql`, followed by
`20260718000009_treasury_xaut0.sql`, before starting the
`treasury-worker`. Deploy with:

```text
TREASURY_QUANT_ENABLED=false
TREASURY_QUANT_MODE=paper
```

Then configure `TREASURY_SIGNAL_SECRET`, `TREASURY_ADMIN_API_KEY`, conservative
risk limits and an optional paper-mode executor address. Enable paper mode and
send a TradingView signal through the IP-allowlisted Nginx route:

```text
POST https://api.celopaygrid.xyz/webhooks/tradingview/treasury
```

Only switch to `live` after paper signals, Mento quotes, pause/resume, manual
close and TP/SL monitoring have been verified. Live mode requires a dedicated
execution wallet with no contract ownership or treasury roles. Keep its balance
limited to the active risk budget. Every approval and swap uses
`CELO_ATTRIBUTION_CODE`. Mainnet CELO monitoring uses the Chainlink CELO/USD
feed, while the DEX quote uses the entire position size. Configure conservative
oracle age and oracle/DEX divergence limits; either safety failure pauses new
entries and blocks automated execution.

For XAUt0/USDT on Celo mainnet configure:

```text
TREASURY_XAUT0_ADDRESS=0xaf37E8B6C9ED7f6318979f56Fc287d76c30847ff
TREASURY_XAUT0_ORACLE_ADDRESS=0x98DC6E90D4c2f212ed9d124aD2aFBa4833268633
TREASURY_XAUT0_ORACLE_MAX_AGE_SECONDS=90000
```

The XAUt0 oracle is RedStone XAUt/USDT. The direct Celo Uniswap V3 pool is
`0xbb469a28f64c72aecc7d05ca6e45b2fb1a63b4f9`; the router discovers its 3000
fee tier through the supported fee-tier fallback list. TradingView signals use
`XAUTUSDT` with canonical `baseAsset: "XAUT0"` and `quoteAsset: "USDT"`.

Set `TREASURY_MAX_OPEN_POSITIONS_PER_ASSET` explicitly before enabling live
round-robin entries. Start with a small count; each position retains its own
TP/SL, but all positions share the executor wallet and aggregate exposure cap.

### Optional sponsored gift claims

Apply migration `20260713000006_gift_gas_sponsorships.sql` before enabling claim sponsorship. Deploy the backend first with `GIFT_GAS_SPONSOR_ENABLED=false`, create a dedicated sponsor key with no administrative roles, fund it with small CELO and USDm operating balances, and only then set the flag to `true` and recreate the backend container. The sponsor pays its own stipend-transfer fee in CELO; recipients receive USDm for the claim fee.

Required settings are documented in `backend/.env.example`. For Celo mainnet, the verified fee-currency adapters are `0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B` for USDC and `0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72` for USDT. Keep the daily amount, daily count and per-claim caps at their conservative defaults for the first smoke tests.

## MCP HTTP

Public endpoints:

```text
GET  https://mcp.celopaygrid.xyz/health
GET  https://mcp.celopaygrid.xyz/metadata
GET  https://mcp.celopaygrid.xyz/.well-known/paygrid-agent.json
POST https://mcp.celopaygrid.xyz/mcp
```

Write tools require:

```text
Authorization: Bearer <PAYGRID_MCP_API_KEY>
```

or:

```text
X-API-Key: <PAYGRID_MCP_API_KEY>
```

## Contract Addresses

| Contract | Sepolia | Mainnet |
|---|---|---|
| PaygridRouter | `0x6c3363D33eCD912576051316AF0A1c95F77EAD73` | legacy: `0x2924FEf3eF7c3ADBFF22b286C42764a96c53f9f4` |
| PaygridRouterV2 | TBD | `0x8d290c97100f0e87e04Efd1a790F27004fA3f08B` |
| PaygridLink | `0x86D9B260F96873e82852B476ff7B0c93bD755597` | `0x31Aa9Ba23e4CAC3f41d88fb1C904067c0b3dda89` |
| Mento Router | TBD | `0x4861840C2EfB2b98312B0aE34d86fD73E8f9B6f6` |
| Paygrid Treasury | `0xd4683314a013792fe8840e4171dc4692e317617b` | `0xc0C019DCeCE7a3a235Ab520F394A57c132F90cD6` |

## Smoke Tests

Backend:

```bash
curl https://api.celopaygrid.xyz/health
```

MCP:

```bash
curl https://mcp.celopaygrid.xyz/health
curl https://mcp.celopaygrid.xyz/metadata
```

MCP tools:

```bash
curl -s -X POST https://mcp.celopaygrid.xyz/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Mainnet payment:

1. Create a payment request from MiniPay or MCP.
2. Pay a tiny amount with the exact requested token.
3. Confirm `payment_links.status = paid`.
4. Create or reuse a link requesting USDC and quote payment with USDT.
5. Confirm `protocol = mento` and complete the swap-enabled payment.
4. Confirm MCP `verify_payment` returns `paid: true`.
