# Paygrid — Agent Context

Read this file if you are an AI agent working on this repo. It contains all the context needed to contribute correctly. Read SPEC.md for the full project brief.

---

## What is Paygrid?

Paygrid is a MiniApp for MiniPay (Celo) that provides global stablecoin payment links for agent-to-agent, agent-to-human, and human-to-agent settlement. It enables AI agents and humans to create payment links, receive stablecoin payments, automate payouts, and coordinate cross-border transactions — instantly, without banks or traditional payment rails.

Built for the autonomous agent economy and emerging markets where traditional platforms like Stripe or PayPal are limited or inaccessible.

---

## Use Cases (in priority order)

### 1. Agent-to-Agent — Pay-per-Task API Monetization
Developers and companies protect APIs or services with x402. An AI agent sends a request, receives a 402 Payment Required, automatically pays in USDC, and gets the result. No account setup, no manual invoicing. Fee: 0.5% per transaction charged to the recipient.

### 2. Agent-to-Human — Agent as Payer / Treasurer
An autonomous agent manages payments for a team or protocol. It generates invoices, creates payment links, executes payouts, and reports on-chain activity. The agent operates with its own dedicated wallet registered on-chain via ERC-8004.

### 3. Human-to-Agent — Monetizing Agent Services
A human pays an AI agent for services (research, automation, data processing) via payment link or x402 endpoint. Payment methods: crypto (MiniPay wallet) or fiat (Fonbnk airtime onramp). The agent receives USDC and delivers results.

### 4. Human-to-Human — Global Freelancer
Any person creates a payment link from MiniPay and shares it via WhatsApp, email, or social media. The client pays from any compatible wallet — or with local currency via Fonbnk. The freelancer receives cUSD/USDC/USDT instantly, without a bank account.

---

## Business Model

- 0.5% fee per transaction, charged to the recipient on each received payment
- Fee is collected by PaygridRouter.sol and sent to the Paygrid treasury address
- Future roadmap: volume API tier, multi-stablecoin conversion spread, white-label

---

## Repo Structure

```
paygrid/
├── SPEC.md
├── AGENTS.md
├── .agents/skills/celopedia-skill/
├── contracts/
├── backend/
├── agent/
├── minipay/
├── docs/
└── tasks/
```

---

## System Modules

- contracts/ — Smart contracts: PaygridRouter.sol (receives payment, splits 0.5% fee to treasury, sends remainder to recipient) and PaygridLink.sol (creates and manages payment links on-chain). Built with Foundry.
- backend/ — REST API for payment link generation and management, webhook system for payment confirmation (including Fonbnk onramp webhooks), on-chain event indexer via Viem watchContractEvent, x402 protected endpoints for pay-per-task. Uses Supabase for data persistence and Privy for authentication.
- agent/ — Autonomous AI agent with dedicated ERC-8004 wallet, Vercel AI SDK for reasoning and tools, thirdweb/x402 for autonomous payments, @chaoschain/sdk for on-chain identity registration.
- minipay/ — Next.js MiniApp: MiniPay auto-connect, create payment link UI, pay a received link UI (crypto + Fonbnk fiat), payment history, MiniPay deeplinks for receipts and deposits.
- docs/ — Technical specifications (architecture, contracts, API, data model). Read-only reference for agents and devs.
- tasks/ — Active work items per module. Check these before starting any work.

---

## Agent Wallet Setup

The agent has a dedicated wallet (not a user wallet). It is:
- Generated via generatePrivateKey() from viem/accounts
- Private key stored in .env as AGENT_PRIVATE_KEY — never committed
- Registered on-chain in ERC-8004 Identity Registry with its address in the metadata endpoints
- Funded with USDC or USDm on Celo Mainnet to pay for x402 requests and gas

---

## Fiat Onramp (Fonbnk)

Payers without crypto can settle payment links with local currency via Fonbnk.

- Provider: Fonbnk (https://fonbnk.com)
- No KYC: the mobile carrier handles identity verification
- Coverage: 150+ countries (Africa, LATAM, Asia, Middle East)
- Flow: payer picks "Pay with mobile" → selects carrier → tops up airtime → Fonbnk converts to stablecoin → Paygrid receives the payment
- Backend endpoints: `GET /api/onramp/fonbnk/config` (carriers + rates), `POST /api/onramp/fonbnk/webhook` (payment confirmation)
- Env: `FONBNK_API_KEY` required

---

## Hackathon Context

- Event: Onchain Agents Hackathon — Celo (May 22 – June 15, 2026)
- The agent must generate real on-chain transactions to qualify
- Registration requires an ERC-8004 agentId and a Karma project link
- Tracks: Best Agent on Celo ($2,500), Most On-chain Activity ($500), Highest Rank in 8004scan ($500)
- Final submission via Celopedia Skill — last week of hackathon
- Deadline: June 15, 2026 — 9 AM GMT

---

## Stack

- Framework: Next.js 14 (App Router)
- Blockchain SDK: Viem v2 + Wagmi
- Styles: Tailwind CSS
- Contracts: Foundry (Solidity)
- Agent: Vercel AI SDK
- Agent payments: thirdweb/x402
- Agent identity: @chaoschain/sdk (ERC-8004)
- Database: Supabase (PostgreSQL)
- Auth: Privy
- Onramper: Fonbnk
- Deploy: Vercel
- Main network: Celo Mainnet (chainId: 42220)
- Test network: Celo Sepolia (chainId: 11142220)

---

## What you must NOT do

- No maxFeePerGas or maxPriorityFeePerGas — MiniPay only accepts legacy transactions
- No personal_sign or eth_signTypedData — not supported in MiniPay
- Never show CELO in the UI — only USDm, USDC, USDT
- Do not use Ethers.js or web3.js — only Viem has native feeCurrency support
- Do not use Alfajores testnet — use Celo Sepolia (chainId: 11142220)
- Never hardcode amounts without checking decimals — USDC/USDT are 6 decimals, USDm is 18
- Never show 0x addresses as primary user identifier — use phone number via ODIS
- Never commit AGENT_PRIVATE_KEY or any private key to the repo
- Never assume all payers have a wallet — always offer fiat option via Fonbnk
- Never hardcode Fonbnk carriers — use the availability API by country

---

## Useful Commands

```
npm run dev
ngrok http 3000
forge build
forge test --fork-url https://forno.celo.org
forge script script/Deploy.s.sol --rpc-url https://forno.celo-sepolia.celo-testnet.org --broadcast
npx skills add celo-org/celopedia-skills
```

---

## Key Addresses (Mainnet)

| Token/Contract      | Address                                      |
|----------------------|----------------------------------------------|
| USDm                 | 0x765DE816845861e75A25fCA122bb6898B8B1282a    |
| USDC                 | 0xcebA9300f2b948710d2653dD7B07f33A8B32118C    |
| USDT                 | 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e    |
| USDC feeCurrency     | 0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B    |
| USDT feeCurrency     | 0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72    |
| ERC-8004 Identity    | 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432    |
| ERC-8004 Reputation  | 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63    |
| PAYGRID_TREASURY     | TBD — set before mainnet deploy               |

---

## Reference Docs

- SPEC.md — source of truth
- docs/architecture.md — stack and flows
- docs/contracts.md — contracts spec
- docs/api.md — endpoints
- docs/data-model.md — Supabase schema
- tasks/ — active work items per module
- .agents/skills/celopedia-skill/ — full Celo ecosystem context
