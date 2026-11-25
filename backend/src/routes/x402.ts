import { Hono } from "hono";
import {
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { Env } from "../config/env.js";
import { config, REQUEST_LIMIT } from "../x402/config.js";
import { authorized } from "../x402/security.js";
import { getPayments } from "../x402/runtime.js";
import { publicOperation, type Payments } from "../x402/service.js";
import { X402Error } from "../x402/types.js";

export function x402Routes(env: Env, injected?: Payments) {
  const app = new Hono();
  const cfg = injected?.cfg ?? config(env);
  const service = () => injected ?? getPayments(env);
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof X402Error)
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status as 400,
      );
    return c.json(
      {
        error: {
          code: "X402_UNAVAILABLE",
          message: "x402 request could not be completed",
        },
      },
      503,
    );
  });
  const requireExecutor = async (
    c: import("hono").Context,
    next: import("hono").Next,
  ) => {
    if (!authorized(c.req.header("authorization"), cfg.executorKey))
      throw new X402Error(
        401,
        "UNAUTHORIZED",
        "Valid x402 executor credential required",
      );
    await next();
  };
  app.get("/capabilities", async (c) => {
    let ready = false;
    if (cfg.seller || cfg.payer)
      try {
        await service().ready();
        ready = true;
      } catch {}
    return c.json({
      x402Version: 2,
      network: cfg.network,
      ready,
      sellerEnabled: cfg.seller && ready,
      payerEnabled: cfg.payer && ready,
      resource: cfg.publicApiUrl + "/api/x402/data",
      scheme: "exact",
      paymentFlow: "upfront",
      assets:
        cfg.seller || cfg.payer
          ? cfg.assets.map((a) => ({
              token: a.token,
              address: a.address,
              decimals: a.decimals,
              priceAtomic: a.price,
              transferMethod: a.method,
            }))
          : [],
    });
  });
  app.get("/data", async (c) => {
    if (!cfg.seller)
      throw new X402Error(
        503,
        "X402_DISABLED",
        "Incoming x402 payments are disabled",
      );
    if (new URL(c.req.url).search)
      throw new X402Error(
        400,
        "VALIDATION_ERROR",
        "The reference resource does not accept query parameters",
      );
    const payments = service();
    await payments.ready();
    let op;
    try {
      op = await payments.receive(c.req.header("payment-signature"));
    } catch (error) {
      if (error instanceof X402Error && error.status === 402) op = null;
      else throw error;
    }
    if (!op || op.state === "failed") {
      const required = await payments.protocol.requirements();
      c.header("PAYMENT-REQUIRED", encodePaymentRequiredHeader(required));
      return c.json(required, 402);
    }
    if (op.state !== "settled") {
      c.header("Retry-After", "15");
      return c.json({ operationId: op.id, state: op.state }, 503);
    }
    if (op.receipt)
      c.header("PAYMENT-RESPONSE", encodePaymentResponseHeader(op.receipt));
    if (!op.result || Date.parse(op.result_expires_at!) <= Date.now())
      return c.json(
        {
          error: {
            code: "RESULT_EXPIRED",
            message:
              "Result retention expired; this authorization will not be charged again",
          },
        },
        410,
      );
    c.header("Content-Type", op.result.contentType);
    return c.body(op.result.body, 200);
  });
  app.post("/pay", requireExecutor, async (c) => {
    const reader = c.req.raw.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      if (reader)
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > REQUEST_LIMIT)
            throw new X402Error(
              413,
              "REQUEST_TOO_LARGE",
              "Request exceeds 64 KiB",
            );
          chunks.push(next.value);
        }
    } catch (error) {
      await reader?.cancel().catch(() => {});
      throw error;
    } finally {
      reader?.releaseLock();
    }
    let input: unknown;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new X402Error(400, "VALIDATION_ERROR", "Invalid JSON");
    }
    const payments = service();
    await payments.ready();
    const op = await payments.pay(input, c.req.header("idempotency-key") ?? "");
    if (op.state === "pending" || op.state === "unknown")
      c.header("Retry-After", "15");
    return c.json(
      publicOperation(op),
      op.state === "pending" || op.state === "unknown" ? 202 : 200,
    );
  });
  app.get("/payments/:operationId", requireExecutor, async (c) => {
    if (!/^[0-9a-f-]{36}$/i.test(c.req.param("operationId") ?? ""))
      throw new X402Error(400, "VALIDATION_ERROR", "Invalid operation ID");
    const op = await service().store.get(c.req.param("operationId") ?? "");
    if (!op)
      throw new X402Error(404, "NOT_FOUND", "Payment operation not found");
    return c.json(publicOperation(op));
  });
  return app;
}
