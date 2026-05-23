# Tasks: Agent (Vercel AI SDK + ERC-8004 + x402)

- [ ] Generate agent wallet (viem generatePrivateKey)
- [ ] Store AGENT_PRIVATE_KEY in .env (never committed)
- [ ] Register agent on ERC-8004 Identity Registry (0x8004A169...)
- [ ] Publish agent metadata with endpoints and capabilities
- [ ] Fund agent wallet with USDC/USDm on Celo Mainnet
- [ ] Setup Vercel AI SDK agent with tools
- [ ] Tool: createPaymentLink(amount, token, description, recipient) → link URL
- [ ] Tool: checkPaymentStatus(linkId) → payment status
- [ ] Tool: getBalance() → USDC/USDm balance
- [ ] Tool: getPaymentHistory() → list of past payments
- [ ] Agent-to-Agent: implement x402 payer (thirdweb/x402 auto-pay)
- [ ] Agent-to-Human: create and send payment links to humans
- [ ] Human-to-Agent: expose x402 endpoint for receiving payments
- [ ] Treasury report tool — generate payment summaries
- [ ] Verify agentId on 8004scan.com
- [ ] Test agent paying an x402 endpoint
- [ ] Test agent creating a payment link and receiving payment
