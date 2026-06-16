import { LifeBuoy, Mail } from "lucide-react";
import { AppShell } from "@/components/app-shell";

export default function SupportPage() {
  return (
    <AppShell active="request">
      <section className="hero-band">
        <div className="top-bar">
          <button className="icon-button" aria-label="Support">
            <LifeBuoy size={20} />
          </button>
          <h1 className="top-title">Support</h1>
          <span />
        </div>
        <h2 className="hero-title">We can help</h2>
      </section>

      <section className="panel panel-pad">
        <div className="split-row">
          <div>
            <p className="fine muted">Contact</p>
            <h2 className="top-title">Paygrid support</h2>
          </div>
          <Mail size={22} color="var(--lime)" />
        </div>
        <p className="fine muted" style={{ marginTop: 10 }}>
          Replace this page with the production support channel before MiniPay submission.
        </p>
      </section>
    </AppShell>
  );
}
