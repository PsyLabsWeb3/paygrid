import type { Address, Hex } from "viem";
import { appConfig } from "@/lib/env";
import type { Stablecoin } from "@/lib/tokens";

export type LinkStatus = "active" | "paid" | "expired" | "cancelled";

export type PaymentLink = {
  id: string;
  onChainLinkId: string;
  recipientAddress: Address;
  amount: string;
  token: Stablecoin;
  description: string | null;
  acceptedMethods: string[];
  status: LinkStatus;
  txHash: string | null;
  createdAt: string;
  expiresAt: string | null;
};

export type CreateMiniPayLinkInput = {
  amount: string;
  token: Stablecoin;
  description?: string;
  recipientAddress: Address;
  acceptedMethods: Array<"crypto" | "fonbnk">;
};

type CreateMiniPayLinkResponse = {
  id: string;
  onChainLinkId: string;
  url: string;
  amount: string;
  token: Stablecoin;
  status: LinkStatus;
  createdAt: string;
  txHash: Hex;
};

type PayTxResponse = {
  method: "crypto";
  tx: {
    to: Address;
    data: Hex;
    value: string;
  };
  link: {
    id: string;
    onChainLinkId: string;
    amount: string;
    token: Stablecoin;
  };
};

type RampSessionResponse = {
  method: "ramp";
  session: {
    id: string;
    provider: "ramp";
    redirectUrl: string;
    token: Stablecoin;
    amount: string;
    asset: string;
    environment: "demo" | "production";
  };
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${appConfig.backendUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  const data = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const errorBody =
      data && typeof data === "object" ? (data as { error?: string; message?: string }) : null;
    const message =
      errorBody?.message
        ? errorBody.message
        : errorBody?.error
          ? errorBody.error
          : "Request failed";
    throw new Error(message);
  }

  return data as T;
}

export function createMiniPayLink(input: CreateMiniPayLinkInput) {
  return requestJson<CreateMiniPayLinkResponse>("/api/links/minipay", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getPaymentLink(id: string) {
  return requestJson<PaymentLink>(`/api/links/${id}`);
}

export function buildPayTx(id: string) {
  return requestJson<PayTxResponse>(`/api/links/${id}/pay`, {
    method: "POST",
    body: JSON.stringify({ method: "crypto" }),
  });
}

export function createRampSession(id: string, input: { finalUrl?: string } = {}) {
  return requestJson<RampSessionResponse>(`/api/links/${id}/pay`, {
    method: "POST",
    body: JSON.stringify({ method: "ramp", ...input }),
  });
}
