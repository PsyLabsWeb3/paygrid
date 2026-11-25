import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20261124000016_x402_payments.sql",
    import.meta.url,
  ),
  "utf8",
);
test("PostgreSQL migration enforces precision, leases, replay and concurrent wallet budgets", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;",
    );
    await db.exec(migration);
    const rpc = async (name: string, args: unknown[]) => {
      const values = args.map((a) =>
        a !== null && typeof a === "object" ? JSON.stringify(a) : a,
      );
      const result = await db.query<{ op: any }>(
        `SELECT public.${name}(${values.map((_, i) => "$" + (i + 1)).join(",")}) AS op`,
        values,
      );
      return result.rows[0].op;
    };
    const request = {
      url: "https://api.celopaygrid.xyz/api/x402/data",
      method: "GET",
    };
    const network = "eip155:42220",
      payer = "0x" + "1".repeat(40),
      asset = "0x" + "2".repeat(40);
    const owner = randomUUID(),
      owner2 = randomUUID();
    const op = await rpc("x402_create_operation", [
      "outgoing",
      "unique-operation",
      "request-hash",
      request,
      network,
    ]);
    assert.equal(
      (
        await rpc("x402_create_operation", [
          "outgoing",
          "unique-operation",
          "request-hash",
          request,
          network,
        ])
      ).id,
      op.id,
    );
    await assert.rejects(
      () =>
        rpc("x402_create_operation", [
          "outgoing",
          "unique-operation",
          "other-hash",
          request,
          network,
        ]),
      /IDEMPOTENCY_CONFLICT/,
    );
    await rpc("x402_claim_operation", [op.id, owner]);
    assert.equal(await rpc("x402_claim_operation", [op.id, owner2]), null);
    const amount = "100000000000000000001",
      daily = "200000000000000000002";
    const payment = {
      network,
      payer,
      asset,
      token: "wMXN",
      amountAtomic: amount,
      payTo: asset,
    };
    const reserved = await rpc("x402_reserve_budget", [
      op.id,
      owner,
      payment,
      {},
      daily,
    ]);
    assert.equal(reserved.amount_atomic, amount);
    const second = await rpc("x402_create_operation", [
      "outgoing",
      "second-operation",
      "hash",
      request,
      network,
    ]);
    await rpc("x402_claim_operation", [second.id, owner2]);
    const concurrent = await Promise.allSettled([
      rpc("x402_reserve_budget", [second.id, owner2, payment, {}, daily]),
      rpc("x402_patch_operation", [
        op.id,
        owner,
        { phase: "signed", authorization_key: "single-auth" },
      ]),
    ]);
    assert.equal(concurrent[0].status, "rejected");
    await rpc("x402_patch_operation", [
      op.id,
      owner,
      {
        state: "settled",
        phase: "complete",
        reserved: false,
        receipt: { success: true, transaction: "0x" + "a".repeat(64) },
      },
    ]);
    assert.equal(
      await rpc("x402_claim_operation", [op.id, owner2]),
      null,
      "A stale retry must never reclaim a completed operation",
    );
    await rpc("x402_reserve_budget", [second.id, owner2, payment, {}, daily]);
    await assert.rejects(
      () =>
        rpc("x402_patch_operation", [
          second.id,
          owner2,
          { authorization_key: "single-auth" },
        ]),
      /unique constraint/,
    );
    await assert.rejects(
      () =>
        rpc("x402_patch_operation", [
          second.id,
          owner2,
          { receipt: { success: true, transaction: "0x" + "a".repeat(64) } },
        ]),
      /unique constraint/,
      "A transaction cannot settle a second operation",
    );
    await rpc("x402_patch_operation", [
      second.id,
      owner2,
      { state: "settled", phase: "complete", reserved: false },
    ]);
    const third = await rpc("x402_create_operation", [
      "outgoing",
      "third-operation",
      "hash",
      request,
      network,
    ]);
    await rpc("x402_claim_operation", [third.id, owner]);
    await assert.rejects(
      () => rpc("x402_reserve_budget", [third.id, owner, payment, {}, daily]),
      /BUDGET_EXCEEDED/,
    );
    const permissions = await db.query<{ allowed: boolean }>(
      "SELECT has_table_privilege('anon','public.x402_operations','SELECT') AS allowed",
    );
    assert.equal(permissions.rows[0].allowed, false);
    const fn = await db.query<{ allowed: boolean }>(
      "SELECT has_function_privilege('authenticated','public.x402_reserve_budget(uuid,uuid,jsonb,jsonb,text)','EXECUTE') AS allowed",
    );
    assert.equal(fn.rows[0].allowed, false);
    await rpc("x402_patch_operation", [
      third.id,
      owner,
      { result: { body: "cached" }, result_expires_at: "2000-01-01T00:00:00Z" },
    ]);
    await rpc("x402_prune_results", []);
    const pruned = await db.query<{
      result: unknown;
      authorization_key: string;
    }>("SELECT result,authorization_key FROM x402_operations WHERE id=$1", [
      third.id,
    ]);
    assert.equal(pruned.rows[0].result, null);
  } finally {
    await db.close();
  }
});
