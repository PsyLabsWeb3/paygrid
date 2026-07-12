"use client";

import { useParams } from "next/navigation";
import { GiftClaimView } from "@/components/gift-claim-view";

export default function GiftPage() {
  const params = useParams<{ id: string }>();
  return (
    <main className="app-shell">
      <div className="mobile-frame claim-frame">
        <GiftClaimView id={params.id} />
      </div>
    </main>
  );
}
