import assert from "node:assert/strict";
import test, { afterEach, beforeEach, mock } from "node:test";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, erc20Abi, parseAbi, parseTransaction, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../app.js";
import type { Env } from "../config/env.js";
import { paygridLinkAbiConst } from "../lib/chain.js";
import { WMXN_ADDRESS } from "../lib/tokens.js";
const base: Env = {
  SUPABASE_URL: "https://wmxn-creation.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  PUBLIC_APP_URL: "https://example.invalid", CELO_RPC_URL: "https://creation-rpc.example.invalid",
  CHAIN_ID: 42220, PORT: 3001, RAMP_ENV: "demo", WMXN_LINKS_ENABLED: "true",
  PAYGRID_LINK_ADDRESS: "0x31Aa9Ba23e4CAC3f41d88fb1C904067c0b3dda89",
  PAYGRID_ROUTER_ADDRESS: "0x8d290c97100f0e87e04Efd1a790F27004fA3f08B",
  BACKEND_WALLET_PRIVATE_KEY: `0x${"1".repeat(64)}`, RIPIO_WMXN_ADDRESS: WMXN_ADDRESS,
};
const creator = privateKeyToAccount(base.BACKEND_WALLET_PRIVATE_KEY).address;
const recipient = "0x1111111111111111111111111111111111111111";
const id = "33333333-3333-4333-8333-333333333333";
const hash = `0x${"a".repeat(64)}`;
const input = { amount: "9.230000000000000001", token: "wMXN", recipientAddress: recipient, acceptedMethods: ["crypto"] };
const readinessAbi = parseAbi(["function router() view returns (address)", "function paygridLink() view returns (address)", "function supportedTokens(address) view returns (bool)"]);
let stored: Record<string, unknown> | undefined;
let signedTransactions: number, storageReady: boolean, supported: boolean, activeRouter: Hex, tokenDecimals: number;
let calls: string[];
beforeEach(() => {
  stored = undefined; signedTransactions = 0; storageReady = true; supported = true;
  activeRouter = base.PAYGRID_ROUTER_ADDRESS; tokenDecimals = 18; calls = [];
  // All RPC and database traffic stays in this fixture; no network or real funds.
  mock.method(globalThis, "fetch", async (urlInput: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(urlInput, init), url = new URL(request.url);
    if (url.origin === base.SUPABASE_URL) {
      if (url.pathname === "/rest/v1/payments") return Response.json([]);
      assert.equal(url.pathname, "/rest/v1/payment_links");
      if (request.method === "POST") {
        stored = await request.json();
        return Response.json({ ...stored, id, created_at: new Date().toISOString() }, { status: 201 });
      }
      if (url.searchParams.has("id")) return Response.json([{ ...stored, id }]);
      assert.equal(url.searchParams.get("limit"), "0");
      return storageReady ? Response.json([]) : Response.json({ code: "42703", message: "column does not exist" }, { status: 400 });
    }
    assert.equal(request.url, `${base.CELO_RPC_URL}/`);
    const body = await request.json(); calls.push(body.method);
    let result: unknown;
    switch (body.method) {
      case "eth_chainId": result = "0xa4ec"; break;
      case "eth_getTransactionCount": result = "0x0"; break;
      case "eth_gasPrice": case "eth_maxPriorityFeePerGas": result = "0x3b9aca00"; break;
      case "eth_estimateGas": result = "0x493e0"; break;
      case "eth_getBlockByNumber": result = { hash, number: "0x10", baseFeePerGas: "0x3b9aca00", timestamp: "0x1", transactions: [], gasLimit: "0x1c9c380", gasUsed: "0x0" }; break;
      case "eth_call": {
        const to = body.params[0].to.toLowerCase(), data = body.params[0].data as Hex;
        if (to === WMXN_ADDRESS.toLowerCase()) result = encodeFunctionResult({ abi: erc20Abi, functionName: "decimals", result: tokenDecimals });
        else if (to === base.PAYGRID_LINK_ADDRESS.toLowerCase() && decodeFunctionData({ abi: [...readinessAbi, ...paygridLinkAbiConst], data }).functionName === "createLink") {
          assert.deepEqual(decodeFunctionData({ abi: paygridLinkAbiConst, data }).args, [recipient, 9230000000000000001n, WMXN_ADDRESS, "", false, 0n]);
          result = encodeFunctionResult({ abi: paygridLinkAbiConst, functionName: "createLink", result: 84n });
        } else {
          const name = decodeFunctionData({ abi: readinessAbi, data }).functionName;
          if (name === "router") result = encodeFunctionResult({ abi: readinessAbi, functionName: name, result: activeRouter });
          else if (name === "paygridLink") result = encodeFunctionResult({ abi: readinessAbi, functionName: name, result: base.PAYGRID_LINK_ADDRESS });
          else result = encodeFunctionResult({ abi: readinessAbi, functionName: "supportedTokens", result: supported });
        }
        break;
      }
      case "eth_sendRawTransaction": {
        const tx = parseTransaction(body.params[0]);
        assert.equal(tx.to?.toLowerCase(), base.PAYGRID_LINK_ADDRESS.toLowerCase());
        assert.equal(tx.chainId, 42220);
        const decoded = decodeFunctionData({ abi: paygridLinkAbiConst, data: tx.data! });
        assert.equal(decoded.functionName, "createLink");
        assert.deepEqual(decoded.args, [recipient, 9230000000000000001n, WMXN_ADDRESS, "", false, 0n]);
        signedTransactions++; result = hash; break;
      }
      case "eth_getTransactionReceipt": result = {
        transactionHash: hash, transactionIndex: "0x0", blockHash: hash, blockNumber: "0x10", from: creator,
        to: base.PAYGRID_LINK_ADDRESS, cumulativeGasUsed: "0x493e0", gasUsed: "0x493e0", contractAddress: null,
        effectiveGasPrice: "0x3b9aca00", status: "0x1", type: "0x2", logsBloom: `0x${"0".repeat(512)}`,
        logs: [{ address: base.PAYGRID_LINK_ADDRESS, blockHash: hash, blockNumber: "0x10", transactionHash: hash,
          transactionIndex: "0x0", logIndex: "0x0", removed: false,
          topics: encodeEventTopics({ abi: paygridLinkAbiConst, eventName: "LinkCreated", args: { linkId: 84n, creator, recipient } }),
          data: encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "bool" }], [9230000000000000001n, WMXN_ADDRESS, false]),
        }],
      }; break;
      default: assert.fail(`Unexpected RPC ${body.method}`);
    }
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  });
});
afterEach(() => mock.restoreAll());
function create(overrides: Partial<typeof input> = {}, env: Partial<Env> = {}) {
  return createApp({ ...base, ...env }).request("http://localhost/api/links/minipay", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, ...overrides }),
  });
}
test("create and retrieve wMXN preserve the exact on-chain, stored and displayed amount", async () => {
  const response = await create(), body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(signedTransactions, 1);
  assert.equal(body.amount, input.amount);
  assert.equal(body.amountAtomic, "9230000000000000001");
  assert.equal(stored?.amount_atomic, body.amountAtomic);
  assert.deepEqual(stored?.accepted_payer_assets, ["wMXN"]);
  const detail = await createApp(base).request(`http://localhost/api/links/${id}`), link = await detail.json();
  assert.equal(detail.status, 200);
  assert.equal(link.amount, input.amount);
  assert.equal(link.amountAtomic, body.amountAtomic);
  assert.equal(link.tokenAddress, WMXN_ADDRESS);
  assert.equal(link.chainId, 42220);
});
test("disabled and non-mainnet wMXN creation fail before RPC and signatures", async () => {
  for (const env of [{ WMXN_LINKS_ENABLED: "false" as const }, { CHAIN_ID: 11142220 }, { RIPIO_WMXN_ADDRESS: undefined }]) assert.equal((await create({}, env)).status, 403);
  assert.deepEqual(calls, []); assert.equal(signedTransactions, 0);
});
test("missing storage, unsupported token and wrong router bindings fail before signing", async () => {
  storageReady = false; assert.equal((await create()).status, 403);
  storageReady = true; supported = false; assert.equal((await create()).status, 403);
  supported = true; activeRouter = `0x${"0".repeat(40)}`; assert.equal((await create()).status, 403);
  activeRouter = base.PAYGRID_ROUTER_ADDRESS; tokenDecimals = 6; assert.equal((await create()).status, 403);
  assert.equal(signedTransactions, 0); assert.equal(stored, undefined);
});
test("wMXN rejects fiat, zero and imprecise amounts without signing", async () => {
  for (const acceptedMethods of [["card"], ["crypto", "fonbnk"]]) assert.equal((await create({ acceptedMethods })).status, 400);
  for (const amount of ["0", "1.0000000000000000001", "1e2", "1000000000000000000"]) assert.equal((await create({ amount })).status, 400);
  assert.deepEqual(calls, []); assert.equal(signedTransactions, 0);
});
test("public config reports readiness without requiring a wallet", async () => {
  const response = await createApp({ ...base, WMXN_LINKS_ENABLED: "false" }).request("http://localhost/api/links/config");
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual((await response.json()).tokens, ["USDC", "USDT", "USDm"]);
  const ready = await createApp(base).request("http://localhost/api/links/config");
  assert.deepEqual((await ready.json()).tokens, ["USDC", "USDT", "USDm", "wMXN"]);
  assert.equal(signedTransactions, 0);
});
