"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CheckoutView } from "@/components/checkout-view";

export default function PayPage() {
  const params = useParams<{ id: string }>();

  return (
    <AppShell active="pay">
      <CheckoutView id={params.id} />
    </AppShell>
  );
}
