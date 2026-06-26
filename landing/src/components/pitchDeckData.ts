export const slides = [
  {
    id: 0,
    title: "PayGrid & Yacamba",
    subtitle: "Interactive pitch deck — Celo PayGrid × Yacamba partnership",
    isIntro: true,
    badges: ["Celo Mainnet", "Remote MCP", "Yacamba by Kilauea"],
  },
  {
    id: 1,
    title:
      "PayGrid & Yacamba join forces to unleash agentic business and commerce workflows",
    subtitle:
      "Celo PayGrid brings programmable payment execution to Yacamba’s ERP, CRM and WhatsApp business workflows.",
    badges: [
      "Celo Mainnet",
      "Remote MCP",
      "ERP/CRM Workflows",
      "Agentic Commerce",
      "Yacamba by Kilauea",
    ],
    scene: "network",
  },
  {
    id: 2,
    title:
      "Agents will not live in isolation. They will live inside business software.",
    body: "Businesses will not adopt agents as abstract standalone tools. Agents will operate inside ERP, CRM, POS, WhatsApp, inventory, invoicing, finance and collections systems.\n\nWhen those agents need to collect, pay, reconcile, verify or escalate a financial operation, they need programmable payment infrastructure.\n\nThat is where Celo PayGrid fits.",
    scene: "workflow",
  },
  {
    id: 3,
    title:
      "Yacamba provides business context. Celo PayGrid provides payment execution.",
    columns: {
      left: [
        "customers",
        "invoices",
        "balances",
        "inventory",
        "orders",
        "CRM",
        "WhatsApp workflows",
        "business rules",
      ],
      right: [
        "payment requests",
        "MCP agent interface",
        "transaction verification",
        "settlement evidence",
        "payment intent layer",
        "agent-readable metadata",
        "Celo Mainnet infrastructure",
      ],
    },
  },
  {
    id: 4,
    title: "An agent that can collect, not just remind.",
    steps: [
      "Yacamba detects overdue invoice",
      "Agent generates Celo PayGrid request",
      "Customer receives WhatsApp/email reminder",
      "Customer pays",
      "Celo PayGrid verifies settlement",
      "Yacamba updates account receivable",
    ],
    example:
      "Customer A owes MXN $2,400. The agent creates a payment request, sends a reminder, verifies payment and marks the invoice as paid.",
    scene: "paymentFlow",
  },
  {
    id: 5,
    title: "Businesses do not want “crypto”. They want clean records.",
    body: "Each Celo PayGrid payment can include: payment request ID, external Yacamba reference, amount, stablecoin, payer, transaction hash, settlement status, fees, net received amount.",
    scene: "reconciliation",
  },
  {
    id: 6,
    title: "An AI sales agent that can actually collect money.",
    body: "Customer asks price on WhatsApp → Yacamba agent checks catalog/inventory → agent generates quote → Celo PayGrid creates payment request → customer pays → Yacamba reserves inventory, creates order and triggers invoice",
    highlight:
      "Celo PayGrid turns conversational commerce into payable commerce.",
    scene: "whatsapp",
  },
  {
    id: 7,
    title: "Make Yacamba businesses payable by agents.",
    body: "External agents could buy products, services, data or business actions from companies using Yacamba, even if those businesses do not manage wallets or agent infrastructure directly. Celo PayGrid becomes the payment interface between external agents and real businesses.",
    scene: "payments",
  },
  {
    id: 8,
    title: "Beyond links: programmable payment intents.",
    items: [
      "collect invoice",
      "collect deposit",
      "pay supplier",
      "renew subscription",
      "confirm order",
      "release escrow",
      "collect on delivery",
      "pay API/x402 endpoint",
    ],
    scene: "intents",
  },
  {
    id: 9,
    title: "From payment requests to autonomous business finance.",
    roadmap: [
      {
        title: "Agent Escrow",
        body: "customer deposits; condition verified in Yacamba; payment released; evidence recorded",
      },
      {
        title: "Spend Policies",
        body: "limits; token allowlists; supplier allowlists; approval thresholds; audit logs",
      },
      { title: "Agent Swaps", body: "quote; swap; settle in required asset" },
      {
        title: "x402 Business APIs",
        body: "paid access to quotes; inventory checks; logistics calculations; business actions",
      },
    ],
    note: "Roadmap / Planned",
  },
  {
    id: 10,
    title: "One integration can activate an entire business network.",
    body: "Instead of onboarding every business one by one, Celo PayGrid can be embedded into Yacamba’s ERP, CRM and WhatsApp workflows. Each participating business becomes a node in the agent economy.",
    scene: "distribution",
    cta: true,
  },
];
