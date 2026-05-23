# Paygrid — Project Spec

Source of truth for the project. All devs and agents must read this file before touching any code.

## Brief

Paygrid is a MiniApp for MiniPay that enables humans and AI agents to create payment links, receive stablecoin payments, and coordinate cross-border transactions on Celo.

- Platform: MiniApp on MiniPay (Opera Mini / standalone)
- Network: Celo Mainnet (chainId: 42220)
- Users: freelancers, developers, AI agents
- Hackathon: Onchain Agents Hackathon — Celo (May 22 – June 15, 2026)

## Problem

Traditional payment rails (Stripe, PayPal, SWIFT) are slow, expensive, and not programmable. AI agents cannot pay or get paid without human intermediaries. There is no native payment layer for the autonomous agent economy.

## Solution

Paygrid provides stablecoin payment links on Celo with instant settlement, accessible from MiniPay and consumable by agents via x402.

## Use Cases

1. Pay-per-Task API Monetization (priority 1)
Developers and companies expose services or APIs protected with x402. An AI agent makes a request, receives a 402 Payment Required, automatically pays in USDC, and gets the response. No account setup, no manual invoicing.

2. AI Agent as Treasurer (priority 2)
An autonomous agent manages payments for a team or protocol: generates invoices, creates payment links, executes payouts, and reports on-chain activity. Operates with its own wallet registered in ERC-8004.

3. Global Freelancer (priority 3)
Anyone generates a payment link from MiniPay and shares it via WhatsApp, email, or social media. The client pays from any compatible wallet. The freelancer receives cUSD/USDC/USDT instantly, without a bank account.

## Business Model

- Transaction fee: 0.5% charged to the recipient on each received payment
- Roadmap (future): volume API tier, multi-stablecoin conversion spread, white-label

## System Modules

Module 1 - Smart Contracts: PaygridRouter + PaygridLink on Celo
Module 2 - Backend API: REST + webhooks + on-chain indexer
Module 3 - Agent: ERC-8004 wallet + Vercel AI SDK logic + x402
Module 4 - MiniApp Frontend: Next.js, MiniPay auto-connect, links and payments UI
Module 5 - Database: Supabase — links, payments, users, agents
Module 6 - Skills / AI Context: Celopedia installed in .agents/skills/
Module 7 - Hackathon Registration: ERC-8004 agentId, Karma, tweet, Self Agent ID

## Supported Tokens

USDm (cUSD) - Address: 0x765DE816845861e75A25fCA122bb6898B8B1282a - Decimals: 18 - feeCurrency: same
USDC - Address: 0xcebA9300f2b948710d2653dD7B07f33A8B32118C - Decimals: 6 - feeCurrency: 0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B (adapter)
USDT - Address: 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e - Decimals: 6 - feeCurrency: 0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72 (adapter)

## Critical Constraints

MiniPay:
- Legacy transactions only — no maxFeePerGas or maxPriorityFeePerGas
- No personal_sign or eth_signTypedData
- UI only shows USDm / USDC / USDT — never CELO
- Identify users by phone number, not 0x address
- Bundle under 2MB, design for 360x640
- Testing requires physical device + ngrok

Hackathon:
- Agent must generate real on-chain transactions
- ERC-8004 agentId required before registration tweet
- Final submission via Celopedia Skill in the last week
- Deadline: June 15, 2026 — 9 AM GMT

## Repo Structure

```
paygrid/
├── SPEC.md
├── AGENTS.md
├── .agents/skills/celopedia-skill/
├── docs/architecture.md
├── docs/contracts.md
├── docs/api.md
├── docs/data-model.md
├── tasks/01-contracts.md
├── tasks/02-backend.md
├── tasks/03-agent.md
├── tasks/04-minipay.md
├── tasks/05-registration.md
├── contracts/
├── minipay/
├── backend/
└── agent/
```

## Key Links

- Celopedia Skills: https://github.com/celo-org/celopedia-skills
- ERC-8004: https://www.8004.org
- x402 Protocol: https://www.x402.org
- MiniPay Docs: https://docs.minipay.xyz
- Celo Docs: https://docs.celo.org
- 8004scan: https://8004scan.com
