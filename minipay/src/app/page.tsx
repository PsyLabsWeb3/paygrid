"use client";

import { ArrowUpRight, Bell, QrCode } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PaymentRequestForm } from "@/components/payment-request-form";
import { useMiniPayAccount } from "@/hooks/use-minipay-account";

export default function HomePage() {
  const { accountHint, isMiniPay } = useMiniPayAccount();

  return (
    <AppShell active="request">
      <section className="hero-band">
        <div className="top-bar">
          <button className="icon-button" aria-label="Scan request">
            <QrCode size={20} />
          </button>
          <div className="segmented" aria-label="Paygrid mode">
            <span className="segment segment-active">Request</span>
            <span className="segment">Agent</span>
          </div>
          <button className="icon-button" aria-label="Notifications">
            <Bell size={20} />
          </button>
        </div>
        <h1 className="hero-title">Paygrid</h1>
        <p className="hero-copy">
          Programmable payment requests for people and agents on Celo.
        </p>
      </section>

      <div className="stack">
        <section className="panel panel-pad">
          <div className="split-row">
            <div>
              <p className="fine muted">Receiving to</p>
              <h2 className="top-title">{accountHint}</h2>
            </div>
            <span className="token-chip">
              <span className="token-mark">C</span>
              Celo
            </span>
          </div>
          {!isMiniPay ? (
            <p className="fine muted" style={{ marginTop: 12 }}>
              MiniPay gives this flow the cleanest account experience.
            </p>
          ) : null}
        </section>

        <PaymentRequestForm />

        <section className="panel panel-pad">
          <div className="split-row">
            <div>
              <p className="fine muted">Frontier track</p>
              <h2 className="top-title">Agent-ready checkout</h2>
            </div>
            <ArrowUpRight size={22} color="var(--lime)" />
          </div>
          <p className="fine muted" style={{ marginTop: 10 }}>
            Built for payment requests that can be created by humans today and agents next.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
