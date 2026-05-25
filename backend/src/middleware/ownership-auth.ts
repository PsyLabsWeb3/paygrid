import type { Context, Next } from "hono";
import { verifyMessage } from "viem";
import type { Env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";
import { verifyPrivyAccessToken } from "../lib/privy.js";
import { getOrCreateAgent } from "../services/agents.js";
import { getOrCreatePrivyUser } from "../services/users.js";
import type { AuthenticatedAgent } from "./erc8004-auth.js";
import type { AuthenticatedUser } from "./privy-auth.js";

export type OwnershipAuthOptions = {
  verifyPrivyToken?: typeof verifyPrivyAccessToken;
  resolveUser?: typeof getOrCreatePrivyUser;
  resolveAgent?: typeof getOrCreateAgent;
};

function getHeader(c: Context, name: string) {
  return c.req.header(name) ?? c.req.header(name.toLowerCase()) ?? null;
}

function extractBearerToken(headerValue: string | undefined) {
  if (!headerValue) {
    return null;
  }

  const [scheme, token, ...rest] = headerValue.trim().split(/\s+/);
  if (rest.length > 0 || scheme.toLowerCase() !== "bearer" || !token) {
    return "invalid" as const;
  }

  return token;
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

async function tryAgentAuth(env: Env, c: Context, resolveAgent: typeof getOrCreateAgent) {
  const agentId = getHeader(c, "x-erc8004-agent-id");
  const address = getHeader(c, "x-erc8004-address");
  const timestampRaw = getHeader(c, "x-erc8004-timestamp");
  const nonce = getHeader(c, "x-erc8004-nonce");
  const signature = getHeader(c, "x-erc8004-signature");

  if (!agentId || !address || !timestampRaw || !nonce || !signature) {
    return false;
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
  return true;
}

async function tryPrivyAuth(
  env: Env,
  c: Context,
  verifyPrivyToken: typeof verifyPrivyAccessToken,
  resolveUser: typeof getOrCreatePrivyUser,
) {
  const token = extractBearerToken(c.req.header("authorization"));
  if (!token) {
    return false;
  }

  if (token === "invalid") {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid Authorization header");
  }

  const claims = await verifyPrivyToken(env, token);
  const privyId = claims.user_id;
  if (!privyId) {
    throw new ApiError(401, "UNAUTHORIZED", "Privy token is missing userId");
  }

  const user = await resolveUser(env, privyId);
  c.set("authUser", {
    privyId,
    sessionId: claims.session_id,
    appId: claims.app_id,
    issuer: claims.issuer,
    issuedAt: claims.issued_at,
    expiration: claims.expiration,
    claims,
    user,
  } satisfies AuthenticatedUser);
  return true;
}

export function createOwnershipAuthMiddleware(env: Env, options: OwnershipAuthOptions = {}) {
  const verifyPrivyToken = options.verifyPrivyToken ?? verifyPrivyAccessToken;
  const resolveUser = options.resolveUser ?? getOrCreatePrivyUser;
  const resolveAgent = options.resolveAgent ?? getOrCreateAgent;

  return async (c: Context, next: Next) => {
    const hasAgentHeaders =
      !!getHeader(c, "x-erc8004-agent-id") &&
      !!getHeader(c, "x-erc8004-address") &&
      !!getHeader(c, "x-erc8004-timestamp") &&
      !!getHeader(c, "x-erc8004-nonce") &&
      !!getHeader(c, "x-erc8004-signature");
    const hasPrivyHeader = !!extractBearerToken(c.req.header("authorization"));

    let lastError: ApiError | null = null;

    if (hasAgentHeaders) {
      try {
        if (await tryAgentAuth(env, c, resolveAgent)) {
          await next();
          return;
        }
      } catch (error) {
        if (error instanceof ApiError) {
          lastError = error;
        } else {
          throw error;
        }
      }
    }

    if (hasPrivyHeader) {
      try {
        if (await tryPrivyAuth(env, c, verifyPrivyToken, resolveUser)) {
          await next();
          return;
        }
      } catch (error) {
        if (error instanceof ApiError) {
          lastError = error;
        } else {
          throw error;
        }
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new ApiError(401, "UNAUTHORIZED", "Missing authenticated user or agent");
  };
}
