import { createHmac, randomUUID } from "node:crypto";
import type { Env } from "../config/env.js";
import type { PartnerWebhookOutboxRow } from "../db/supabase.js";
import { getSupabase } from "../db/supabase.js";

export type PartnerEventType =
  | "payment_link.active"
  | "payment_link.paid"
  | "payment_link.expired"
  | "payment_link.cancelled"
  | "payment_link.failed";

export async function enqueueOdeleiteWebhook(
  env: Env,
  eventType: PartnerEventType,
  data: Record<string, unknown>,
) {
  if (!env.ODELEITE_WEBHOOK_URL || !env.ODELEITE_WEBHOOK_SECRET) return;
  const { error } = await getSupabase(env).from("partner_webhook_outbox").insert({
    partner_name: "odeleite",
    event_type: eventType,
    payload: data,
  });
  if (error) throw new Error(`Unable to enqueue Odeleite webhook: ${error.message}`);
}

export function signPartnerWebhook(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

async function deliverOdeleiteWebhook(env: Env, row: PartnerWebhookOutboxRow) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const eventId = row.id || randomUUID();
  const body = JSON.stringify({
    id: eventId,
    type: row.event_type,
    created_at: row.created_at,
    data: row.payload,
  });
  const response = await fetch(env.ODELEITE_WEBHOOK_URL!, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-paygrid-event-id": eventId,
      "x-paygrid-timestamp": timestamp,
      "x-paygrid-signature": `v1=${signPartnerWebhook(env.ODELEITE_WEBHOOK_SECRET!, timestamp, body)}`,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Odeleite responded HTTP ${response.status}`), {
      responseStatus: response.status,
    });
  }
  return response.status;
}

export async function drainPartnerWebhookOutbox(env: Env, limit = 50) {
  if (!env.ODELEITE_WEBHOOK_URL || !env.ODELEITE_WEBHOOK_SECRET) return { delivered: 0, failed: 0 };
  const now = new Date().toISOString();
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from("partner_webhook_outbox")
    .select("*")
    .eq("partner_name", "odeleite")
    .eq("status", "pending")
    .lte("next_attempt_at", now)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Unable to read partner webhook outbox: ${error.message}`);

  let delivered = 0;
  let failed = 0;
  for (const row of (data ?? []) as PartnerWebhookOutboxRow[]) {
    const attempts = row.attempt_count + 1;
    try {
      const responseStatus = await deliverOdeleiteWebhook(env, row);
      await supabase.from("partner_webhook_outbox").update({
        status: "delivered",
        attempt_count: attempts,
        delivered_at: new Date().toISOString(),
        last_response_code: responseStatus,
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      delivered += 1;
    } catch (error) {
      const finalFailure = attempts >= 8;
      const delaySeconds = Math.min(3600, 2 ** attempts * 15);
      await supabase.from("partner_webhook_outbox").update({
        status: finalFailure ? "failed" : "pending",
        attempt_count: attempts,
        next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
        last_response_code:
          typeof error === "object" && error && "responseStatus" in error
            ? Number(error.responseStatus)
            : null,
        last_error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      failed += 1;
    }
  }
  return { delivered, failed };
}
