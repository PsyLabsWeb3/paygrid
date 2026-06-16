"use client";

import Link from "next/link";
import { ExternalLink, History } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { useLocalActivity } from "@/hooks/use-local-activity";

export default function ActivityPage() {
  const { items } = useLocalActivity();

  return (
    <AppShell active="activity">
      <section className="hero-band">
        <div className="top-bar">
          <button className="icon-button" aria-label="Activity">
            <History size={20} />
          </button>
          <h1 className="top-title">Activity</h1>
          <span />
        </div>
        <h2 className="hero-title">Recent requests</h2>
      </section>

      {items.length === 0 ? (
        <section className="panel empty-state">
          <div>
            <h2 className="top-title">No local requests</h2>
            <p className="fine muted">Created requests will appear here on this device.</p>
          </div>
        </section>
      ) : (
        <div className="stack">
          {items.map((item) => (
            <Link className="activity-item" href={`/pay/${item.id}`} key={item.id}>
              <div className="split-row">
                <strong>
                  {item.amount} {item.token}
                </strong>
                <StatusPill status={item.status} />
              </div>
              <span className="fine muted">{item.description || "Payment request"}</span>
              <span className="split-row fine muted">
                Open checkout
                <ExternalLink size={16} />
              </span>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
