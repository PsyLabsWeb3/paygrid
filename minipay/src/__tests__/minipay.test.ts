import assert from "node:assert/strict";
import test from "node:test";
import { getAccountHint, isMiniPayEnvironment } from "../lib/minipay";

test("isMiniPayEnvironment is false without a browser provider", () => {
  assert.equal(isMiniPayEnvironment(), false);
});

test("getAccountHint does not expose raw account text by default", () => {
  assert.equal(
    getAccountHint("0x1111111111111111111111111111111111111111"),
    "Connected account",
  );
});
