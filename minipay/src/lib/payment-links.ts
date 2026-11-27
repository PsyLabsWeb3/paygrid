import { paymentTokens, tokenDecimals, type SupportedPaymentToken } from "./tokens";

export function linkPaymentMethods(token: SupportedPaymentToken): Array<"crypto" | "fonbnk" | "card"> {
  return token === "wMXN" ? ["crypto"] : ["crypto", "fonbnk", "card"];
}

export function linkPayerTokens(token: SupportedPaymentToken, accepted?: string[]): SupportedPaymentToken[] {
  const candidates: SupportedPaymentToken[] = token === "wMXN" ? ["wMXN"] : paymentTokens;
  return accepted ? candidates.filter((value) => accepted.includes(value)) : candidates;
}

export function isValidLinkAmount(amount: string, token: SupportedPaymentToken) {
  const value = amount.trim();
  if (value.length > 80) return false;
  if (!/^\d+(\.\d+)?$/.test(value)) return false;
  const [whole, fraction = ""] = value.split(".");
  if (whole.replace(/^0+/, "").length > 18 || fraction.length > tokenDecimals[token]) return false;
  return BigInt(whole + fraction) > 0n;
}

export function availableLinkTokens(config: { chainId: number; tokens: SupportedPaymentToken[] } | undefined, chainId: number) {
  if (!config) return [...paymentTokens];
  if (config.chainId !== chainId) return [];
  return [...paymentTokens, ...(chainId === 42220 && config.tokens.includes("wMXN") ? ["wMXN" as const] : [])];
}
