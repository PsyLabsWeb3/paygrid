import type { LinkStatus } from "@/lib/api";
import type { Stablecoin } from "@/lib/tokens";

const STORAGE_KEY = "paygrid.localActivity";

export type LocalActivityItem = {
  id: string;
  amount: string;
  token: Stablecoin;
  description?: string;
  status: LinkStatus;
  createdAt: string;
};

export function getLocalActivity(): LocalActivityItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const items = JSON.parse(raw) as LocalActivityItem[];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

export function addLocalActivity(item: LocalActivityItem) {
  if (typeof window === "undefined") return;
  const next = [item, ...getLocalActivity().filter((entry) => entry.id !== item.id)].slice(0, 20);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
