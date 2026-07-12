"use client";

import { Trophy } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { GiftLeaderboard } from "@/components/gift-leaderboard";

export default function LeaderboardPage() {
  return (
    <AppShell active="leaderboard">
      <section className="hero-band">
        <div className="top-bar">
          <span className="icon-button"><Trophy size={20} /></span>
          <h1 className="top-title">Gift leaderboard</h1>
          <span />
        </div>
        <h2 className="campaign-title">Claim. Refer. Keep the chain moving.</h2>
      </section>
      <div className="stack"><GiftLeaderboard /></div>
    </AppShell>
  );
}
