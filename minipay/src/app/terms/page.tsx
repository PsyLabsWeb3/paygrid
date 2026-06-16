import { FileText } from "lucide-react";
import { AppShell } from "@/components/app-shell";

export default function TermsPage() {
  return (
    <AppShell active="request">
      <section className="hero-band">
        <div className="top-bar">
          <button className="icon-button" aria-label="Terms">
            <FileText size={20} />
          </button>
          <h1 className="top-title">Terms</h1>
          <span />
        </div>
        <h2 className="hero-title">Terms of service</h2>
      </section>

      <section className="panel panel-pad">
        <p className="fine muted">
          Production terms should define payment request usage, stablecoin settlement,
          provider availability, support handling, and restricted activity.
        </p>
      </section>
    </AppShell>
  );
}
