import postgres from "postgres";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const url = new URL(process.env.X402_TEST_DATABASE_URL ?? "http://invalid");
assert.ok(
  ["postgres:", "postgresql:"].includes(url.protocol),
  "X402_TEST_DATABASE_URL is required",
);
assert.ok(
  ["127.0.0.1", "localhost"].includes(url.hostname),
  "Only an isolated loopback test database is allowed",
);
assert.equal(
  url.pathname,
  "/paygrid_x402_test",
  "Never run this against an application database",
);
const sql = postgres(url.href, { max: 4, onnotice: () => {} });
try {
  assert.equal(
    (await sql`select current_database() as db`)[0].db,
    "paygrid_x402_test",
  );
  await sql.unsafe(
    "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;",
  );
  await sql.unsafe(
    readFileSync(
      new URL(
        "../supabase/migrations/20261124000016_x402_payments.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const request = sql.json({
    url: "https://api.celopaygrid.xyz/api/x402/data",
    method: "GET",
  });
  const network = "eip155:42220",
    payer = "0x" + "1".repeat(40),
    asset = "0x" + "2".repeat(40);
  const amount = "100000000000000000001",
    daily = "150000000000000000001";
  const payment = sql.json({
    network,
    payer,
    asset,
    token: "wMXN",
    amountAtomic: amount,
  });
  const a = (
    await sql`select x402_create_operation('outgoing','race-a','a',${request},${network}) as op`
  )[0].op;
  const b = (
    await sql`select x402_create_operation('outgoing','race-b','b',${request},${network}) as op`
  )[0].op;
  const ownerA = randomUUID(),
    ownerB = randomUUID();
  await sql`select x402_claim_operation(${a.id},${ownerA})`;
  await sql`select x402_claim_operation(${b.id},${ownerB})`;
  let releaseStarted;
  const started = new Promise((resolve) => {
    releaseStarted = resolve;
  });
  const first = sql.begin(async (tx) => {
    const reserved = (
      await tx`select x402_reserve_budget(${a.id},${ownerA},${payment},'{}',${daily}) as op`
    )[0].op;
    releaseStarted();
    await tx`select pg_sleep(0.25)`;
    return reserved;
  });
  void first.catch(() => releaseStarted());
  await started;
  const second = sql`select x402_reserve_budget(${b.id},${ownerB},${payment},'{}',${daily}) as op`;
  const results = await Promise.allSettled([first, second]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[0].value.amount_atomic, amount);
  assert.equal(results[1].status, "rejected");
  assert.match(results[1].reason.message, /WALLET_BUSY/);
  await sql`select x402_patch_operation(${a.id},${ownerA},${sql.json({ state: "settled", phase: "complete", reserved: false })})`;
  await assert.rejects(
    () =>
      sql`select x402_reserve_budget(${b.id},${ownerB},${payment},'{}',${daily})`,
    /BUDGET_EXCEEDED/,
  );
  assert.equal(
    (
      await sql`select count(*)::integer as n from x402_operations where state='settled'`
    )[0].n,
    1,
  );
  await assert.rejects(
    () =>
      sql.begin(async (tx) => {
        await tx`set local role anon`;
        await tx`select * from x402_operations`;
      }),
    /permission denied/,
  );
  console.log(
    JSON.stringify({
      database: "isolated PostgreSQL 16",
      simultaneousConnections: true,
      walletLock: true,
      exactAtomicAmounts: true,
      dailyBudget: true,
      rls: true,
    }),
  );
} finally {
  await sql.end();
}
