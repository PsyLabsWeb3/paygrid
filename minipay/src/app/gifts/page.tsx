"use client";

import { Gift, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { GiftComposer } from "@/components/gift-composer";

export default function GiftsPage() {
  return (
    <AppShell active="gifts">
      <section className="hero-band">
        <div className="top-bar">
          <span className="icon-button"><Gift size={20} /></span>
          <h1 className="top-title">Gift Agent</h1>
          <span className="icon-button"><ShieldCheck size={20} /></span>
        </div>
        <h2 className="campaign-title">Send the reason behind the dollars.</h2>
        <p className="hero-copy">Describe the gift. PayGrid handles routing, delivery and verifiable settlement.</p>
      </section>
      <div className="stack">
        <GiftComposer />
      </div>
    </AppShell>
  );
}
