export const MINIPAY_ADD_CASH_URL =
  "https://link.minipay.xyz/add_cash?tokens=USDm,USDC,USDT";

export function isMiniPayEnvironment(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as Window & { ethereum?: { isMiniPay?: boolean } }).ethereum?.isMiniPay === true
  );
}

export function getAccountHint(address?: string): string {
  if (!address) return "MiniPay account";
  if (isMiniPayEnvironment()) return "MiniPay account";
  return "Connected account";
}

export function redirectToMiniPayDeposit(): void {
  if (typeof window !== "undefined") {
    window.location.href = MINIPAY_ADD_CASH_URL;
  }
}
