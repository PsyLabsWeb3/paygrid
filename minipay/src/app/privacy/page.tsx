import { ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";

export default function PrivacyPage() {
  return (
    <AppShell active="request">
      <section className="hero-band">
        <div className="top-bar">
          <button className="icon-button" aria-label="Privacy">
            <ShieldCheck size={20} />
          </button>
          <h1 className="top-title">Privacy</h1>
          <span />
        </div>
        <h2 className="hero-title">Privacy policy</h2>
      </section>

      <section className="panel panel-pad">
        <p className="fine muted">
          Production privacy copy should explain account metadata, payment request records,
          provider data, and support retention.
        </p>
      </section>
    </AppShell>
  );
}
