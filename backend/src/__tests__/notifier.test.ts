import assert from "node:assert/strict";
import test from "node:test";
import type { PaymentReceivedNotification } from "../services/notifier.js";
import { notifyPaymentReceived, onPaymentReceived } from "../services/notifier.js";

test("notifyPaymentReceived emits the internal hook", () => {
  const payload: PaymentReceivedNotification = {
    linkId: "link-1",
    onChainLinkId: "42",
    payer: "0x1111111111111111111111111111111111111111",
    txHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
    amount: "12.5",
    token: "USDC",
  };

  const received: PaymentReceivedNotification[] = [];
  const originalLog = console.log;
  console.log = () => {};
  const unsubscribe = onPaymentReceived((event) => {
    received.push(event);
  });

  try {
    notifyPaymentReceived(payload);
  } finally {
    unsubscribe();
    console.log = originalLog;
  }

  assert.deepEqual(received, [payload]);
});
