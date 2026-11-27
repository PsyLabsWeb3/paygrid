import type { PaymentLinkRow } from "../db/supabase.js";
import { formatHumanAmount, parseHumanAmount } from "./tokens.js";
export function linkAmountAtomic(link: Pick<PaymentLinkRow, "amount" | "amount_atomic" | "token">) {
  return link.amount_atomic != null ? BigInt(link.amount_atomic) : parseHumanAmount(link.amount, link.token);
}
export function linkAmount(link: Pick<PaymentLinkRow, "amount" | "amount_atomic" | "token">) {
  return link.amount_atomic != null ? formatHumanAmount(linkAmountAtomic(link), link.token) : String(link.amount);
}
