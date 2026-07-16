"use client";

import { Activity, Shield } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { TreasuryDashboard } from "@/components/treasury-dashboard";

export default function TreasuryPage() {
  return (
    <AppShell active="treasury">
      <section className="hero-band">
        <div className="top-bar">
          <button className="icon-button" aria-label="Risk controls"><Shield size={20} /></button>
          <span className="segment segment-active" style={{ display: "inline-flex", alignItems: "center" }}>
            Treasury
          </span>
          <button className="icon-button" aria-label="Live monitoring"><Activity size={20} /></button>
        </div>
        <h1 className="campaign-title">Treasury Quant Agent</h1>
        <p className="hero-copy">
          Guarded LONG execution, Mento-first routing and verifiable TP/SL settlement on Celo.
        </p>
      </section>
      <TreasuryDashboard />
    </AppShell>
  );
}
