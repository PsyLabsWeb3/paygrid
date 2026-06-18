# Deployment

## Infrastructure

```
                    ┌─────────────┐
                    │    DNS      │
                    │ celopaygrid.xyz │
                    └──────┬──────┘
                           │
           ┌───────────────┼────────────────┐
           ▼               ▼                ▼
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │   Vercel     │ │   VPS        │ │   VPS        │
   │  Frontend    │ │ Backend API  │ │ MCP HTTP +   │
   │ (minipay/)   │ │ + Indexer    │ │ Agent later  │
   └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
          │                │                │
          └────────────────┼────────────────┘
                           ▼
              ┌─────────────────────┐
              │     Supabase        │
              │     (PostgreSQL)    │
              └─────────────────────┘
                           │
                           ▼
              ┌─────────────────────┐
              │    Celo Mainnet     │
              │    RPC (forno)      │
              └─────────────────────┘
```

| Service | Target | Why |
|---------|--------|-----|
| Frontend (minipay/) | **Vercel** | Next.js, edge-optimized, free tier |
| Backend API | **VPS** (Docker Compose) | Standalone `backend/` service, persistent auth + chain access |
| Event Indexer | **VPS** (Docker Compose) | Long-running, Viem `watchContractEvent` |
| MCP HTTP | **VPS** (Docker Compose) | Remote agent/builder interface for Paygrid tools |
| Agent Runtime | **VPS** (Docker Compose, later phase) | Long-running, persistent wallet, x402 server |
| Database | **Supabase** | Managed PostgreSQL, free tier |
| Blockchain | **Celo Mainnet** | Production |
| Blockchain test | **Celo Sepolia** | Development |

---

## VPS Setup (Backend API + Indexer + MCP HTTP)

### Specs

- OS: Ubuntu 22.04 LTS
- CPU: 1 vCPU (minimum)
- RAM: 1 GB (minimum)
- Disk: 25 GB SSD
- Provider: Hetzner ($4/mo), DigitalOcean ($6/mo), or OVH ($3.5/mo)

### Setup script

```bash
# 1. System dependencies
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git nginx

# 2. Docker Engine
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 3. Firewall
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw enable

# 4. Clone repo
git clone https://github.com/PsyLabs/paygrid.git /opt/paygrid
cd /opt/paygrid

# 5. Environment
cp backend/.env.example backend/.env
# Edit backend/.env with production keys
cp mcp/.env.example mcp/.env
# Edit mcp/.env with MCP public URL, API key, and optional agent key

# 6. Build and start services
sudo docker compose -f docker-compose.prod.yml up -d --build

# 7. Check status
sudo docker compose -f docker-compose.prod.yml ps
sudo docker compose -f docker-compose.prod.yml logs -f backend
```

### Docker Compose services

`docker-compose.prod.yml` runs backend, indexer, and MCP HTTP:

```bash
sudo docker compose -f docker-compose.prod.yml up -d --build
sudo docker compose -f docker-compose.prod.yml logs -f backend
sudo docker compose -f docker-compose.prod.yml logs -f indexer
sudo docker compose -f docker-compose.prod.yml logs -f mcp-http
sudo docker compose -f docker-compose.prod.yml restart backend indexer mcp-http
```

The API binds to `127.0.0.1:3001` and MCP HTTP binds to `127.0.0.1:3002`, so only Nginx can expose them publicly. The indexer has no public port.

### Nginx reverse proxy + SSL

```nginx
server {
    listen 80;
    server_name api.celopaygrid.xyz;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```nginx
server {
    listen 80;
    server_name mcp.celopaygrid.xyz;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.celopaygrid.xyz -d mcp.celopaygrid.xyz
```

---

## Vercel Setup (Frontend)

### Frontend (minipay/)

```
Framework: Next.js (App Router)
Root directory: minipay/
Build command: npm run build
Output directory: .next
Deploy: git push main → Vercel auto-deploy
```

Single Vercel deploy handles the frontend only. API traffic goes to `backend/` on the VPS.

---

## Environment Variables

### Vercel (Frontend)

```bash
# Backend
NEXT_PUBLIC_BACKEND_URL=https://api.celopaygrid.xyz
NEXT_PUBLIC_APP_ENV=production

# Celo
NEXT_PUBLIC_CHAIN_ID=42220
NEXT_PUBLIC_CELO_RPC_URL=https://forno.celo.org
NEXT_PUBLIC_PAYGRID_LINK_ADDRESS=0x...
NEXT_PUBLIC_PAYGRID_ROUTER_ADDRESS=0x...
NEXT_PUBLIC_USDC_ADDRESS=0xcebA9300f2b948710d2653dD7B07f33A8B32118C
```

### VPS (Backend API + Indexer)

```bash
# Backend API
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
CELO_RPC_URL=https://forno.celo-sepolia.celo-testnet.org
CHAIN_ID=11142220
PAYGRID_LINK_ADDRESS=0x86D9B260F96873e82852B476ff7B0c93bD755597
PAYGRID_ROUTER_ADDRESS=0x6c3363D33eCD912576051316AF0A1c95F77EAD73
BACKEND_WALLET_PRIVATE_KEY=0x...
PRIVY_APP_ID=...
PRIVY_APP_SECRET=...
PRIVY_JWT_VERIFICATION_KEY=...
PORT=3001

# Agent
AGENT_PRIVATE_KEY=0x...         # Payment wallet
AGENT_OWNER_PRIVATE_KEY=0x...   # Owner wallet (#9113)
AGENT_API_KEY=sk_...
ERC8004_AGENT_ID=9113
THIRDWEB_SECRET_KEY=...

# Fonbnk
FONBNK_API_KEY=...
ROUTER_OWNER_PRIVATE_KEY=0x...
FONBNK_WEBHOOK_SECRET=...

# MCP HTTP remote
PAYGRID_MCP_API_KEY=sk_...
MCP_PUBLIC_BASE_URL=https://mcp.celopaygrid.xyz
```

`mcp/.env` should contain MCP-specific values only. Do not reuse `backend/.env` for MCP because the MCP service does not need Supabase service-role keys or backend relayer keys.

---

## Contract Addresses

| Contract | Sepolia | Mainnet |
|----------|---------|---------|
| PaygridRouter | `0x6c3363D33eCD912576051316AF0A1c95F77EAD73` | TBD |
| PaygridLink | `0x86D9B260F96873e82852B476ff7B0c93bD755597` | TBD |
| Paygrid Treasury | `0xd4683314a013792fe8840e4171dc4692e317617b` | TBD |
| USDm | same as mainnet | `0x765DE816845861e75A25fCA122bb6898B8B1282a` |
| USDC | same as mainnet | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` |
| USDT | same as mainnet | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` |
| ERC-8004 Identity | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |

---

## Mainnet Launch Gate

Do not deploy to Celo mainnet until all of these are true:

- Supabase production has applied every migration in `backend/supabase/migrations`.
- `forge test` passes after the `PaymentMethod.Card` contract change.
- `backend/src/lib/contracts/*.json` ABIs include `payWithCard`.
- Backend build and tests pass.
- MiniPay build passes with production env values.
- MCP tests pass and `/health` works locally.
- Ramp production key is approved, or the UI keeps card checkout disabled/hidden in production.
- A small Sepolia E2E payment is confirmed as `paid` by the indexer.

After mainnet deploy:

1. Save deployed contract addresses in backend and frontend envs.
2. Verify contracts on CeloScan.
3. Run one small stablecoin payment.
4. Confirm Supabase `payment_links.status = paid`.
5. Confirm `mcp.celopaygrid.xyz/health`.
6. Register/update Paygrid ERC-8004 metadata with API, MCP, wallet, and supported trust fields.

---

## CI/CD

### Vercel (auto)

```text
git push main → Vercel auto-builds minipay/ → deploys celopaygrid.xyz frontend
```

### VPS (GitHub Actions)

```yaml
# .github/workflows/deploy-vps.yml
name: Deploy to VPS

on:
  push:
    branches: [main]
    paths:
      - "backend/**"
      - "agent/**"

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: deploy
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/paygrid
            git pull origin main
            cd backend && npm install --production && npm run build
            cd ../agent && npm install --production && npm run build
            pm2 reload all
```

---

## DNS Records

| Subdomain | Type | Target |
|-----------|------|--------|
| `celopaygrid.xyz` | A/CNAME | Vercel |
| `www.celopaygrid.xyz` | CNAME | `celopaygrid.xyz` |
| `api.celopaygrid.xyz` | A | VPS IP |
| `agent.celopaygrid.xyz` | A | VPS IP |

---

## Monitoring

- PM2: `pm2 status`, `pm2 logs`, `pm2 monit`
- Vercel: Dashboard logs + analytics
- Supabase: Dashboard query performance
- Celoscan: On-chain activity verification
- 8004scan: Agent reputation tracking

## Sepolia Deploy (Demo)

We performed a demo deployment to the Celo Sepolia testnet. The canonical deployment record and the raw broadcast receipts are stored in the repository for auditability and reproducibility.

- Network: Celo Sepolia (chainId: 11142220)
- Deployer: 0xd4683314a013792fe8840e4171dc4692e317617b
- Timestamp: recorded in the broadcast JSON at contracts/broadcast/*/run-latest.json

Deployed contracts (Sepolia):

- PaygridLink: 0x58B7125E0bed4d082985C76b772BF84808e5a474
  - tx: 0x5cdd12d7f398937c7a2915088dd58147106c6428457d29b4ebfd9ae06d0a947d
- PaygridRouter: 0xb3fE724934DE14Afd56157BaCB8ed6907A3D091B
  - tx: 0x97621473662b2c2a9a19bb50e2c75ac354789ee96d52502aeed0aa7903bb25e1

Repository artifacts:

- Broadcast JSON (raw): `contracts/broadcast/DeployHex.s.sol/11142220/run-latest.json`
- Canonical deployments record: `contracts/deployments.sepolia.json`

Security notes:

- Any private keys used for the deploy were removed from the workspace immediately after the run. See `contracts/ENV_REMOVED_NOTICE.txt` and `agent/ENV_REMOVED_NOTICE.txt` for details and rotation recommendations.
- Do not commit any `.env` files or private keys. The repository `.gitignore` was updated to exclude `contracts/.env` and `agent/.env`.
