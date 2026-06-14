# Deployment

## Infrastructure

```
                    ┌─────────────┐
                    │    DNS      │
                    │ paygrid.xyz │
                    └──────┬──────┘
                           │
           ┌───────────────┼────────────────┐
           ▼               ▼                ▼
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │   Vercel     │ │   VPS        │ │   VPS        │
   │  Frontend    │ │ Backend API  │ │ Agent +      │
   │ (minipay/)   │ │ + Indexer    │ │ Indexer      │
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
| Agent Runtime | **VPS** (Docker Compose, later phase) | Long-running, persistent wallet, x402 server |
| Database | **Supabase** | Managed PostgreSQL, free tier |
| Blockchain | **Celo Mainnet** | Production |
| Blockchain test | **Celo Sepolia** | Development |

---

## VPS Setup (Backend API + Indexer)

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

# 6. Build and start services
sudo docker compose -f docker-compose.prod.yml up -d --build

# 7. Check status
sudo docker compose -f docker-compose.prod.yml ps
sudo docker compose -f docker-compose.prod.yml logs -f backend
```

### Docker Compose services

`docker-compose.prod.yml` runs two backend containers from the same image:

```bash
sudo docker compose -f docker-compose.prod.yml up -d --build
sudo docker compose -f docker-compose.prod.yml logs -f backend
sudo docker compose -f docker-compose.prod.yml logs -f indexer
sudo docker compose -f docker-compose.prod.yml restart backend indexer
```

The API binds to `127.0.0.1:3001` so only Nginx can expose it publicly. The indexer has no public port.

### Nginx reverse proxy + SSL

```nginx
server {
    listen 80;
    server_name api.paygrid.xyz;

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

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.paygrid.xyz
```

---

## Vercel Setup (Frontend)

### Frontend (minipay/)

```
Framework: Next.js 14 (App Router)
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
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Privy
NEXT_PUBLIC_PRIVY_APP_ID=...

# Backend
BACKEND_URL=https://api.paygrid.xyz

# Celo
NEXT_PUBLIC_CELO_RPC=https://forno.celo.org
```

### VPS (Backend API + Indexer)

```bash
# Backend API
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
CELO_RPC_URL=https://forno.celo-sepolia.celo-testnet.org
CHAIN_ID=11142220
PAYGRID_LINK_ADDRESS=0x58b7125e0bed4d082985c76b772bf84808e5a474
PAYGRID_ROUTER_ADDRESS=0xb3fe724934de14afd56157bacb8ed6907a3d091b
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
```

---

## Contract Addresses

| Contract | Sepolia | Mainnet |
|----------|---------|---------|
| PaygridRouter | `0xb3fe724934de14afd56157bacb8ed6907a3d091b` | deployed |
| PaygridLink | `0x58b7125e0bed4d082985c76b772bf84808e5a474` | deployed |
| Paygrid Treasury | `0xd4683314a013792fe8840e4171dc4692e317617b` | TBD |
| USDm | same as mainnet | `0x765DE816845861e75A25fCA122bb6898B8B1282a` |
| USDC | same as mainnet | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` |
| USDT | same as mainnet | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` |
| ERC-8004 Identity | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |

---

## CI/CD

### Vercel (auto)

```text
git push main → Vercel auto-builds minipay/ → deploys paygrid.xyz frontend
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
| `paygrid.xyz` | A/CNAME | Vercel |
| `www.paygrid.xyz` | CNAME | `paygrid.xyz` |
| `api.paygrid.xyz` | A | VPS IP |
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
