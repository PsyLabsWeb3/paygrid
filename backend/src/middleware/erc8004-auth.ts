import { createHash } from "node:crypto";
import type { Context, Next } from "hono";
import { verifyMessage } from "viem";
import type { Env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";
import { getOrCreateAgent } from "../services/agents.js";
import type { AgentRow } from "../db/supabase.js";

export type AuthenticatedAgent = {
  agentId: string;
  address: `0x${string}`;
  nonce: string;
  timestamp: number;
  signature: `0x${string}`;
  agent: AgentRow;
};

type ResolveAgent = typeof getOrCreateAgent;

type Options = {
  required: boolean;
  resolveAgent?: ResolveAgent;
};

function getHeader(c: Context, name: string) {
  return c.req.header(name) ?? c.req.header(name.toLowerCase()) ?? null;
}

function getSignedMessage(input: {
  agentId: string;
  address: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
}) {
  return [
    "paygrid:erc8004",
    input.agentId,
    input.address.toLowerCase(),
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
  ].join(":");
}

function isFreshTimestamp(timestamp: number) {
  const now = Date.now();
  return Math.abs(now - timestamp) <= 5 * 60 * 1000;
}

function parseTimestamp(raw: string | null) {
  if (!raw) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}

export function createErc8004AuthMiddleware(env: Env, options: Options) {
  return async (c: Context, next: Next) => {
    const agentId = getHeader(c, "x-erc8004-agent-id");
    const address = getHeader(c, "x-erc8004-address");
    const timestampRaw = getHeader(c, "x-erc8004-timestamp");
    const nonce = getHeader(c, "x-erc8004-nonce");
    const signature = getHeader(c, "x-erc8004-signature");

    if (!agentId || !address || !timestampRaw || !nonce || !signature) {
      if (options.required) {
        throw new ApiError(401, "UNAUTHORIZED", "Missing ERC-8004 authentication headers");
      }
      c.set("authAgent", null);
      return next();
    }

    const timestamp = parseTimestamp(timestampRaw);
    if (!timestamp || !isFreshTimestamp(timestamp)) {
      throw new ApiError(401, "UNAUTHORIZED", "Expired or invalid ERC-8004 timestamp");
    }

    const signedMessage = getSignedMessage({
      agentId,
      address,
      method: c.req.method,
      path: c.req.path,
      timestamp: String(timestamp),
      nonce,
    });

    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message: signedMessage,
      signature: signature as `0x${string}`,
    });

    if (!valid) {
      throw new ApiError(401, "UNAUTHORIZED", "Invalid ERC-8004 signature");
    }

    const resolveAgent = options.resolveAgent ?? getOrCreateAgent;
    const agent = await resolveAgent(env, {
      agentId,
      address: address as `0x${string}`,
    });

    c.set("authAgent", {
      agentId,
      address: address as `0x${string}`,
      nonce,
      timestamp,
      signature: signature as `0x${string}`,
      agent,
    } satisfies AuthenticatedAgent);
    await next();
  };
}

export function getAuthAgent(c: Context) {
  return c.get("authAgent" as never) as AuthenticatedAgent | null | undefined;
}

export function createErc8004SignedMessage(input: {
  agentId: string;
  address: string;
  method: string;
  path: string;
  timestamp: number;
  nonce: string;
}) {
  return getSignedMessage({
    agentId: input.agentId,
    address: input.address,
    method: input.method,
    path: input.path,
    timestamp: String(input.timestamp),
    nonce: input.nonce,
  });
}

export function createAgentProofHash(message: string) {
  return createHash("sha256").update(message).digest("hex");
}
