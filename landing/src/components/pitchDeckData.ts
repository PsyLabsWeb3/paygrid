export const slides = [
  {
    id: 0,
    title: "Celo PayGrid + Yacamba",
    subtitle:
      "Agent collections, reconciliation and swap-enabled settlement for real businesses in Mexico and LatAm.",
    isIntro: true,
    badges: [
      "Celo Mainnet",
      "Remote MCP",
      "Yacamba ERP/CRM",
      "Agent Collections",
      "Mento + Uniswap routes",
    ],
    stats: [
      {
        value: "MCP",
        label: "agent execution layer",
      },
      {
        value: "Intent → Payment",
        label: "agentic business workflows",
      },
      {
        value: "Any stablecoin",
        label: "Mento-routed auto-swaps",
      },
    ],
  },
  {
    id: 1,
    title: "The wedge is business operations.",
    subtitle:
      "Agent payments become useful when they collect invoices and reconcile records inside ERP/CRM workflows.",
    badges: ["Business workflows", "Agent infrastructure", "Swap routing"],
    stats: [
      {
        value: "ERP",
        label: "business workflows",
      },
      {
        value: "MCP",
        label: "agent infrastructure",
      },
      {
        value: "Mento",
        label: "auto-swap route",
      },
    ],
    body: "Yacamba is building an agent-managed CRM, ERP and business control center for SMEs in Mexico and LatAm. Together, Yacamba and PayGrid enable the next generation of agentic business workflows.",
    scene: "distribution",
  },
  {
    id: 2,
    title: "Mexico is mobile-first, but business payments are still hard to reconcile.",
    subtitle:
      "The opportunity is cleaner payment operations for SMEs: collect faster, match payments correctly and update business records automatically.",
    body: "Agentic payment adoption will come from business automation systems that do not feel like crypto: agents collecting, verifying and updating records inside the workflows companies already use.",
    columns: {
      left: [
        "Millions of Mexican SMEs",
        "WhatsApp as daily commerce channel",
        "Fragmented payment habits",
      ],
      right: [
        "Manual reconciliation is common",
        "Agents need trusted payment evidence",
        "Celo stablecoins create fast settlement rails",
      ],
    },
    stats: [
      {
        value: "SMEs",
        label: "core market",
      },
      {
        value: "WhatsApp",
        label: "daily workflow",
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
    subtitle: "An agent that can collect, not just remind.",
    steps: [
      "Detect overdue invoice or pending deposit",
      "Create PayGrid payment intent",
      "Customer pays with available rail",
      "Verify Celo settlement",
      "Update Yacamba receivables",
    ],
    example:
      "The invoice closes with a transaction hash, net amount and status instead of a screenshot.",
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
      "ERP, CRM and agent platforms need programmable balances their agents can operate safely.",
    body: "PayGrid can expose agent-managed stablecoin accounts as infrastructure for business software and autonomous agents: receive payments, hold balances, route swaps, enforce spending policies and reconcile activity back into the system of record.",
    stats: [
      {
        value: "Balances",
        label: "USDC, USDT, USDm",
      },
      {
        value: "Policies",
        label: "limits and approvals",
      },
      {
        value: "ERP-linked",
        label: "agent-managed treasury",
      },
    ],
    items: [
      "receive stablecoin payments",
      "track business balances",
      "route Mento auto-swaps",
      "set spend limits",
      "request human approval",
      "sync ERP records",
    ],
    highlight:
      "This becomes a reusable financial operating layer for agents, with Yacamba as the first ERP/CRM adoption path rather than the only integration.",
    scene: "intents",
  },
  {
    id: 6,
    title: "One command to connect agents to Celo commerce.",
    subtitle:
      "PayGrid can become the MCP onboarding layer for agents beyond Yacamba.",
    body: "The next builder-facing milestone is a CLI that configures the existing remote Celo PayGrid MCP server inside compatible agent clients, so developers can connect payment execution, swaps and settlement verification without manual setup.",
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
    title: "Swaps become agent spend infrastructure.",
    subtitle:
      "Starting with payments. Expanding into standalone agent swap tools.",
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
        label: "future guardrails",
      },
    ],
    items: [
      "quote payment swap",
      "prepare payWithSwap",
      "verify settlement",
      "quote standalone swap",
      "prepare standalone swap",
      "enforce slippage",
    ],
    scene: "intents",
  },
  {
    id: 8,
    title: "On/offramp orchestration expands reach.",
    subtitle: "Customers should not need to understand stablecoins.",
    body: "The agent can present the best available rail: stablecoin, card-funded checkout, bank/cash provider or future MiniPay card rails. Yacamba receives a reconciled record.",
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
    title: "Make Yacamba companies payable by agents.",
    subtitle:
      "External agents can pay invoices, book services or trigger business actions.",
    body: "PayGrid becomes the payment and verification interface between autonomous agents and real-world companies that use Yacamba.",
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
        label: "paid APIs",
      },
    ],
    scene: "payments",
  },
  {
    id: 10,
    title: "Frontier roadmap: agent commerce infrastructure.",
    subtitle:
      "Milestones focused on tools other builders, ERPs, CRMs and agents can actually depend on.",
    stats: [
      {
        value: "MCP",
        label: "agent integration surface",
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
        title: "1. Agent onboarding CLI",
        body: "npx init for Claude Code, Codex, VS Code and future MCP clients.",
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
        title: "4. Business Agent Accounts",
        body: "Stablecoin balances, policy-controlled spend and ERP-linked reconciliation.",
      },
      {
        title: "5. Swap-aware spend",
        body: "Mento-first routes, Uniswap fallback and standalone swap tools for agents.",
      },
      {
        title: "6. Spending policies",
        body: "Limits, approvals, token allowlists and human confirmation thresholds.",
      },
      {
        title: "7. Paid agent services",
        body: "Agents can charge, unlock and consume services through x402-gated workflows.",
      },
      {
        title: "8. Agent reputation ledger",
        body: "Turn successful settlements into portable trust signals for agents and businesses.",
      },
    ],
    note: "Frontier focus: identity, agent-to-agent transactions, AI-native tooling, verification and interoperability.",
  },
  {
    id: 11,
    title: "Activation path: 10 workflows → 100 businesses.",
    subtitle: "Yacamba gives PayGrid a real distribution channel.",
    roadmap: [
      {
        title: "1. Collections pilot",
        body: "Overdue invoices, deposits and renewals.",
      },
      {
        title: "2. Reconciliation loop",
        body: "Invoice, tx hash, fee, net amount and status.",
      },
      {
        title: "3. Swap abstraction",
        body: "Mento-first routing, Uniswap fallback, standalone swap tools and MXN local-stablecoin readiness if/when a Celo MXN asset becomes available.",
      },
      {
        title: "4. Builder distribution",
        body: "MCP docs, agent card and Yacamba integration examples.",
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
    body: "Each participating business becomes reachable by agents, payable through Celo rails and auditable through settlement evidence.",
    stats: [
      {
        value: "1",
        label: "Yacamba integration",
      },
      {
        value: "N",
        label: "business workflows",
      },
      {
        value: "∞",
        label: "agent payment intents",
      },
    ],
    scene: "distribution",
  },
];
