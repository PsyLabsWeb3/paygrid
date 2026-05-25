import { EventEmitter } from "node:events";

export type PaymentReceivedNotification = {
  linkId: string;
  onChainLinkId: string;
  payer: `0x${string}`;
  txHash: `0x${string}`;
  amount: string;
  token: "USDm" | "USDC" | "USDT";
};

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function onPaymentReceived(
  listener: (payload: PaymentReceivedNotification) => void | Promise<void>,
) {
  const handler = (payload: PaymentReceivedNotification) => {
    void listener(payload);
  };

  emitter.on("paymentReceived", handler);

  return () => {
    emitter.off("paymentReceived", handler);
  };
}

export function notifyPaymentReceived(payload: PaymentReceivedNotification) {
  console.log("[paygrid:notifier] payment received", JSON.stringify(payload));
  emitter.emit("paymentReceived", payload);
}
