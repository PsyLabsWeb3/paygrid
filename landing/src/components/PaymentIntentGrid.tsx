import React from "react";

export default function PaymentIntentGrid({ compact }: { compact?: boolean }) {
  const items = [
    "collect invoice",
    "collect deposit",
    "pay supplier",
    "renew subscription",
    "confirm order",
    "release escrow",
    "collect on delivery",
    "pay API/x402 endpoint",
  ];
  return (
    <div className={`intent-grid ${compact ? "compact" : ""}`}>
      {items.map((it) => (
        <div key={it} className="intent-card panel-card">
          <strong>{it}</strong>
        </div>
      ))}
    </div>
  );
}
