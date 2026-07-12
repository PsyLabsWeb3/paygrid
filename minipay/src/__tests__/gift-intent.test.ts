import assert from "node:assert/strict";
import test from "node:test";
import { parseGiftIntent } from "../lib/gift-intent";

test("parses a conversational gift instruction", () => {
  assert.deepEqual(parseGiftIntent("Send Ana $2 for coffee"), {
    recipientAlias: "Ana",
    amount: "2",
    message: "Coffee. Enjoy your gift!",
  });
});

test("requires a recipient and dollar amount", () => {
  assert.equal(parseGiftIntent("Send something nice"), null);
});
