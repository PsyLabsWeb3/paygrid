import type { Address, Hex } from "viem";
import { appConfig } from "@/lib/env";
import type { Stablecoin } from "@/lib/tokens";

export type LinkStatus = "active" | "paid" | "expired" | "cancelled";
export type GiftStatus = "draft" | "funding" | "active" | "claimed" | "cancelled" | "expired" | "refunded";

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
  acceptedMethods: Array<"crypto" | "fonbnk" | "card">;
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

export type SwapQuote = {
  paymentMode: "exact" | "swap";
  payerToken: Stablecoin;
  settlementToken: Stablecoin;
  amountOut: string;
  amountIn: string;
  amountInMax: string;
  minAmountOut: string;
  priceImpact: string | null;
  protocol: "none" | "mento" | "uniswap-v3";
  swapTarget: Address | null;
  expiresAt: string;
};

type PayTxResponse = {
  method: "crypto";
  paymentMode?: "exact" | "swap";
  tx?: {
    to: Address;
    data: Hex;
    value: string;
  };
  approveTx?: {
    to: Address;
    data: Hex;
    value: string;
    amount: string;
    token: Stablecoin;
  };
  payTx?: {
    to: Address;
    data: Hex;
    value: string;
  };
  quote?: SwapQuote;
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
    const errorBody = data && typeof data === "object"
      ? (data as { error?: string | { message?: string }; message?: string })
      : null;
    console.error("Paygrid API request failed", {
      path,
      status: res.status,
      body: data,
    });
    const message = errorBody?.message
      ?? (typeof errorBody?.error === "string" ? errorBody.error : errorBody?.error?.message)
      ?? "Request failed";
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

export function quotePaymentLink(id: string, input: { payerToken: Stablecoin; slippageBps?: number }) {
  return requestJson<SwapQuote>(`/api/links/${id}/quote`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function buildPayTx(id: string, input?: { payerToken?: Stablecoin; slippageBps?: number }) {
  return requestJson<PayTxResponse>(`/api/links/${id}/pay`, {
    method: "POST",
    body: JSON.stringify({ method: "crypto", ...input }),
  });
}

export function createRampSession(id: string, input: { finalUrl?: string } = {}) {
  return requestJson<RampSessionResponse>(`/api/links/${id}/pay`, {
    method: "POST",
    body: JSON.stringify({ method: "ramp", ...input }),
  });
}

export type Gift = {
  id: string;
  onChainGiftId: string | null;
  senderAlias: string;
  recipientAlias: string;
  message: string;
  amount: string;
  token: Stablecoin;
  status: GiftStatus;
  usedSwap: boolean;
  referralCode: string;
  fundingTxHash: Hex | null;
  claimTxHash: Hex | null;
  refundTxHash: Hex | null;
  expiresAt: string;
  claimedAt: string | null;
  createdAt: string;
  reference: string;
};

export type CreateGiftInput = {
  senderAddress: Address;
  senderAlias: string;
  recipientAlias: string;
  message: string;
  amount: string;
  token: Stablecoin;
  claimHash: Hex;
  expiresAt: string;
  sourceReferralCode?: string;
};

export function createGift(input: CreateGiftInput) {
  return requestJson<Gift & { metadataHash: Hex; shareUrl: string }>("/api/gifts/minipay", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getGift(id: string) {
  return requestJson<Gift>(`/api/gifts/${id}/public`);
}

export function prepareGiftFunding(id: string, input: { payerToken: Stablecoin; slippageBps?: number }) {
  return requestJson<{
    gift: Gift;
    quote: SwapQuote & {
      giftAmount: string;
      fee: string;
      totalSettlement: string;
      displayFee: string;
      displayTotal: string;
      displayAmountInMax: string;
    };
    approveTx: { to: Address; data: Hex; value: string; amount: string; token: Stablecoin };
    fundTx: { to: Address; data: Hex; value: string };
  }>(`/api/gifts/${id}/funding-tx`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createGiftClaimSession(id: string, secret: string) {
  return requestJson<{ token: string; expiresAt: string }>(`/api/gifts/${id}/claim-session`, {
    method: "POST",
    body: JSON.stringify({ secret }),
  });
}

export function prepareGiftClaim(id: string, sessionToken: string, recipientAddress: Address) {
  return requestJson<{
    tx: { to: Address; data: Hex; value: string };
    authorization: { nonce: string; deadline: string };
  }>(`/api/gifts/${id}/claim-authorization`, {
    method: "POST",
    body: JSON.stringify({ sessionToken, recipientAddress }),
  });
}

export function prepareGiftClaimWithAccount(id: string, sessionToken: string, recipientAddress: Address) {
  return requestJson<{
    tx: { to: Address; data: Hex; value: string; gas: string; feeCurrency?: Address };
    authorization: { nonce: string; deadline: string };
    sponsorship: {
      required: boolean;
      status: "not_needed" | "confirmed";
      amount: string;
      token: "USDm";
      txHash: Hex | null;
    };
  }>(`/api/gifts/${id}/claim-preparation`, {
    method: "POST",
    body: JSON.stringify({ sessionToken, recipientAddress }),
  });
}

export function getGiftLeaderboard() {
  return requestJson<{
    entries: Array<{
      rank: number;
      accountHint: string;
      claimedGifts: number;
      uniqueRecipients: number;
      claimedVolume: string;
      swapGifts: number;
      referralConversions: number;
    }>;
    prizePoolUsd: number;
    updatedAt: string;
  }>("/api/gifts/leaderboard");
}

export type TreasurySignal = {
  id: string;
  externalSignalId: string;
  timeframe: string;
  entryPrice: string;
  slPrice: string;
  tpPrice: string;
  strategy: { code: string; name: string; description: string | null };
  symbol: { code: string; baseAsset: "CELO" | "ORO"; quoteAsset: Stablecoin };
  status: "pending" | "processing" | "executed" | "rejected" | "failed";
  positionId: string | null;
  reason: string | null;
  receivedAt: string;
  processedAt: string | null;
};

export type TreasuryPosition = {
  id: string;
  signalId: string;
  asset: "CELO" | "ORO";
  quoteToken: Stablecoin;
  mode: "paper" | "live";
  route: "paper" | "mento" | "uniswap-v3";
  status: "open" | "closing" | "closed" | "failed";
  amountAsset: string;
  costQuote: string;
  entryPrice: string;
  currentPrice: string;
  oraclePrice: string | null;
  executablePrice: string | null;
  priceDivergenceBps: number | null;
  oracleSource: string | null;
  oracleUpdatedAt: string | null;
  priceBlockNumber: string | null;
  priceRoute: "mento" | "uniswap-v3" | null;
  slPrice: string;
  tpPrice: string;
  pnlQuote: string;
  entryTxHash: Hex | null;
  exitTxHash: Hex | null;
  closeReason: string | null;
  closeRequestedAt: string | null;
  openedAt: string;
  closedAt: string | null;
  lastCheckedAt: string | null;
};

export type TreasuryQuantStatus = {
  name: string;
  enabled: boolean;
  mode: "paper" | "live";
  paused: boolean;
  pauseReason: string | null;
  executorConfigured: boolean;
  assets: {
    CELO: { enabled: boolean; oracleConfigured: boolean };
    ORO: { enabled: boolean; oracleConfigured: boolean; symbol: string };
  };
  limits: {
    defaultPositionUsd: string;
    maxPerTradeUsd: string;
    maxTotalExposureUsd: string;
    maxOpenPositionsPerAsset: number;
    dailyLossLimitUsd: string;
    maxSlippageBps: number;
    maxPriceDivergenceBps: number;
    oracleMaxAgeSeconds: number;
  };
  balances: Partial<Record<Stablecoin | "CELO" | "ORO", string>>;
  metrics: {
    openPositions: number;
    totalExposureUsd: string;
    pendingSignals: number;
  };
  recentSignals: TreasurySignal[];
  positions: TreasuryPosition[];
};

export function getTreasuryQuantStatus() {
  return requestJson<TreasuryQuantStatus>("/api/treasury/status");
}

function treasuryControl(path: string, operatorKey: string, body?: Record<string, unknown>) {
  return requestJson<{ paused?: boolean; reason?: string | null } | TreasuryPosition>(path, {
    method: "POST",
    headers: { "x-treasury-admin-key": operatorKey },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function pauseTreasuryQuantAgent(operatorKey: string, reason?: string) {
  return treasuryControl("/api/treasury/control/pause", operatorKey, { reason });
}

export function resumeTreasuryQuantAgent(operatorKey: string) {
  return treasuryControl("/api/treasury/control/resume", operatorKey);
}

export function closeTreasuryPosition(id: string, operatorKey: string) {
  return treasuryControl(`/api/treasury/positions/${id}/close`, operatorKey);
}
