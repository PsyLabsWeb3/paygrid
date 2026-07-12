"use client";

import { Loader2, Medal, Trophy } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getGiftLeaderboard } from "@/lib/api";

export function GiftLeaderboard() {
  const query = useQuery({
    queryKey: ["gift-leaderboard"],
    queryFn: getGiftLeaderboard,
    refetchInterval: 15_000,
  });

  if (query.isLoading) {
    return <section className="panel empty-state"><Loader2 size={28} className="animate-spin" /></section>;
  }

  if (query.isError || !query.data) {
    return <section className="panel empty-state"><p className="fine muted">Leaderboard unavailable.</p></section>;
  }

  return (
    <div className="stack">
      <section className="panel panel-pad">
        <div className="split-row">
          <div>
            <p className="fine muted">Hackathon reward pool</p>
            <h2 className="checkout-amount">${query.data.prizePoolUsd}</h2>
          </div>
          <Trophy size={32} color="var(--lime)" />
        </div>
        <p className="fine muted">$25 most claims · $10 unique recipients · $10 referral chain · $5 draw</p>
      </section>

      {query.data.entries.length === 0 ? (
        <section className="panel empty-state">
          <div><h2 className="top-title">The first spot is open</h2><p className="fine muted">Fund a gift and have it claimed to enter.</p></div>
        </section>
      ) : query.data.entries.map((entry) => (
        <section className="panel panel-pad" key={`${entry.rank}-${entry.accountHint}`}>
          <div className="split-row">
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span className="token-mark">{entry.rank}</span>
              <div>
                <h2 className="top-title">{entry.accountHint}</h2>
                <p className="fine muted">{entry.uniqueRecipients} unique recipients</p>
              </div>
            </div>
            {entry.rank <= 3 ? <Medal size={24} color="var(--lime)" /> : null}
          </div>
          <div className="field-grid" style={{ marginTop: 14 }}>
            <div><span className="label">Claimed</span><strong>{entry.claimedGifts}</strong></div>
            <div><span className="label">Volume</span><strong>${entry.claimedVolume}</strong></div>
          </div>
          <p className="fine muted" style={{ marginTop: 12 }}>{entry.swapGifts} auto-swaps · {entry.referralConversions} referrals</p>
        </section>
      ))}
    </div>
  );
}
