import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Menu,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import { CopyButton } from "./components/CopyButton";
import RippleGrid from "./components/RippleGrid";
import PitchDeckSection from "./components/PitchDeckSection";
import { Seo } from "./components/Seo";
import {
  badges,
  capabilities,
  demoCopy,
  developerLinks,
  docs,
  faqs,
  mainnetStatus,
  navItems,
  quickStartConfig,
  roadmap,
  securityItems,
  site,
  stackLayers,
  useCases,
} from "./data/site";

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0 },
};

const demoSteps = [
  { role: "User", text: "Create a $25 payment request for logo design." },
  {
    role: "Agent",
    text: "I'll inspect Celo PayGrid's available payment capabilities.",
  },
  { role: "Tool call", text: "get_agent_capabilities", code: true },
  {
    role: "Tool result",
    text: "Payment request creation, swap quotes and transaction verification are available.",
  },
  { role: "Agent", text: "I'll create the payment request." },
  {
    role: "Tool call",
    text: 'create_payment_request\n{\n  "amount": "25",\n  "currency": "USD",\n  "description": "Logo design"\n}',
    code: true,
  },
  {
    role: "Result",
    text: "Payment request created\nAmount: $25\nStatus: Pending\nNetwork: Celo Mainnet\nPayment URL: https://pay.celopaygrid.xyz/...",
  },
  { role: "User", text: "The payer has USDT, but the request asks for USDC." },
  { role: "Agent", text: "I'll quote a supported stablecoin swap." },
  { role: "Tool call", text: "quote_payment_request", code: true },
  {
    role: "Result",
    text: "Quote ready\nRoute: Mento\nPayer token: USDT\nRecipient receives: USDC",
  },
  { role: "User", text: "Check if the payment was completed." },
  { role: "Agent", text: "I'll verify the current transaction status." },
  { role: "Tool call", text: "verify_payment", code: true },
  {
    role: "Result",
    text: "Payment confirmed\nTransaction: 0x8f3...\nNetwork: Celo Mainnet",
  },
];

function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`site-nav ${scrolled ? "site-nav-scrolled" : ""}`}>
      <a className="brand" href="#top" aria-label="Celo PayGrid home">
        <img
          className="brand-mark"
          src="/PaygridIcon.png"
          alt="Celo PayGrid logo"
        />
        <span>Celo PayGrid</span>
      </a>
      <nav className="desktop-nav" aria-label="Main navigation">
        {navItems.map((item) => (
          <a key={item.href} href={item.href}>
            {item.label}
          </a>
        ))}
      </nav>
      <a className="nav-cta" href="#developers">
        Connect MCP
      </a>
      <button
        className="mobile-menu-button"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Toggle menu"
      >
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>
      {open ? (
        <div className="mobile-menu">
          {navItems.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setOpen(false)}>
              {item.label}
            </a>
          ))}
          <a href="#developers" onClick={() => setOpen(false)}>
            Connect MCP
          </a>
        </div>
      ) : null}
    </header>
  );
}

function HeroSceneFallback() {
  return (
    <div className="hero-fallback" aria-hidden="true">
      <div className="fallback-core" />
      <span />
      <span />
      <span />
    </div>
  );
}

function Hero() {
  const reducedMotion = useReducedMotion();

  return (
    <section className="hero section-shell" id="top">
      <div className="hero-copy-wrap">
        <motion.p
          className="eyebrow"
          initial="hidden"
          animate="show"
          variants={fadeUp}
        >
          The financial execution layer for AI agents.
        </motion.p>
        <motion.h1
          initial="hidden"
          animate="show"
          variants={fadeUp}
          transition={{ delay: 0.05 }}
        >
          Your agent can think.
          <span>Now let it transact.</span>
        </motion.h1>
        <motion.p
          className="hero-subhead"
          initial="hidden"
          animate="show"
          variants={fadeUp}
          transition={{ delay: 0.1 }}
        >
          Connect AI agents to real-world payment workflows through one MCP
          endpoint on Celo Network.
        </motion.p>
        {/* <motion.p
          className="geo-definition"
          initial="hidden"
          animate="show"
          variants={fadeUp}
          transition={{ delay: 0.15 }}
        >
          From paying freelancers and service providers to collecting customer
          payments and powering agent-driven commerce, Celo PayGrid transforms
          an agent&apos;s intent into a traceable financial workflow.
        </motion.p> */}
        <motion.div
          className="hero-actions"
          initial="hidden"
          animate="show"
          variants={fadeUp}
          transition={{ delay: 0.2 }}
        >
          <a className="primary-action" href="#developers">
            Connect Celo PayGrid MCP <ArrowRight size={18} />
          </a>
          <a className="secondary-action" href="#capabilities">
            Explore capabilities
          </a>
        </motion.div>
        <motion.div
          className="terminal-pill"
          initial="hidden"
          animate="show"
          variants={fadeUp}
          transition={{ delay: 0.25 }}
        >
          <span>$</span>
          <code>{site.mcpEndpoint}</code>
          <CopyButton value={site.mcpEndpoint} label="Copy" />
        </motion.div>
        <div className="badge-row" aria-label="Celo PayGrid status badges">
          {badges.map((badge) => (
            <span className="status-badge" key={badge}>
              <CheckCircle2 size={14} /> {badge}
            </span>
          ))}
        </div>
      </div>
      <div
        className="hero-visual"
        aria-label="AI agents connecting to Celo PayGrid MCP and Celo Mainnet settlement"
      >
        {reducedMotion ? (
          <HeroSceneFallback />
        ) : (
          <RippleGrid
            enableRainbow={false}
            gridColor="#b7ff1a"
            rippleIntensity={0.05}
            gridSize={10}
            gridThickness={15}
            mouseInteraction={true}
            mouseInteractionRadius={1.2}
            opacity={0.8}
          />
        )}
        <img
          className="hero-logo"
          src="/PaygridIconLime.png"
          alt="Celo PayGrid logo"
        />
        <div className="scene-layer-labels" aria-hidden="true">
          <span>AI Agents</span>
          <span>Celo PayGrid MCP</span>
          <span>Celo Mainnet Settlement</span>
        </div>
      </div>
    </section>
  );
}

function InteractiveDemo() {
  const [step, setStep] = useState(5);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(
      () => setStep((value) => (value + 1) % demoSteps.length),
      1450
    );
    return () => window.clearInterval(id);
  }, [paused]);

  const visibleSteps = useMemo(() => demoSteps.slice(0, step + 1), [step]);

  return (
    <section className="section-shell" id="demo">
      <div className="section-heading">
        <p className="eyebrow">Interactive example</p>
        <h2>See an agent use Celo PayGrid</h2>
        <p>From natural language to a verifiable payment request.</p>
      </div>
      <div className="demo-grid">
        <div className="demo-panel">
          <div className="demo-toolbar">
            <span>Interactive example</span>
            <div>
              <button
                type="button"
                onClick={() => setPaused((value) => !value)}
                aria-label={paused ? "Replay demo" : "Pause demo"}
              >
                {paused ? <Play size={16} /> : <Pause size={16} />}
                {paused ? "Replay demo" : "Pause demo"}
              </button>
              <button type="button" onClick={() => setStep(0)}>
                <RotateCcw size={16} /> Replay demo
              </button>
            </div>
          </div>
          <div className="timeline" aria-live="polite">
            {visibleSteps.map((item, index) => (
              <motion.article
                className={`timeline-item ${item.code ? "timeline-code" : ""}`}
                key={`${item.role}-${index}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <span>{item.role}</span>
                {item.code ? <pre>{item.text}</pre> : <p>{item.text}</p>}
              </motion.article>
            ))}
          </div>
        </div>
        <aside className="demo-actions panel-card">
          <h3>Try the pattern</h3>
          <p>This demo is simulated. It does not execute a live transaction.</p>
          <CopyButton value={demoCopy} label="Copy example" />
          <a
            className="secondary-action"
            href={site.mcpEndpoint}
            target="_blank"
            rel="noreferrer"
          >
            Open MCP endpoint <ExternalLink size={16} />
          </a>
        </aside>
      </div>
    </section>
  );
}

function Capabilities() {
  return (
    <section className="section-shell" id="capabilities">
      <div className="section-heading">
        <p className="eyebrow">Capabilities</p>
        <h2>One MCP connection. Multiple payment capabilities.</h2>
      </div>
      <div className="card-grid">
        {capabilities.map((capability) => {
          const Icon = capability.icon;
          return (
            <article className="panel-card" key={capability.title}>
              <span className="icon-chip">
                <Icon size={20} />
              </span>
              <h3>{capability.title}</h3>
              <p>{capability.body}</p>
              <code>{capability.tool}</code>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function HowItWorks() {
  const nodes = [
    "User request",
    "AI Agent",
    "Celo PayGrid MCP",
    "Payment request",
    "Celo Mainnet",
    "Verified result",
  ];
  return (
    <section className="section-shell" id="how-it-works">
      <div className="section-heading">
        <p className="eyebrow">How it works</p>
        <h2>From intent to onchain settlement</h2>
      </div>
      <div className="flow-strip" aria-label="Payment flow">
        {nodes.map((node, index) => (
          <div className="flow-node" key={node}>
            <span>{node}</span>
            {index < nodes.length - 1 ? <ChevronRight size={18} /> : null}
          </div>
        ))}
      </div>
      <div className="three-step">
        {[
          [
            "1. Connect",
            "Add the Celo PayGrid remote MCP endpoint to your agent.",
          ],
          [
            "2. Discover",
            "Call get_agent_capabilities to inspect supported payment actions.",
          ],
          [
            "3. Execute",
            "Create payment requests and verify completed transactions.",
          ],
        ].map(([title, body]) => (
          <article className="panel-card" key={title}>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function QuickStart() {
  return (
    <section className="section-shell quick-start" id="developers">
      <div className="section-heading">
        <p className="eyebrow">Developers</p>
        <h2>Connect Celo PayGrid in minutes</h2>
        <p>Built for developers, readable by agents.</p>
      </div>
      <div className="quick-grid">
        <div className="code-panel">
          <div className="code-header">
            <span>MCP config</span>
            <CopyButton value={quickStartConfig} label="Copy MCP config" />
          </div>
          <pre>{quickStartConfig}</pre>
        </div>
        <div className="panel-card developer-card">
          <dl>
            <div>
              <dt>MCP Endpoint</dt>
              <dd>{site.mcpEndpoint}</dd>
            </div>
            <div>
              <dt>Discovery Tool</dt>
              <dd>get_agent_capabilities</dd>
            </div>
            <div>
              <dt>Agent Metadata</dt>
              <dd>{site.metadataEndpoint}</dd>
            </div>
          </dl>
          <blockquote>
            Use Celo PayGrid to create a $10 payment request for website
            hosting.
          </blockquote>
          <div className="button-wrap">
            <CopyButton value={site.mcpEndpoint} label="Copy endpoint" />
            {developerLinks.slice(1).map((link) => {
              const Icon = link.icon;
              return link.href ? (
                <a
                  className="secondary-action compact"
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  key={link.label}
                >
                  <Icon size={16} /> {link.label}
                </a>
              ) : (
                <CopyButton
                  key={link.label}
                  value="get_agent_capabilities"
                  label={link.label}
                />
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function Documentation() {
  return (
    <section className="section-shell" id="docs">
      <div className="section-heading">
        <p className="eyebrow">Documentation</p>
        <h2>Current technical documentation</h2>
        <p>
          Public docs for builders and agents integrating with Celo PayGrid
          today.
        </p>
      </div>
      <div className="docs-grid">
        {docs.map((doc) => {
          const Icon = doc.icon;
          return (
            <a className="panel-card doc-card" href={doc.href} key={doc.title}>
              <span className="icon-chip">
                <Icon size={20} />
              </span>
              <h3>{doc.title}</h3>
              <p>{doc.body}</p>
              <span className="doc-link">
                Open document <ExternalLink size={15} />
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function UseCases() {
  return (
    <section className="section-shell" id="use-cases">
      <div className="section-heading">
        <p className="eyebrow">Use cases</p>
        <h2>Built for agent-driven commerce</h2>
      </div>
      <div className="card-grid use-grid">
        {useCases.map((item) => {
          const Icon = item.icon;
          return (
            <article className="panel-card" key={item.title}>
              <span className="icon-chip">
                <Icon size={20} />
              </span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Differentiation() {
  return (
    <section className="section-shell split-section">
      <div>
        <p className="eyebrow">Differentiation</p>
        <h2>More than a payment link</h2>
        <p className="large-copy">
          Celo PayGrid connects agent reasoning with verifiable payment
          execution.
        </p>
      </div>
      <div className="stack-diagram">
        {stackLayers.map((layer) => {
          const Icon = layer.icon;
          return (
            <article className="stack-layer" key={layer.title}>
              <Icon size={22} />
              <div>
                <h3>{layer.title}</h3>
                <p>{layer.body}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function StatusAndSecurity() {
  return (
    <section className="section-shell status-security">
      <div>
        <div className="section-heading left">
          <p className="eyebrow">Mainnet</p>
          <h2>Live on Celo Mainnet</h2>
        </div>
        <div className="status-grid">
          {mainnetStatus.map(([label, value]) => (
            <div className="status-card" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="section-heading left">
          <p className="eyebrow">Security</p>
          <h2>Built for transparent agent payment workflows</h2>
        </div>
        <ul className="check-list">
          {securityItems.map((item) => (
            <li key={item}>
              <CheckCircle2 size={16} /> {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Roadmap() {
  return (
    <section className="section-shell" id="roadmap">
      <div className="section-heading">
        <p className="eyebrow">Roadmap</p>
        <h2>What's next</h2>
        <p>
          These features are planned and are shown separately from current
          production capabilities.
        </p>
      </div>
      <div className="card-grid">
        {roadmap.map((item) => (
          <article className="panel-card roadmap-card" key={item.title}>
            <span className="roadmap-status">{item.status}</span>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function FAQ() {
  return (
    <section className="section-shell" id="faq">
      <div className="section-heading">
        <p className="eyebrow">FAQ</p>
        <h2>Readable answers for humans and agents</h2>
      </div>
      <div className="faq-list">
        {faqs.map((faq) => (
          <details key={faq.q}>
            <summary>{faq.q}</summary>
            <p>{faq.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="final-cta section-shell">
      <h2>Give your agent a payment layer.</h2>
      <p>
        Connect Celo PayGrid and let your agent create payment requests, verify
        settlement and participate in the agent economy on Celo Mainnet.
      </p>
      <div className="hero-actions">
        <a className="primary-action" href="#developers">
          Connect Celo PayGrid MCP <ArrowRight size={18} />
        </a>
        <a
          className="secondary-action"
          href={site.metadataEndpoint}
          target="_blank"
          rel="noreferrer"
        >
          View agent metadata <ExternalLink size={16} />
        </a>
      </div>
    </section>
  );
}

function Footer() {
  const links = [
    ["MCP Endpoint", site.mcpEndpoint],
    ["Agent Metadata", site.metadataEndpoint],
    ["Documentation", site.docsUrl],
    ["Capabilities", "#capabilities"],
    ["Use Cases", "#use-cases"],
    ["Roadmap", "#roadmap"],
    ["FAQ", "#faq"],
    ["Privacy", "/privacy"],
    ["Terms", "/terms"],
  ];

  return (
    <footer className="site-footer">
      <div>
        <a className="brand" href="#top">
          <img
            className="brand-mark"
            src="/PaygridIcon.png"
            alt="Celo PayGrid logo"
          />
          <span>Celo PayGrid</span>
        </a>
        <p>MCP-based payment infrastructure for AI agents on Celo Mainnet.</p>
        <small>
          Current production capabilities and roadmap features are shown
          separately.
        </small>
      </div>
      <nav aria-label="Footer navigation">
        {links.map(([label, href]) => (
          <a key={label} href={href}>
            {label}
          </a>
        ))}
      </nav>
    </footer>
  );
}

export default function App() {
  // simple in-page route: show pitch deck if URL contains /pitchdeck or #pitchdeck
  const [showPitch, setShowPitch] = useState(() => {
    try {
      const p = window.location.pathname || "";
      const h = window.location.hash || "";
      return (
        p.endsWith("/pitchdeck") ||
        h.includes("pitchdeck") ||
        h.startsWith("#pitch-")
      );
    } catch (e) {
      return false;
    }
  });

  useEffect(() => {
    const onPop = () => {
      const p = window.location.pathname || "";
      const h = window.location.hash || "";
      setShowPitch(
        p.endsWith("/pitchdeck") ||
          h.includes("pitchdeck") ||
          h.startsWith("#pitch-")
      );
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <>
      <Seo />
      <Navbar />
      <main>
        {showPitch ? (
          <PitchDeckSection />
        ) : (
          <>
            <Hero />
            <InteractiveDemo />
            <Capabilities />
            <HowItWorks />
            <QuickStart />
            <Documentation />
            <UseCases />
            <Differentiation />
            <StatusAndSecurity />
            <Roadmap />
            <FAQ />
            <FinalCTA />
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
