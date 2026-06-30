import {
  Activity,
  BadgeCheck,
  Bot,
  Braces,
  CircleDollarSign,
  ClipboardCheck,
  Compass,
  CreditCard,
  FileCode2,
  FileSearch,
  Link2,
  Network,
  ShieldCheck,
  Sparkles,
  Terminal,
  Workflow,
} from "lucide-react";

export const site = {
  name: "Celo PayGrid",
  title: "Celo PayGrid for AI Agents | MCP Payments on Celo",
  description:
    "Connect AI agents, ERP/CRM systems and builders to programmable USD stablecoin infrastructure on Celo through Celo PayGrid MCP.",
  url: "https://web.celopaygrid.xyz",
  canonical: "https://www.celopaygrid.xyz",
  mcpEndpoint: "https://mcp.celopaygrid.xyz/mcp",
  metadataEndpoint:
    "https://mcp.celopaygrid.xyz/.well-known/paygrid-agent.json",
  docsUrl: "/docs/overview.html",
  chainId: "42220",
};

export const navItems = [
  { label: "Capabilities", href: "#capabilities" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Use cases", href: "#use-cases" },
  { label: "Developers", href: "#developers" },
  { label: "Docs", href: "#docs" },
  { label: "Roadmap", href: "#roadmap" },
  { label: "FAQ", href: "#faq" },
];

export const badges = [
  "Live on Celo Mainnet",
  "Remote MCP",
  "Business Agent Accounts",
  "Mento swaps",
];

export const capabilities = [
  {
    title: "Create business payment workflows",
    body: "Create agent-readable payment workflows for invoices, services, business balances and collections.",
    tool: "create_payment_request",
    icon: Link2,
  },
  {
    title: "Verify transactions",
    body: "Check payment status and return verifiable settlement information.",
    tool: "verify_payment",
    icon: ClipboardCheck,
  },
  {
    title: "Automatic stablecoin swaps",
    body: "Let payers use USDC, USDT or USDm while recipients receive the token requested by the link.",
    tool: "quote_payment_request",
    icon: CircleDollarSign,
  },
  {
    title: "Pay with any supported stablecoin",
    body: "Agents can prepare approval and payment transactions for exact-token or swap-enabled settlement.",
    tool: "pay_payment_request",
    icon: CreditCard,
  },
  {
    title: "Business Agent Accounts",
    body: "Roadmap primitive for ERP/CRM systems: USD stablecoin balances, policies and reconciliation operated by agents.",
    tool: "agent-managed balances",
    icon: Activity,
  },
  {
    title: "Discover agent capabilities",
    body: "Allow agents to inspect Celo PayGrid before choosing an action.",
    tool: "get_agent_capabilities",
    icon: Compass,
  },
  {
    title: "Agent commerce infrastructure",
    body: "Coordinate payment actions between AI agents, users and service providers.",
    tool: "MCP orchestration",
    icon: Network,
  },
];

export const useCases = [
  {
    title: "Business Agent Accounts",
    body: "ERP/CRM systems can embed USD stablecoin infrastructure that agents operate behind the scenes.",
    icon: Bot,
  },
  {
    title: "AI-assisted collections",
    body: "An agent collects invoices, verifies settlement and updates business records automatically.",
    icon: FileSearch,
  },
  {
    title: "Autonomous procurement",
    body: "An agent identifies a digital service or resource and prepares the corresponding payment workflow.",
    icon: Workflow,
  },
  {
    title: "Agent marketplaces",
    body: "Platforms can coordinate payment requests between users, agents and service providers.",
    icon: Sparkles,
  },
  {
    title: "Cross-border business payments",
    body: "Companies can receive USDC, USDT or USDm through business software without feeling like crypto users.",
    icon: CircleDollarSign,
  },
];

export const mainnetStatus = [
  ["Celo PayGrid MCP", "Operational"],
  ["Celo Mainnet", "Operational"],
  ["Stablecoin swaps", "Operational"],
  ["Chain ID", "42220"],
  ["Agent metadata", "Available"],
  ["Remote MCP", "Available"],
];

export const roadmap = [
  {
    title: "Business Agent Accounts",
    body: "Programmable USD stablecoin balances embedded inside ERP/CRM systems and operated by agents.",
    status: "Roadmap",
  },
  {
    title: "Yacamba ERP/CRM adapter",
    body: "First adoption path for agent collections, business balances and automatic reconciliation in Mexico and LatAm.",
    status: "Roadmap",
  },
  {
    title: "Spending policies",
    body: "Limits, approvals, token allowlists and human confirmation thresholds for agent-managed business funds.",
    status: "Planned",
  },
  {
    title: "Open ERP/CRM adapters",
    body: "MCP and API primitives that let other business systems plug into PayGrid reconciliation and settlement flows.",
    status: "Roadmap",
  },
];

export const securityItems = [
  "explicit payment intent",
  "verifiable transaction status",
  "external references",
  "Celo Mainnet settlement",
  "Mento-routed stablecoin swaps",
  "readable agent responses",
  "auditable payment activity",
  "traceable transaction results",
];

export const faqs = [
  {
    q: "What is Celo PayGrid?",
    a: "Celo PayGrid is programmable USD stablecoin infrastructure for AI agents, ERP/CRM systems and business software on Celo Mainnet.",
  },
  {
    q: "What can an AI agent do with Celo PayGrid?",
    a: "An AI agent can discover Celo PayGrid capabilities, create payment workflows, quote supported stablecoin swaps, inspect activity, verify settlement and interact with roadmap Business Agent Account primitives.",
  },
  { q: "What is the Celo PayGrid MCP endpoint?", a: site.mcpEndpoint },
  {
    q: "How does an agent discover Celo PayGrid tools?",
    a: "The agent can call get_agent_capabilities.",
  },
  {
    q: "Is Celo PayGrid live on Mainnet?",
    a: "Yes. Celo PayGrid is deployed on Celo Mainnet.",
  },
  {
    q: "What network does Celo PayGrid use?",
    a: "Celo PayGrid currently uses Celo Mainnet, chain ID 42220.",
  },
  {
    q: "Can Celo PayGrid be used for agent-to-human payments?",
    a: "Yes. An agent can generate payment requests for freelancers, creators, consultants, merchants or service providers.",
  },
  {
    q: "What are Business Agent Accounts?",
    a: "Business Agent Accounts are roadmap infrastructure for ERP/CRM systems: programmable USD stablecoin balances that agents can operate with policies, swaps and reconciliation. Yacamba is the first planned adoption path.",
  },
  {
    q: "Does Celo PayGrid support ERP integration?",
    a: "ERP and CRM integrations, including Yacamba, are part of the roadmap and should not be presented as currently live.",
  },
  {
    q: "Does Celo PayGrid support swaps?",
    a: "Yes. Payment links can settle in USDC, USDT or USDm while payers use any supported stablecoin. Mento is the primary route, with Uniswap configurable as fallback.",
  },
];

export const developerLinks = [
  { label: "Copy endpoint", icon: Terminal },
  { label: "View metadata", icon: BadgeCheck, href: site.metadataEndpoint },
  { label: "Read docs", icon: Braces, href: site.docsUrl },
  { label: "Test capabilities", icon: ShieldCheck },
];

export const docs = [
  {
    title: "Overview",
    body: "Current production capabilities, endpoints, network details and integration surface.",
    href: "/docs/overview.html",
    icon: FileSearch,
  },
  {
    title: "Technical architecture",
    body: "How MCP, backend, contracts, indexer and Supabase work together on Celo Mainnet.",
    href: "/docs/technical-architecture.html",
    icon: Network,
  },
  {
    title: "MCP reference",
    body: "Tool list, auth model, request examples and expected outputs for agent builders.",
    href: "/docs/mcp-reference.html",
    icon: FileCode2,
  },
  {
    title: "Security model",
    body: "Trust boundaries, current controls, operational limitations and planned hardening.",
    href: "/docs/security-model.html",
    icon: ShieldCheck,
  },
];

export const quickStartConfig = `{
  "mcpServers": {
    "celo-paygrid": {
      "url": "https://mcp.celopaygrid.xyz/mcp"
    }
  }
}`;

export const demoCopy = `User: Create a $25 payment request for logo design.
Agent: I'll inspect Celo PayGrid's available payment capabilities.
Tool call: get_agent_capabilities
Tool result: Payment request creation, swap quotes and transaction verification are available.
Agent: I'll create the payment request.
Tool call: create_payment_request
Result: Payment request created. Amount: $25. Status: Pending. Network: Celo Mainnet.
User: The payer has USDT but the request asks for USDC.
Tool call: quote_payment_request
Result: Quote ready. Route: Mento. Payer token: USDT. Settlement token: USDC.
User: Check if the payment was completed.
Tool call: verify_payment
Result: Payment confirmed. Transaction: 0x8f3... Network: Celo Mainnet.`;

export const stackLayers = [
  {
    title: "MCP",
    body: "Agent execution and integration layer",
    icon: Terminal,
  },
  {
    title: "Business Agent Accounts",
    body: "USD balances, policies, swaps and reconciliation",
    icon: CreditCard,
  },
  {
    title: "Celo Mainnet",
    body: "Verifiable settlement layer",
    icon: ShieldCheck,
  },
];
