"use client";

import { Landmark } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { RipioCanaryDashboard } from "@/components/ripio-canary-dashboard";

export default function RipioCanaryPage() {
  return (
    <AppShell active="request">
      <section className="hero-band">
        <div className="top-bar"><Landmark size={22} /><span className="segment segment-active">Canary privada</span></div>
        <h1 className="campaign-title">SPEI ↔ wMXN</h1>
        <p className="hero-copy">Prueba controlada en Celo Mainnet con Ripio, límite de 100 MXN y liberación manual.</p>
      </section>
      <RipioCanaryDashboard />
    </AppShell>
  );
}
