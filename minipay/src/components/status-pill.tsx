import { CheckCircle2, Clock3, XCircle } from "lucide-react";
import type { LinkStatus } from "@/lib/api";

export function StatusPill({ status }: { status: LinkStatus }) {
  const Icon =
    status === "paid" ? CheckCircle2 : status === "active" ? Clock3 : XCircle;

  return (
    <span className={`status-pill status-${status}`}>
      <Icon size={14} />
      {status}
    </span>
  );
}
