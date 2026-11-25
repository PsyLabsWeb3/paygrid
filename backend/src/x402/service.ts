import { randomUUID } from "node:crypto";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  decodePaymentSignatureHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import {
  validatePaymentPayload,
  validatePaymentRequired,
} from "@x402/core/schemas";
import { appendPaymentIdentifierToExtensions } from "@x402/extensions/payment-identifier";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { Config } from "./config.js";
import {
  X402Error,
  type Operation,
  type Protocol,
  type Request,
  type Store,
  type Transport,
  type Result,
} from "./types.js";
import {
  authorization,
  decrypt,
  digest,
  encrypt,
  merchantFor,
  readResult,
  sameTerms,
  select,
  validateRequest,
  redactResult,
} from "./security.js";

const endLease = () => new Date(0).toISOString();
const expiresResult = () => new Date(Date.now() + 86400_000).toISOString();
export function publicOperation(op: Operation) {
  return {
    operationId: op.id,
    state: op.state,
    paid: op.state === "settled" && !!op.receipt?.success,
    payment: op.asset
      ? {
          network: op.network,
          asset: op.asset,
          token: op.token,
          amountAtomic: op.amount_atomic,
          payer: op.payer,
          payTo: op.requirements?.payTo,
          txHash: op.receipt?.transaction,
        }
      : null,
    result:
      op.result_expires_at && Date.parse(op.result_expires_at) > Date.now()
        ? op.result
        : null,
    resultExpired:
      !!op.result_expires_at && Date.parse(op.result_expires_at) <= Date.now(),
    error: op.error,
  };
}
export class Payments {
  constructor(
    readonly cfg: Config,
    readonly store: Store,
    readonly protocol: Protocol,
    readonly transport: Transport,
  ) {}
  private readiness?: { at: number; promise: Promise<void> };
  async ready() {
    if (!this.readiness || Date.now() - this.readiness.at > 60_000) {
      const promise = (async () => {
        await this.protocol.preflight();
        await this.store.health();
      })();
      this.readiness = { at: Date.now(), promise };
      promise.catch(() => {
        this.readiness = undefined;
      });
    }
    await this.readiness.promise;
  }
  private async fail(op: Operation, owner: string, error: unknown) {
    if (op.direction === "outgoing" && op.receipt)
      return this.store.patch(op.id, owner, {
        state: "settled",
        reserved: false,
        phase: "submitted",
        error: "RESOURCE_DELIVERY_PENDING",
        lease_until: endLease(),
      });
    const signed = !!op.ciphertext;
    return this.store.patch(op.id, owner, {
      state: signed ? "unknown" : "failed",
      reserved: signed && op.reserved,
      error:
        error instanceof X402Error ? error.code : "X402_OPERATION_UNCERTAIN",
      lease_until: endLease(),
    });
  }
  async pay(input: unknown, key: string): Promise<Operation> {
    if (!this.cfg.payer)
      throw new X402Error(
        503,
        "X402_DISABLED",
        "Outgoing x402 payments are disabled",
      );
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key))
      throw new X402Error(
        400,
        "VALIDATION_ERROR",
        "Idempotency-Key must contain 16–128 letters, digits, hyphens or underscores",
      );
    const request = validateRequest(input);
    merchantFor(this.cfg, request);
    const op = await this.store.create(
      "outgoing",
      `out:${this.cfg.network}:${key}`,
      digest(request),
      request,
      this.cfg.network,
    );
    if (op.state !== "pending" || op.phase !== "created") return op;
    return this.runOutgoing(op);
  }
  private async runOutgoing(original: Operation): Promise<Operation> {
    const owner = randomUUID();
    let op = await this.store.claim(original.id, owner);
    if (!op) return (await this.store.get(original.id))!;
    try {
      if (op.ciphertext) return await this.deliver(op, owner);
      if (op.phase !== "created")
        return await this.fail(
          op,
          owner,
          new X402Error(
            409,
            "INTERRUPTED_BEFORE_SIGNING",
            "Previous operation did not finish signing",
          ),
        );
      const first = await this.transport.send(op.request);
      if (first.status !== 402) {
        const result = await readResult(first);
        return this.store.patch(op.id, owner, {
          state: first.ok ? "settled" : "failed",
          phase: "complete",
          result,
          result_expires_at: expiresResult(),
          lease_until: endLease(),
        });
      }
      const header = first.headers.get("payment-required");
      await first.body?.cancel();
      if (!header || header.length > 64 * 1024)
        throw new X402Error(
          402,
          "INVALID_CHALLENGE",
          "Missing or oversized PAYMENT-REQUIRED",
        );
      const parsed = validatePaymentRequired(
        decodePaymentRequiredHeader(header),
      );
      if (parsed.x402Version !== 2)
        throw new X402Error(403, "POLICY_DENIED", "Only x402 v2 is supported");
      if (parsed.resource && parsed.resource.url !== op.request.url)
        throw new X402Error(
          403,
          "POLICY_DENIED",
          "Payment resource URL mismatch",
        );
      const required = parsed as import("@x402/core/types").PaymentRequired;
      let candidates = required.accepts;
      let requirement: PaymentRequirements;
      for (;;) {
        const choice = select(this.cfg, op.request, candidates);
        requirement = choice.requirement;
        try {
          op = await this.store.reserve(
            op.id,
            owner,
            {
              network: this.cfg.network,
              asset: choice.asset.address,
              token: choice.asset.token,
              amountAtomic: requirement.amount,
              payer: this.cfg.payerAddress!,
              payTo: requirement.payTo,
            },
            requirement,
            choice.asset.daily,
          );
          break;
        } catch (error) {
          if (
            !(error instanceof X402Error) ||
            error.code !== "BUDGET_EXCEEDED" ||
            op.request.preferredToken
          )
            throw error;
          candidates = candidates.filter(
            (r) => r.asset.toLowerCase() !== choice.asset.address.toLowerCase(),
          );
          if (!candidates.length) throw error;
        }
      }
      // This reservation is durable and wallet-exclusive before any signature is created.
      select(this.cfg, op.request, [requirement]);
      const extensions = { ...(required.extensions ?? {}) };
      if (extensions["payment-identifier"])
        appendPaymentIdentifierToExtensions(extensions, op.id);
      const payload = await this.protocol.sign(
        { ...required, extensions },
        requirement,
      );
      const auth = authorization(payload);
      op = await this.store.patch(op.id, owner, {
        phase: "signed",
        ciphertext: encrypt(payload, this.cfg.encryptionKey!),
        authorization_key: auth.key,
        authorization_hash: auth.hash,
        authorization_expires_at: new Date(auth.expiry * 1000).toISOString(),
      });
      return await this.deliver(op, owner);
    } catch (error) {
      const failed = await this.fail(op, owner, error);
      if (error instanceof X402Error && !op.ciphertext) throw error;
      return failed;
    }
  }
  private async deliver(start: Operation, owner: string): Promise<Operation> {
    let op = start;
    const payload = decrypt<PaymentPayload>(
      op.ciphertext!,
      this.cfg.encryptionKey!,
    );
    // Never re-sign on recovery. The exact same authorization is the retry unit.
    if (await this.protocol.expiredUnused(payload, op.requirements!))
      return this.store.patch(op.id, owner, {
        state: "failed",
        reserved: false,
        error: "AUTHORIZATION_EXPIRED_UNUSED",
        lease_until: endLease(),
      });
    select(this.cfg, op.request, [op.requirements!]);
    op = await this.store.patch(op.id, owner, { phase: "submitted" });
    const response = await this.transport.send(op.request, {
      "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload),
      "Idempotency-Key": op.id,
    });
    const receiptHeader = response.headers.get("payment-response");
    if (receiptHeader || op.receipt) {
      const receipt = receiptHeader
        ? decodePaymentResponseHeader(receiptHeader)
        : op.receipt!;
      await this.protocol.confirm(
        receipt,
        op.requirements!,
        op.payer!,
        payload,
      );
      op = await this.store.patch(op.id, owner, {
        receipt,
        state: "settled",
        reserved: false,
        result_expires_at: op.result_expires_at ?? expiresResult(),
        error: "RESOURCE_DELIVERY_PENDING",
      });
      try {
        const result = redactResult(await readResult(response), payload);
        return this.store.patch(op.id, owner, {
          state: "settled",
          phase: "complete",
          reserved: false,
          result,
          error: response.ok ? null : "RESOURCE_DELIVERY_FAILED",
          lease_until: endLease(),
        });
      } catch (error) {
        return this.store.patch(op.id, owner, {
          state: "settled",
          reserved: false,
          phase:
            error instanceof X402Error && error.code === "RESPONSE_TOO_LARGE"
              ? "complete"
              : "submitted",
          error:
            error instanceof X402Error
              ? error.code
              : "RESOURCE_DELIVERY_PENDING",
          lease_until: endLease(),
        });
      }
    }
    if (response.status === 402) {
      const challenge = response.headers.get("payment-required");
      await response.body?.cancel();
      if (challenge) {
        const required = validatePaymentRequired(
          decodePaymentRequiredHeader(challenge),
        );
        if (
          required.x402Version !== 2 ||
          !required.accepts.some((r) =>
            sameTerms(r as PaymentRequirements, op.requirements!),
          )
        )
          throw new X402Error(
            403,
            "PAYMENT_TERMS_CHANGED",
            "Payment terms changed; no new signature was created",
          );
      }
    } else await response.body?.cancel();
    throw new X402Error(
      503,
      "SETTLEMENT_UNCONFIRMED",
      "Payment outcome requires reconciliation",
    );
  }
  async receive(header: string | undefined): Promise<Operation | null> {
    if (!this.cfg.seller)
      throw new X402Error(
        503,
        "X402_DISABLED",
        "Incoming x402 payments are disabled",
      );
    if (!header) return null;
    if (header.length > 64 * 1024)
      throw new X402Error(
        400,
        "INVALID_PAYMENT",
        "Oversized payment signature",
      );
    let parsed: ReturnType<typeof validatePaymentPayload>;
    try {
      parsed = validatePaymentPayload(decodePaymentSignatureHeader(header));
    } catch {
      throw new X402Error(
        402,
        "INVALID_PAYMENT",
        "Malformed payment signature",
      );
    }
    if (parsed.x402Version !== 2)
      throw new X402Error(402, "INVALID_PAYMENT", "Only x402 v2 is supported");
    const payload = parsed as PaymentPayload;
    const url = this.cfg.publicApiUrl + "/api/x402/data";
    if (payload.resource?.url !== url)
      throw new X402Error(402, "INVALID_PAYMENT", "Payment resource mismatch");
    const auth = authorization(payload),
      request: Request = { url, method: "GET" };
    const hash = digest({ request, requirements: payload.accepted });
    const existing = await this.store.find("in:" + auth.key);
    if (existing) {
      if (
        existing.request_hash !== hash ||
        existing.authorization_hash !== auth.hash
      )
        throw new X402Error(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Authorization is bound to another request",
        );
      return existing;
    }
    const required = await this.protocol.requirements();
    const requirement = required.accepts.find((r) =>
      sameTerms(r, payload.accepted),
    );
    if (!requirement || auth.expiry <= Date.now() / 1000)
      throw new X402Error(
        402,
        "INVALID_PAYMENT",
        "Payment terms or expiry do not match",
      );
    // Invalid signatures cannot poison the permanent authorization deduplication record.
    await this.protocol.verify(payload, requirement);
    let op = await this.store.create(
      "incoming",
      "in:" + auth.key,
      hash,
      request,
      this.cfg.network,
    );
    const owner = randomUUID(),
      claimed = await this.store.claim(op.id, owner);
    if (!claimed) return (await this.store.get(op.id))!;
    op = claimed;
    if (op.ciphertext || op.state !== "pending") return op;
    const asset = this.cfg.assets.find(
      (a) => a.address.toLowerCase() === requirement.asset.toLowerCase(),
    )!;
    try {
      op = await this.store.patch(op.id, owner, {
        phase: "signed",
        ciphertext: encrypt(payload, this.cfg.encryptionKey!),
        requirements: requirement,
        payer: auth.payer,
        asset: requirement.asset,
        token: asset.token,
        amount_atomic: requirement.amount,
        authorization_key: auth.key,
        authorization_hash: auth.hash,
        authorization_expires_at: new Date(auth.expiry * 1000).toISOString(),
      });
      return await this.settleIncoming(op, owner);
    } catch (error) {
      return this.fail(op, owner, error);
    }
  }
  private async settleIncoming(start: Operation, owner: string) {
    let op = start;
    const payload = decrypt<PaymentPayload>(
      op.ciphertext!,
      this.cfg.encryptionKey!,
    );
    if (await this.protocol.expiredUnused(payload, op.requirements!))
      return this.store.patch(op.id, owner, {
        state: "failed",
        error: "AUTHORIZATION_EXPIRED_UNUSED",
        lease_until: endLease(),
      });
    op = await this.store.patch(op.id, owner, { phase: "submitted" });
    const receipt =
      op.receipt ?? (await this.protocol.settle(payload, op.requirements!));
    if (!receipt.success)
      throw new X402Error(
        503,
        "SETTLEMENT_UNCONFIRMED",
        "Facilitator did not confirm settlement",
      );
    // Save the receipt before further RPC reads, so restarts can finish delivery.
    op = await this.store.patch(op.id, owner, { receipt });
    await this.protocol.confirm(receipt, op.requirements!, op.payer!, payload);
    const result: Result = {
      httpStatus: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        resource: "/api/x402/data",
        message: "x402 payment accepted",
        payment: {
          network: op.network,
          asset: op.asset,
          amountAtomic: op.amount_atomic,
          payer: op.payer,
          payTo: op.requirements!.payTo,
          txHash: receipt.transaction,
        },
      }),
    };
    return this.store.patch(op.id, owner, {
      state: "settled",
      phase: "complete",
      result,
      result_expires_at: expiresResult(),
      error: null,
      lease_until: endLease(),
    });
  }
  async reconcile() {
    for (const entry of await this.store.recoverable(this.cfg.network)) {
      const owner = randomUUID();
      const op = await this.store.claim(entry.id, owner);
      if (!op) continue;
      try {
        if (
          op.state === "settled" &&
          op.result_expires_at &&
          Date.parse(op.result_expires_at) <= Date.now()
        ) {
          await this.store.patch(op.id, owner, {
            phase: "complete",
            reserved: false,
            error: "RESULT_EXPIRED",
            lease_until: endLease(),
          });
        } else if (!op.ciphertext) {
          if (Date.now() - Date.parse(op.created_at) > 180_000)
            await this.fail(
              op,
              owner,
              new X402Error(
                409,
                "INTERRUPTED_BEFORE_SIGNING",
                "Operation interrupted before signing",
              ),
            );
          else
            await this.store.patch(op.id, owner, { lease_until: endLease() });
        } else if (op.direction === "incoming")
          await this.settleIncoming(op, owner);
        else await this.deliver(op, owner);
      } catch (error) {
        await this.fail(op, owner, error);
      }
    }
    await this.store.prune();
  }
}
