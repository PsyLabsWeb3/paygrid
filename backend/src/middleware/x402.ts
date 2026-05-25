import type { Context, Next } from "hono";
import type { Env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";

export type X402Proof = {
  resource: string;
  chainId: number;
  token: "USDC" | "USDT" | "USDm";
  amount: string;
  txHash: `0x${string}`;
  payer: `0x${string}`;
  paidAt?: string;
};

const requiredProofShape = {
  resource: true,
  chainId: true,
  token: true,
  amount: true,
  txHash: true,
  payer: true,
} as const;

function parseProof(raw: string | null | undefined) {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as Partial<X402Proof>;
  } catch {
    return null;
  }
}

export function challengeResponse(env: Env, resource: string) {
  return {
    error: {
      code: "PAYMENT_REQUIRED",
      message: "Payment required to access this resource.",
      details: {
        resource,
        chainId: env.CHAIN_ID,
        token: "USDC",
        amount: "0.10",
        recipient: env.PAYGRID_TREASURY_ADDRESS ?? null,
        proofHeader: "x-paygrid-x402-proof",
      },
    },
  };
}

export function createX402Middleware(env: Env) {
  return async (c: Context, next: Next) => {
    const proof = parseProof(c.req.header("x-paygrid-x402-proof"));
    if (!proof) {
      throw new ApiError(402, "PAYMENT_REQUIRED", "Payment required", {
        challenge: challengeResponse(env, c.req.path),
      });
    }

    for (const key of Object.keys(requiredProofShape) as (keyof X402Proof)[]) {
      if (!(key in proof) || proof[key] == null) {
        throw new ApiError(400, "VALIDATION_ERROR", `Missing x402 proof field: ${key}`);
      }
    }

    if (proof.resource !== c.req.path) {
      throw new ApiError(403, "FORBIDDEN", "x402 proof resource mismatch");
    }
    if (proof.chainId !== env.CHAIN_ID) {
      throw new ApiError(403, "FORBIDDEN", "x402 proof chain mismatch");
    }
    if (proof.token !== "USDC") {
      throw new ApiError(403, "FORBIDDEN", "x402 example requires USDC");
    }
    if (proof.amount !== "0.10") {
      throw new ApiError(403, "FORBIDDEN", "x402 example requires a 0.10 USDC payment");
    }

    c.set("x402Proof", proof as X402Proof);
    await next();
  };
}

export function getX402Proof(c: Context) {
  return c.get("x402Proof" as never) as X402Proof | null | undefined;
}
