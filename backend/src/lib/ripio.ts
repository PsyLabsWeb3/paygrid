import { createHmac, timingSafeEqual } from "node:crypto";
import { isAddressEqual, type Address } from "viem";
import type { RipioCanaryStatus } from "../db/supabase.js";

type Json = Record<string, any>;

const STATUS_ORDER: RipioCanaryStatus[] = [
  "CREATING", "WAITING_SPEI", "MXN_RECEIVED", "TRADE_COMPLETED", "WITHDRAWAL_PROCESSING",
  "READY_FOR_RELEASE", "RELEASING", "RELEASED", "OFFRAMP_DEPOSIT_RECEIVED",
  "OFFRAMP_TRADE_COMPLETED", "OFFRAMP_WITHDRAWAL_PROCESSING", "COMPLETED",
];

export function isValidMexicanClabe(value: string) {
  if (!/^\d{18}$/.test(value)) return false;
  const weights = [3, 7, 1];
  const sum = value.slice(0, 17).split("").reduce((total, digit, index) =>
    total + (Number(digit) * weights[index % 3]) % 10, 0);
  return (10 - (sum % 10)) % 10 === Number(value[17]);
}

export function verifyRipioWebhookSignature(rawBody: string, header: string | undefined, secret: string) {
  if (!header) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

export function calculateRouterFee(gross: bigint, feeBps: bigint) {
  const fee = gross * feeBps / 10_000n;
  return { fee, net: gross - fee };
}

export function mapRipioEventStatus(eventType: string): RipioCanaryStatus | null {
  const map: Record<string, RipioCanaryStatus> = {
    "ON-RAMP.DEPOSIT.RECEIVED": "MXN_RECEIVED",
    "ON-RAMP.TRADE.COMPLETED": "TRADE_COMPLETED",
    "ON-RAMP.WITHDRAWAL.PROCESSING": "WITHDRAWAL_PROCESSING",
    "ON-RAMP.WITHDRAWAL.COMPLETED": "READY_FOR_RELEASE",
    "ON-RAMP.ORDER.CANCELLED": "FAILED",
    "ON-RAMP.ORDER.REFUNDED": "REFUNDED",
    "OFF-RAMP.DEPOSIT.RECEIVED": "OFFRAMP_DEPOSIT_RECEIVED",
    "OFF-RAMP.TRADE.COMPLETED": "OFFRAMP_TRADE_COMPLETED",
    "OFF-RAMP.WITHDRAWAL.PROCESSING": "OFFRAMP_WITHDRAWAL_PROCESSING",
    "OFF-RAMP.WITHDRAWAL.COMPLETED": "COMPLETED",
    "OFF-RAMP.ORDER.CANCELLED": "FAILED",
    "OFF-RAMP.ORDER.REFUNDED": "REFUNDED",
  };
  return map[eventType] ?? null;
}

export function shouldAdvanceRipioStatus(current: RipioCanaryStatus, next: RipioCanaryStatus) {
  if (current === "FAILED" || current === "REFUNDED" || current === "COMPLETED") return false;
  if (next === "FAILED" || next === "REFUNDED") return true;
  return STATUS_ORDER.indexOf(next) > STATUS_ORDER.indexOf(current);
}

export function hasRipioAssetNetwork(response: Json | Json[], network: string, symbol: string, address: Address) {
  const networks = Array.isArray(response) ? response : (response.results ?? response.items ?? response.data ?? [response]);
  return (Array.isArray(networks) ? networks : [networks]).some((item: Json) => {
    const chain = String(item.network_name ?? item.chain ?? item.network ?? item.name ?? "").toUpperCase();
    const assets = Array.isArray(item.assets) ? item.assets : [item];
    return chain.includes(network.toUpperCase()) && assets.some((asset: Json) => {
      const currency = String(asset.name ?? asset.currency?.code ?? asset.currency ?? asset.asset ?? "").toUpperCase();
      const contract = asset.contract_address ?? asset.contractAddress ?? asset.tokenAddress ?? asset.currency?.contractAddress;
      return currency === symbol.toUpperCase()
        && typeof contract === "string"
        && isAddressEqual(contract as Address, address);
    });
  });
}
