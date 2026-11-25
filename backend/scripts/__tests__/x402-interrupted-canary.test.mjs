import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
const driver = fileURLToPath(
  new URL("../x402-interrupted-canary.mjs", import.meta.url),
);
async function setup() {
  const folder = await mkdtemp(join(tmpdir(), "paygrid-canary-check-"));
  const evidence = join(folder, "x402-canary-evidence-42220.json");
  const fixture = join(folder, "client.mjs");
  const resource = "https://api.example/api/x402/data";
  await writeFile(
    fixture,
    `
    import {existsSync,readFileSync,writeFileSync} from "node:fs";
    import {randomUUID} from "node:crypto";
    const file=process.env.X402_CANARY_EVIDENCE;
    const entries=existsSync(file)?JSON.parse(readFileSync(file,"utf8")):[{token:"USDC",network:"eip155:42220",resource:"${resource}",idempotencyKey:randomUUID()}];
    writeFileSync(file,JSON.stringify(entries));
    const entry=entries[0];
    const r=await fetch(process.env.X402_CANARY_EXECUTOR_URL+"/api/x402/pay",{
      method:"POST",headers:{"Idempotency-Key":entry.idempotencyKey,"Authorization":"Bearer service-secret"},
      body:JSON.stringify({url:entry.resource,method:"GET",preferredToken:entry.token})
    });
    const result=await r.json();
    if(result.state!=="settled"||!result.paid)throw new Error("Operation still pending");
    Object.assign(entry,{operationId:result.operationId,state:result.state,txHash:result.payment.txHash});
    writeFileSync(file,JSON.stringify(entries));
  `,
  );
  const paid = new Map();
  let requests = 0,
    pending = false,
    changed = false;
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
    }
    requests++;
    const key = req.headers["idempotency-key"];
    if (pending) {
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ state: "unknown", paid: false }));
      return;
    }
    if (!paid.has(key))
      paid.set(key, {
        operationId: "00000000-0000-4000-8000-000000000001",
        state: "settled",
        paid: true,
        payment: {
          network: "eip155:42220",
          token: "USDC",
          txHash: "0x" + "ab".repeat(32),
        },
        hidden: "private-signature-must-not-be-recorded",
      });
    const body = structuredClone(paid.get(key));
    if (changed) body.payment.txHash = "0x" + "cd".repeat(32);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  const run = () =>
    new Promise((resolve) =>
      execFile(
        process.execPath,
        [driver],
        {
          env: {
            ...process.env,
            CHAIN_ID: "42220",
            X402_CANARY_EVIDENCE: evidence,
            X402_CANARY_EXECUTOR_URL: url,
            X402_CANARY_ENTRYPOINT: fixture,
          },
        },
        (error, stdout, stderr) =>
          resolve({ code: error?.code ?? 0, stdout, stderr }),
      ),
    );
  return {
    run,
    evidence,
    counts: () => ({ requests, transfers: paid.size }),
    pending: () => (pending = true),
    changed: () => (changed = true),
    close: async () => {
      await new Promise((r) => server.close(r));
      await rm(folder, { recursive: true, force: true });
    },
  };
}
test("process interruption after settlement resumes the saved intent and never transfers twice", async () => {
  const s = await setup();
  try {
    const first = await s.run();
    assert.equal(first.code, 75);
    assert.match(first.stdout, /intentional_canary_interruption/);
    const before = JSON.parse(await readFile(s.evidence, "utf8"))[0];
    assert.equal(before.operationId, undefined);
    const second = await s.run();
    assert.equal(second.code, 0, second.stderr);
    const after = JSON.parse(await readFile(s.evidence, "utf8"))[0];
    assert.equal(after.idempotencyKey, before.idempotencyKey);
    assert.equal(after.txHash, "0x" + "ab".repeat(32));
    assert.deepEqual(s.counts(), { requests: 2, transfers: 1 });
    assert.equal((await s.run()).code, 0);
    assert.equal(s.counts().transfers, 1);
    const ledger = await readFile(s.evidence + ".interruptions.json", "utf8");
    assert.ok(!ledger.includes("service-secret"));
    assert.ok(!ledger.includes("private-signature"));
    assert.ok(!ledger.includes(before.idempotencyKey));
  } finally {
    await s.close();
  }
});
test("a pending operation is not reported as a confirmed interruption", async () => {
  const s = await setup();
  try {
    s.pending();
    const r = await s.run();
    assert.notEqual(r.code, 75);
    assert.equal(s.counts().transfers, 0);
    const ledger = JSON.parse(
      await readFile(s.evidence + ".interruptions.json", "utf8"),
    );
    assert.equal(ledger["eip155:42220:USDC"].interrupted, undefined);
  } finally {
    await s.close();
  }
});
test("changed receipt or changed intent fails before replacing saved evidence", async () => {
  const s = await setup();
  try {
    assert.equal((await s.run()).code, 75);
    s.changed();
    const mismatch = await s.run();
    assert.notEqual(mismatch.code, 0);
    assert.match(mismatch.stderr, /receipt changed/);
    const entries = JSON.parse(await readFile(s.evidence, "utf8"));
    entries[0].idempotencyKey = "another-intent-key";
    await writeFile(s.evidence, JSON.stringify(entries));
    const changed = await s.run();
    assert.notEqual(changed.code, 0);
    assert.match(changed.stderr, /intent changed/);
    assert.equal(s.counts().requests, 2);
    assert.equal(s.counts().transfers, 1);
  } finally {
    await s.close();
  }
});
