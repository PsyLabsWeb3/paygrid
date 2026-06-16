"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartNoAxesCombined, CircleDollarSign, History, Plus } from "lucide-react";

type NavKey = "request" | "pay" | "activity" | "stats";

type Props = {
  active: NavKey;
  children: React.ReactNode;
};

const nav = [
  { key: "request", href: "/", label: "Create request", icon: Plus },
  { key: "pay", href: "/", label: "Pay", icon: CircleDollarSign },
  { key: "activity", href: "/activity", label: "Activity", icon: History },
  { key: "stats", href: "/stats", label: "Stats", icon: ChartNoAxesCombined },
] satisfies Array<{
  key: NavKey;
  href: string;
  label: string;
  icon: typeof Plus;
}>;

export function AppShell({ active, children }: Props) {
  const pathname = usePathname();

  return (
    <main className="app-shell">
      <div className="mobile-frame">
        {children}
        <nav className="bottom-nav" aria-label="Primary">
          {nav.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.key || pathname === item.href;
            return (
              <Link
                className={`nav-link ${isActive ? "nav-active" : ""}`}
                href={item.href}
                aria-label={item.label}
                title={item.label}
                key={item.key}
              >
                <Icon size={22} />
              </Link>
            );
          })}
        </nav>
      </div>
    </main>
  );
}
