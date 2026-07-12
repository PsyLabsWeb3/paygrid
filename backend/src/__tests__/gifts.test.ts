import assert from "node:assert/strict";
import test from "node:test";
import { cleanGiftText, hashGiftSecret, parseStoredGiftAmount } from "../services/gifts.js";

test("gift text removes control characters and normalizes whitespace", () => {
  assert.equal(cleanGiftText("  Happy\n\tbirthday\u0000 Ana  ", 240), "Happy birthday Ana");
});

test("gift claim hashes are deterministic without storing the secret", () => {
  const secret = "correct-horse-battery-staple";
  const hash = hashGiftSecret(secret);
  assert.match(hash, /^0x[a-f0-9]{64}$/);
  assert.equal(hash, hashGiftSecret(secret));
  assert.ok(!hash.includes(secret));
});

test("gift amounts accept numeric values returned by Supabase", () => {
  assert.equal(parseStoredGiftAmount(1, "USDC"), 1_000_000n);
  assert.equal(parseStoredGiftAmount("1.25", "USDm"), 1_250_000_000_000_000_000n);
});
