export type GiftIntent = {
  recipientAlias: string;
  amount: string;
  message: string;
};

export function parseGiftIntent(prompt: string): GiftIntent | null {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  const amountMatch = normalized.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (!amountMatch) return null;

  const recipientMatch = normalized.match(/(?:send|gift|give|reward|thank)\s+(?:a\s+gift\s+to\s+)?([\p{L}\d_-]+)/iu);
  if (!recipientMatch) return null;
  const reasonMatch = normalized.match(/\b(?:for|because)\s+(.+?)(?:[.!]|$)/i);
  const reason = reasonMatch?.[1]?.trim();
  const recipientAlias = recipientMatch[1];
  const message = reason
    ? `${reason.charAt(0).toUpperCase()}${reason.slice(1)}. Enjoy your gift!`
    : `A little something for you, ${recipientAlias}.`;

  return { recipientAlias, amount: amountMatch[1], message };
}
