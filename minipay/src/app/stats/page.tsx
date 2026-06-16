import { ChartNoAxesCombined, CircleDollarSign, RadioTower } from "lucide-react";
import { AppShell } from "@/components/app-shell";

export default function StatsPage() {
  return (
    <AppShell active="stats">
      <section className="hero-band">
        <div className="top-bar">
          <button className="icon-button" aria-label="Stats">
            <ChartNoAxesCombined size={20} />
          </button>
          <h1 className="top-title">Stats</h1>
          <span />
        </div>
        <h2 className="hero-title">Network pulse</h2>
      </section>

      <div className="metric-grid">
        <section className="metric">
          <CircleDollarSign size={24} color="var(--lime)" />
          <strong>USDC</strong>
          <span className="fine muted">Primary test asset</span>
        </section>
        <section className="metric">
          <RadioTower size={24} color="var(--lime)" />
          <strong>Celo</strong>
          <span className="fine muted">Fast settlement</span>
        </section>
      </div>

      <section className="panel panel-pad" style={{ marginTop: 14 }}>
        <h2 className="top-title">Readiness</h2>
        <p className="fine muted" style={{ marginTop: 10 }}>
          Public stats will connect to Paygrid activity once mainnet launch metrics are live.
        </p>
      </section>
    </AppShell>
  );
}
