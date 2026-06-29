export const slides = [
  {
    id: 0,
    title: "Celo PayGrid + Yacamba",
    subtitle:
      "Programmable USD stablecoin infrastructure embedded inside ERP/CRM systems and operated by agents.",
    isIntro: true,
    badges: [
      "Celo Mainnet",
      "Remote MCP",
      "Business Agent Accounts",
      "Yacamba ERP/CRM",
      "Mento-routed settlement",
    ],
    stats: [
      {
        value: "Intent -> Payment",
        label: "agentic business workflows",
      },
      {
        value: "MCP",
        label: "agent execution layer",
      },
      {
        value: "Business Agent Accounts",
        label: "USDC, USDT, USDm",
      },
    ],
  },
  {
    id: 1,
    title: "The wedge is invisible business finance.",
    subtitle:
      "Companies should use digital dollars through the software they already run, not through a crypto experience.",
    badges: ["ERP/CRM workflows", "Agent infrastructure", "Celo settlement"],
    stats: [
      {
        value: "ERP",
        label: "business context",
      },
      {
        value: "MCP",
        label: "agent execution",
      },
      {
        value: "Celo",
        label: "programmable USD rails",
      },
    ],
    body: "Yacamba is building an agent-managed CRM, ERP and business control center for SMEs in Mexico and LatAm. PayGrid adds the financial infrastructure layer: agent-managed balances, payment execution, swaps, policies and reconciliation.",
    scene: "distribution",
  },
  {
    id: 2,
    title: "Mexico is mobile-first, but business payments are still hard to reconcile.",
    subtitle:
      "The adoption hook is not crypto. It is faster payment operations for SMEs: collect, match and update records automatically.",
    body: "Agentic payment adoption will come from business automation systems that do not feel like crypto: agents collecting, verifying and updating records inside the workflows companies already use.",
    columns: {
      left: [
        "Millions of Mexican SMEs",
        "WhatsApp as daily commerce channel",
        "Cross-border payment friction",
      ],
      right: [
        "Manual reconciliation is common",
        "Agents need trusted payment evidence",
        "Celo stablecoins create fast USD rails",
      ],
    },
    stats: [
      {
        value: "SMEs",
        label: "core market",
      },
      {
        value: "USD",
        label: "international payments",
      },
      {
        value: "ERP records",
        label: "automatic payment updates",
      },
    ],
  },
  {
    id: 3,
    title: "Yacamba Agent Collections.",
    subtitle: "The first adoption path: an agent that can collect, verify and reconcile.",
    steps: [
      "Detect overdue invoice or pending deposit",
      "Create a PayGrid payment workflow",
      "Customer pays with the best available rail",
      "PayGrid verifies Celo settlement",
      "Yacamba updates receivables automatically",
    ],
    example:
      "The invoice closes with a transaction hash, net amount and status instead of a screenshot or manual bank match.",
    stats: [
      {
        value: "5",
        label: "steps automated",
      },
      {
        value: "1",
        label: "agent-readable receipt",
      },
      {
        value: "0",
        label: "screenshots required",
      },
    ],
    scene: "paymentFlow",
  },
  {
    id: 4,
    title: "Reconciliation is the business value.",
    subtitle: "Payments become useful when they match records.",
    body: "PayGrid maps Celo transactions to customer, invoice, order, fee, net amount and settlement status. Yacamba is the first ERP/CRM integration, while the MCP and API remain open for other ERPs, CRMs and agents to plug into the same reconciliation layer.",
    stats: [
      {
        value: "Invoice",
        label: "business reference",
      },
      {
        value: "TX",
        label: "onchain proof",
      },
      {
        value: "Net",
        label: "accounting amount",
      },
    ],
    scene: "reconciliation",
  },
  {
    id: 5,
    title: "Business Agent Accounts.",
    subtitle:
      "Stablecoin business accounts embedded inside ERP/CRM systems and operated by agents.",
    body: "Businesses can receive international payments and manage USD stablecoin balances through their existing business software. PayGrid handles wallets, settlement, swaps, policies and reconciliation behind the scenes, so companies use Celo without needing to feel like crypto users.",
    stats: [
      {
        value: "Digital dollars",
        label: "USDC, USDT, USDm",
      },
      {
        value: "Cross-border",
        label: "faster business settlement",
      },
      {
        value: "Invisible crypto",
        label: "agents operate the rails",
      },
    ],
    items: [
      "receive USD stablecoin payments",
      "hold business balances",
      "route Mento auto-swaps",
      "enforce spending policies",
      "request human approvals",
      "sync ERP/CRM records",
    ],
    highlight:
      "This becomes a reusable financial operating layer for agents, with Yacamba as the first ERP/CRM adoption path rather than the only integration.",
    scene: "intents",
  },
  {
    id: 6,
    title: "One command to connect agents to Celo commerce.",
    subtitle:
      "The MCP layer turns PayGrid into infrastructure other builders and agents can install.",
    body: "A future CLI can configure the existing remote Celo PayGrid MCP server inside compatible agent clients, so developers can connect payment execution, Business Agent Accounts, swaps and settlement verification without manual setup.",
    stats: [
      {
        value: "npx init",
        label: "agent onboarding CLI",
      },
      {
        value: "3 clients",
        label: "Claude Code, Codex, VS Code",
      },
      {
        value: "Remote MCP",
        label: "shared Celo PayGrid endpoint",
      },
    ],
    items: [
      "npx @celo-paygrid/mcp init",
      "--client claude",
      "--client codex",
      "--client vscode",
      "--client all",
      "connection health check",
    ],
    example: "Future CLI: npx @celo-paygrid/mcp@latest init --client all",
    highlight:
      "Mainnet proof already exists for the execution layer: Mento-routed USDT to USDC settlement through PayGridRouterV2.",
    scene: "intents",
  },
  {
    id: 7,
    title: "Swaps make USD balances usable by agents.",
    subtitle:
      "Businesses can settle in one token while payers and agents use another.",
    stats: [
      {
        value: "Mento",
        label: "primary stablecoin route",
      },
      {
        value: "Uniswap",
        label: "fallback / expansion route",
      },
      {
        value: "Policy",
        label: "limits and allowlists",
      },
    ],
    items: [
      "quote payment swap",
      "prepare payWithSwap",
      "verify settlement",
      "quote standalone swap",
      "prepare agent swap",
      "enforce slippage",
    ],
    scene: "intents",
  },
  {
    id: 8,
    title: "On/offramp orchestration expands reach.",
    subtitle: "Customers and businesses should not need to understand stablecoins.",
    body: "An agent can present the best available rail: stablecoin, card-funded checkout, bank/cash provider, future MiniPay card rails or future MXN cash-out paths. The business receives a reconciled record, not a crypto support burden.",
    stats: [
      {
        value: "Card",
        label: "customer funding",
      },
      {
        value: "Celo",
        label: "settlement layer",
      },
      {
        value: "MXN",
        label: "future cash-out path",
      },
    ],
    scene: "onramp",
  },
  {
    id: 9,
    title: "ERP/CRM systems become reachable by agents.",
    subtitle:
      "External agents can pay invoices, fund accounts, book services or trigger business actions.",
    body: "PayGrid becomes the payment execution and verification interface between autonomous agents and real-world companies using Yacamba or any future ERP/CRM integration.",
    stats: [
      {
        value: "A2B",
        label: "agent-to-business payments",
      },
      {
        value: "B2A",
        label: "business workflows",
      },
      {
        value: "x402",
        label: "paid agent services",
      },
    ],
    scene: "payments",
  },
  {
    id: 10,
    title: "Frontier roadmap: Business Agent Accounts.",
    subtitle:
      "Milestones focused on infrastructure other builders, ERPs, CRMs and agents can actually depend on.",
    stats: [
      {
        value: "Accounts",
        label: "agent-managed balances",
      },
      {
        value: "ERC-8004",
        label: "identity + discovery",
      },
      {
        value: "Celo",
        label: "verifiable settlement",
      },
    ],
    roadmap: [
      {
        title: "1. Business Agent Accounts",
        body: "USD stablecoin balances embedded in ERP/CRM systems and operated by agents.",
      },
      {
        title: "2. ERP/CRM adapters",
        body: "Open reconciliation hooks for Yacamba first, then other business systems.",
      },
      {
        title: "3. Agent collections",
        body: "Create, collect, verify and close invoices through agent-readable workflows.",
      },
      {
        title: "4. Swap-aware spend",
        body: "Mento-first routes, Uniswap fallback and standalone swap tools for agents.",
      },
      {
        title: "5. Spending policies",
        body: "Limits, approvals, token allowlists and human confirmation thresholds.",
      },
      {
        title: "6. Agent onboarding CLI",
        body: "npx init for Claude Code, Codex, VS Code and future MCP clients.",
      },
      {
        title: "7. Paid agent services",
        body: "Agents can charge, unlock and consume services through x402-gated workflows.",
      },
      {
        title: "8. Reputation ledger",
        body: "Turn successful settlements into portable trust signals for agents and businesses.",
      },
    ],
    note: "Frontier focus: identity, agent-to-agent transactions, AI-native tooling, verification and interoperability.",
  },
  {
    id: 11,
    title: "Activation path: 10 workflows -> 100 businesses.",
    subtitle: "Yacamba gives PayGrid a real distribution channel into SME operations.",
    roadmap: [
      {
        title: "1. Collections pilot",
        body: "Overdue invoices, deposits and renewals.",
      },
      {
        title: "2. Business balances",
        body: "Receive, hold and reconcile USDC, USDT and USDm.",
      },
      {
        title: "3. Swap abstraction",
        body: "Mento-first routing, Uniswap fallback and MXN local-stablecoin readiness if/when a Celo MXN asset becomes available.",
      },
      {
        title: "4. Builder distribution",
        body: "MCP docs, agent card, CLI onboarding and Yacamba integration examples.",
      },
    ],
    stats: [
      {
        value: "10",
        label: "pilot workflows",
      },
      {
        value: "100",
        label: "business target",
      },
      {
        value: "1,000+",
        label: "repeat actions target",
      },
    ],
    note: "Frontier roadmap / milestone-based execution",
  },
  {
    id: 12,
    title: "One ERP integration can activate a business network.",
    subtitle:
      "Yacamba turns PayGrid from infrastructure demo into adoption engine.",
    body: "Each participating business can receive digital dollars, become reachable by agents, settle through Celo rails and keep auditable records inside its existing business software.",
    stats: [
      {
        value: "1",
        label: "Yacamba integration",
      },
      {
        value: "N",
        label: "business accounts",
      },
      {
        value: "∞",
        label: "agent payment intents",
      },
    ],
    scene: "distribution",
  },
];
