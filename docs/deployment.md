# Deployment

## Infrastructure

```
                    ┌─────────────┐
                    │    DNS       │
                    │ paygrid.xyz  │
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │   Vercel     │ │   Vercel     │ │   VPS         │
   │   Frontend   │ │   API Routes │ │   Agent +      │
   │   (Next.js)  │ │   /api/*     │ │   Indexer      │
   └──────┬───────┘ └──────┬───────┘ └──────┬────────┘
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
| Backend API | **Vercel** (API Routes) | Same repo, serverless, auto-scale |
| Agent Runtime | **VPS** (Ubuntu + PM2) | Long-running, persistent wallet, x402 server |
| Event Indexer | **VPS** (Ubuntu + PM2) | Long-running, Viem watchContractEvent |
| Database | **Supabase** | Managed PostgreSQL, free tier |
| Blockchain | **Celo Mainnet** | Production |
| Blockchain test | **Celo Sepolia** | Development |

---

## VPS Setup (Agent + Indexer)

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
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git nginx

# 2. PM2 for process management
npm install -g pm2

# 3. Firewall
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw enable

# 4. Clone repo
git clone https://github.com/PsyLabs/paygrid.git /opt/paygrid
cd /opt/paygrid

# 5. Install deps
cd agent && npm install

# 6. Environment
cp agent/.env.example agent/.env
# Edit agent/.env with real keys

# 7. Start services
pm2 start agent/src/index.js --name paygrid-agent
pm2 start backend/src/indexer.js --name paygrid-indexer
pm2 save
pm2 startup
```

### PM2 ecosystem file (`/opt/paygrid/ecosystem.config.js`)

```javascript
module.exports = {
  apps: [
    {
      name: "paygrid-agent",
      script: "agent/src/index.js",
      env: { NODE_ENV: "production" },
      max_restarts: 5,
      restart_delay: 10000,
    },
    {
      name: "paygrid-indexer",
      script: "backend/src/indexer.js",
      env: { NODE_ENV: "production" },
      max_restarts: 5,
      restart_delay: 5000,
    },
  ],
};
```

### Nginx reverse proxy + SSL

```nginx
server {
    listen 80;
    server_name agent.paygrid.xyz;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d agent.paygrid.xyz
```

---

## Vercel Setup (Frontend + API)

### Frontend (minipay/)

```
Framework: Next.js 14 (App Router)
Root directory: minipay/
Build command: npm run build
Output directory: .next
Deploy: git push main → Vercel auto-deploy
```

### API Routes (co-located in minipay/)

```
minipay/src/app/api/links/route.ts
minipay/src/app/api/links/[id]/route.ts
minipay/src/app/api/links/[id]/pay/route.ts
minipay/src/app/api/payments/route.ts
minipay/src/app/api/onramp/fonbnk/config/route.ts
minipay/src/app/api/onramp/fonbnk/webhook/route.ts
minipay/src/app/api/x402/[...path]/route.ts
```

Single Vercel deploy handles frontend + API. Less ops complexity.

---

## Environment Variables

### Vercel (Frontend + API Routes)

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=...     # Server-side only

# Privy Auth
NEXT_PUBLIC_PRIVY_APP_ID=...

# Fonbnk
FONBNK_API_KEY=...

# Celo
NEXT_PUBLIC_CELO_RPC=https://forno.celo.org
CELO_SEPOLIA_RPC=https://forno.celo-sepolia.celo-testnet.org
```

### VPS (Agent + Indexer)

```bash
# Agent
AGENT_PRIVATE_KEY=0x...         # Payment wallet
AGENT_OWNER_PRIVATE_KEY=0x...   # Owner wallet (#9113)
BACKEND_URL=https://api.paygrid.xyz
AGENT_API_KEY=sk_...
ERC8004_AGENT_ID=9113
THIRDWEB_SECRET_KEY=...

# Indexer
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
CELO_RPC_URL=https://forno.celo.org
PAYGRID_ROUTER_ADDRESS=0x...    # After contract deploy
PAYGRID_LINK_ADDRESS=0x...      # After contract deploy

# Fonbnk
FONBNK_API_KEY=...
```

---

## Contract Addresses

| Contract | Sepolia | Mainnet |
|----------|---------|---------|
| PaygridRouter | TBD (after deploy) | TBD (after deploy) |
| PaygridLink | TBD (after deploy) | TBD (after deploy) |
| Paygrid Treasury | TBD | TBD |
| USDm | same as mainnet | `0x765DE816845861e75A25fCA122bb6898B8B1282a` |
| USDC | same as mainnet | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` |
| USDT | same as mainnet | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` |
| ERC-8004 Identity | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |

---

## CI/CD

### Vercel (auto)
```
git push main → Vercel auto-builds minipay/ → deploys to paygrid.xyz
```

### VPS (GitHub Actions)
```yaml
# .github/workflows/deploy-vps.yml
name: Deploy to VPS

on:
  push:
    branches: [main]
    paths:
      - "agent/**"
      - "backend/src/indexer.js"

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
            cd agent && npm install --production
            pm2 reload all
```

---

## DNS Records

| Subdomain | Type | Target |
|-----------|------|--------|
| `paygrid.xyz` | A/CNAME | Vercel |
| `www.paygrid.xyz` | CNAME | `paygrid.xyz` |
| `agent.paygrid.xyz` | A | VPS IP |

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

- PaygridLink: 0xd2dC71C47803b0939944Ec29fF3B644C48bAE7De
  - tx: 0xb74e33a3134b7374e2898fb8b019b1759b8c6128c52e6e8ccb4b9ca6e99fb53f
- PaygridRouter: 0xe75027fF07931EF97248402f4DF63a4D3287020d
  - tx: 0xdc5c82292f2260dffa497b8ba1749ae011f481dc00142b728de2af22f1129643

Repository artifacts:

- Broadcast JSON (raw): `contracts/broadcast/DeployHex.s.sol/11142220/run-latest.json`
- Canonical deployments record: `contracts/deployments.sepolia.json`

Security notes:

- Any private keys used for the deploy were removed from the workspace immediately after the run. See `contracts/ENV_REMOVED_NOTICE.txt` and `agent/ENV_REMOVED_NOTICE.txt` for details and rotation recommendations.
- Do not commit any `.env` files or private keys. The repository `.gitignore` was updated to exclude `contracts/.env` and `agent/.env`.
