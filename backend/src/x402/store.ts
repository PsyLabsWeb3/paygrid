import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentRequirements } from "@x402/core/types";
import {
  X402Error,
  type Operation,
  type Store,
  type Request,
  type Patch,
  type Payment,
} from "./types.js";

function check(error: { message: string } | null) {
  if (!error) return;
  for (const code of [
    "IDEMPOTENCY_CONFLICT",
    "BUDGET_EXCEEDED",
    "WALLET_BUSY",
    "LEASE_LOST",
  ]) {
    if (error.message.includes(code))
      throw new X402Error(409, code, code.replaceAll("_", " "));
  }
  // SQL errors may contain data. Never surface them or log signed payloads.
  throw new X402Error(
    503,
    "X402_STORAGE_UNAVAILABLE",
    "x402 persistence is unavailable",
  );
}
function normalize(raw: unknown): Operation {
  const op = raw as Operation;
  if (op.amount_atomic !== null) op.amount_atomic = String(op.amount_atomic);
  return op;
}
export class SupabaseStore implements Store {
  constructor(private db: SupabaseClient) {}
  private async rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await this.db.rpc(name, args);
    check(error);
    return data;
  }
  async create(
    direction: Operation["direction"],
    key: string,
    hash: string,
    request: Request,
    network: string,
  ) {
    return normalize(
      await this.rpc("x402_create_operation", {
        p_direction: direction,
        p_key: key,
        p_hash: hash,
        p_request: request,
        p_network: network,
      }),
    );
  }
  async get(id: string) {
    const { data, error } = await this.db
      .from("x402_operations")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    check(error);
    return data ? normalize(data) : null;
  }
  async find(key: string) {
    const { data, error } = await this.db
      .from("x402_operations")
      .select("*")
      .eq("identity_key", key)
      .maybeSingle();
    check(error);
    return data ? normalize(data) : null;
  }
  async claim(id: string, owner: string) {
    const data = await this.rpc("x402_claim_operation", {
      p_id: id,
      p_owner: owner,
    });
    return data ? normalize(data) : null;
  }
  async patch(id: string, owner: string, patch: Patch) {
    const op = normalize(
      await this.rpc("x402_patch_operation", {
        p_id: id,
        p_owner: owner,
        p_patch: patch,
      }),
    );
    if (patch.state)
      console.info(
        JSON.stringify({
          event: "x402_operation",
          operationId: id,
          direction: op.direction,
          network: op.network,
          state: op.state,
          token: op.token,
          amountAtomic: op.amount_atomic,
          txHash: op.receipt?.transaction ?? null,
          error: op.error,
        }),
      );
    return op;
  }
  async reserve(
    id: string,
    owner: string,
    payment: Payment,
    requirements: PaymentRequirements,
    daily: string,
  ) {
    return normalize(
      await this.rpc("x402_reserve_budget", {
        p_id: id,
        p_owner: owner,
        p_payment: payment,
        p_requirements: requirements,
        p_daily: daily,
      }),
    );
  }
  async recoverable(network: string) {
    const { data, error } = await this.db
      .from("x402_operations")
      .select("*")
      .eq("network", network)
      .or("state.in.(pending,unknown),and(state.eq.settled,phase.neq.complete)")
      .order("updated_at")
      .limit(50);
    check(error);
    return (data ?? []).map(normalize);
  }
  async health() {
    const data = await this.rpc("x402_health", {});
    if (data?.schemaVersion !== 1 || !data?.ready)
      throw new X402Error(
        503,
        "X402_STORAGE_UNAVAILABLE",
        "x402 schema is not ready",
      );
  }
  async prune() {
    await this.rpc("x402_prune_results", {});
  }
}
