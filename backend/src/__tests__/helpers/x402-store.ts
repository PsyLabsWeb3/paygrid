import { randomUUID } from "node:crypto";
import type {
  Operation,
  Payment,
  Request,
  Store,
  Patch,
} from "../../x402/types.js";
import { X402Error } from "../../x402/types.js";
import type { PaymentRequirements } from "@x402/core/types";
// Deterministic unit-test double. SQL invariants are tested separately against PostgreSQL.
export class MemoryStore implements Store {
  rows = new Map<string, Operation>();
  async create(
    direction: Operation["direction"],
    key: string,
    hash: string,
    request: Request,
    network: string,
  ) {
    const existing = await this.find(key);
    if (existing) {
      if (existing.request_hash !== hash)
        throw new X402Error(409, "IDEMPOTENCY_CONFLICT", "Key reused");
      return structuredClone(existing);
    }
    const op: Operation = {
      id: randomUUID(),
      direction,
      identity_key: key,
      request_hash: hash,
      request,
      network,
      state: "pending",
      phase: "created",
      payer: null,
      asset: null,
      token: null,
      amount_atomic: null,
      requirements: null,
      authorization_key: null,
      authorization_hash: null,
      authorization_expires_at: null,
      ciphertext: null,
      receipt: null,
      result: null,
      result_expires_at: null,
      reserved: false,
      budget_date: null,
      error: null,
      lease_owner: null,
      lease_until: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    // Recheck after the asynchronous lookup, emulating the database unique constraint.
    const raced = [...this.rows.values()].find((r) => r.identity_key === key);
    if (raced) return structuredClone(raced);
    this.rows.set(op.id, op);
    return structuredClone(op);
  }
  async get(id: string) {
    const op = this.rows.get(id);
    return op ? structuredClone(op) : null;
  }
  async find(key: string) {
    const op = [...this.rows.values()].find((r) => r.identity_key === key);
    return op ? structuredClone(op) : null;
  }
  async claim(id: string, owner: string) {
    const op = this.rows.get(id)!;
    if (
      !["pending", "unknown"].includes(op.state) &&
      !(op.state === "settled" && op.phase !== "complete")
    )
      return null;
    if (
      op.lease_owner !== owner &&
      op.lease_until &&
      Date.parse(op.lease_until) > Date.now()
    )
      return null;
    op.lease_owner = owner;
    op.lease_until = new Date(Date.now() + 180_000).toISOString();
    return structuredClone(op);
  }
  async patch(id: string, owner: string, patch: Patch) {
    const op = this.rows.get(id)!;
    if (op.lease_owner !== owner) throw new Error("LEASE_LOST");
    if (
      patch.authorization_key &&
      [...this.rows.values()].some(
        (r) =>
          r.id !== id &&
          r.direction === op.direction &&
          r.authorization_key === patch.authorization_key,
      )
    )
      throw new Error("duplicate authorization");
    if (
      op.direction === "outgoing" &&
      op.state !== "settled" &&
      patch.state === "settled"
    )
      op.budget_date = new Date().toISOString().slice(0, 10);
    Object.assign(op, patch);
    return structuredClone(op);
  }
  async reserve(
    id: string,
    owner: string,
    payment: Payment,
    requirements: PaymentRequirements,
    daily: string,
  ) {
    const op = this.rows.get(id)!;
    if (op.lease_owner !== owner) throw new Error("LEASE_LOST");
    if (op.reserved) return structuredClone(op);
    if (
      [...this.rows.values()].some(
        (r) =>
          r.id !== id &&
          r.direction === "outgoing" &&
          r.payer === payment.payer &&
          r.network === payment.network &&
          r.reserved,
      )
    )
      throw new X402Error(409, "WALLET_BUSY", "Wallet busy");
    const today = new Date().toISOString().slice(0, 10);
    const total = [...this.rows.values()]
      .filter(
        (r) =>
          r.direction === "outgoing" &&
          r.network === payment.network &&
          r.payer === payment.payer &&
          r.asset === payment.asset &&
          (r.reserved || (r.state === "settled" && r.budget_date === today)),
      )
      .reduce((s, r) => s + BigInt(r.amount_atomic ?? "0"), 0n);
    if (total + BigInt(payment.amountAtomic) > BigInt(daily))
      throw new X402Error(409, "BUDGET_EXCEEDED", "Budget exhausted");
    Object.assign(op, {
      payer: payment.payer,
      asset: payment.asset,
      amount_atomic: payment.amountAtomic,
      token: payment.token,
      requirements,
      reserved: true,
      budget_date: today,
      phase: "reserved",
    });
    return structuredClone(op);
  }
  async recoverable(network: string) {
    return [...this.rows.values()]
      .filter((r) => r.network === network)
      .filter(
        (r) =>
          ["pending", "unknown"].includes(r.state) ||
          (r.state === "settled" && r.phase !== "complete"),
      )
      .map((r) => structuredClone(r));
  }
  async health() {}
  async prune() {
    for (const op of this.rows.values())
      if (op.result_expires_at && Date.parse(op.result_expires_at) < Date.now())
        op.result = null;
  }
}
