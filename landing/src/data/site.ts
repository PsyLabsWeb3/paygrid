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
    "Connect AI agents to Celo PayGrid through MCP to create payment links, verify transactions and coordinate stablecoin payment workflows on Celo Mainnet.",
  url: "https://celopaygrid.xyz/agents",
  canonical: "https://celopaygrid.xyz/agents",
  mcpEndpoint: "https://mcp.celopaygrid.xyz/mcp",
  metadataEndpoint: "https://mcp.celopaygrid.xyz/.well-known/paygrid-agent.json",
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

export const badges = ["Live on Celo Mainnet", "Remote MCP", "Agent-ready", "Verifiable settlement"];

export const capabilities = [
  {
    title: "Create payment requests",
    body: "Generate payment links for services, invoices, creators, merchants or human work.",
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
    title: "Review payment activity",
    body: "Inspect payment requests associated with an agent or workflow.",
    tool: "list_agent_requests",
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
    title: "Agent-to-human payments",
    body: "An agent generates a payment request for a freelancer, creator, consultant, merchant or service provider.",
    icon: Bot,
  },
  {
    title: "AI-assisted collections",
    body: "An agent helps a business generate and track payment requests.",
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
    title: "Service payments",
    body: "Agents can generate payment links for digital work, subscriptions or professional services.",
    icon: CircleDollarSign,
  },
];

export const mainnetStatus = [
  ["Celo PayGrid MCP", "Operational"],
  ["Celo Mainnet", "Operational"],
  ["Chain ID", "42220"],
  ["Agent metadata", "Available"],
  ["Remote MCP", "Available"],
];

export const roadmap = [
  {
    title: "Yacamba ERP/CRM integration",
    body: "Agent-assisted collections, payment request generation and reconciliation workflows inside Yacamba.",
    status: "Roadmap",
  },
  {
    title: "Agent swaps",
    body: "Allow agents to request quotes and swap supported assets before completing payment workflows.",
    status: "Planned",
  },
  {
    title: "Spending policies",
    body: "Limits, approvals, token allowlists and human confirmation thresholds.",
    status: "Planned",
  },
  {
    title: "Enterprise reconciliation",
    body: "Deeper links between payment requests, invoices and business records.",
    status: "Roadmap",
  },
];

export const securityItems = [
  "explicit payment intent",
  "verifiable transaction status",
  "external references",
  "Celo Mainnet settlement",
  "readable agent responses",
  "auditable payment activity",
  "traceable transaction results",
];

export const faqs = [
  {
    q: "What is Celo PayGrid?",
    a: "Celo PayGrid is an MCP-based payment execution and verification layer for AI agents on Celo Mainnet.",
  },
  {
    q: "What can an AI agent do with Celo PayGrid?",
    a: "An AI agent can discover Celo PayGrid capabilities, create payment requests, inspect payment activity and verify completed transactions.",
  },
  { q: "What is the Celo PayGrid MCP endpoint?", a: site.mcpEndpoint },
  { q: "How does an agent discover Celo PayGrid tools?", a: "The agent can call get_agent_capabilities." },
  { q: "Is Celo PayGrid live on Mainnet?", a: "Yes. Celo PayGrid is deployed on Celo Mainnet." },
  { q: "What network does Celo PayGrid use?", a: "Celo PayGrid currently uses Celo Mainnet, chain ID 42220." },
  {
    q: "Can Celo PayGrid be used for agent-to-human payments?",
    a: "Yes. An agent can generate payment requests for freelancers, creators, consultants, merchants or service providers.",
  },
  {
    q: "Does Celo PayGrid support ERP integration?",
    a: "ERP and CRM integrations, including Yacamba, are part of the roadmap and should not be presented as currently live.",
  },
  {
    q: "Does Celo PayGrid support swaps?",
    a: "Agent swaps are planned as part of the roadmap and are not part of the current production capabilities.",
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
Tool result: Payment request creation and transaction verification are available.
Agent: I'll create the payment request.
Tool call: create_payment_request
Result: Payment request created. Amount: $25. Status: Pending. Network: Celo Mainnet.
User: Check if the payment was completed.
Tool call: verify_payment
Result: Payment confirmed. Transaction: 0x8f3... Network: Celo Mainnet.`;

export const stackLayers = [
  { title: "MCP", body: "Agent interaction layer", icon: Terminal },
  { title: "Celo PayGrid", body: "Payment orchestration and verification layer", icon: CreditCard },
  { title: "Celo Mainnet", body: "Settlement layer", icon: ShieldCheck },
];
