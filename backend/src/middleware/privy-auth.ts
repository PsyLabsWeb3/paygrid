import type { VerifyAuthTokenResponse } from "@privy-io/node";
import type { Context, Next } from "hono";
import type { Env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";
import { verifyPrivyAccessToken } from "../lib/privy.js";
import { getOrCreatePrivyUser } from "../services/users.js";
import type { UserRow } from "../db/supabase.js";

export type AuthenticatedUser = {
  privyId: string;
  sessionId: string;
  appId: string;
  issuer: string;
  issuedAt: number;
  expiration: number;
  claims: VerifyAuthTokenResponse;
  user: UserRow;
};

export type VerifyAuthToken = (
  authToken: string,
) => Promise<VerifyAuthTokenResponse>;

export type ResolveUser = (privyId: string) => Promise<UserRow>;

type PrivyAuthOptions = {
  required: boolean;
  verifyAuthToken?: VerifyAuthToken;
  resolveUser?: ResolveUser;
};

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

function getPrivyUserId(claims: VerifyAuthTokenResponse) {
  const userId = claims.user_id;
  if (!userId) {
    throw new Error("Privy token is missing userId");
  }
  return userId;
}

export function createPrivyAuthMiddleware(
  env: Env,
  options: PrivyAuthOptions,
) {
  const verifyAuthToken = options.verifyAuthToken ?? ((token) => verifyPrivyAccessToken(env, token));
  const resolveUser = options.resolveUser ?? ((privyId) => getOrCreatePrivyUser(env, privyId));

  return async (c: Context, next: Next) => {
    const token = extractBearerToken(c.req.header("authorization"));
    if (!token) {
      if (options.required) {
        throw new ApiError(401, "UNAUTHORIZED", "Missing Authorization bearer token");
      }
      c.set("authUser", null);
      return next();
    }

    if (token === "invalid") {
      throw new ApiError(401, "UNAUTHORIZED", "Invalid Authorization header");
    }

    try {
      const claims = await verifyAuthToken(token);
      const privyId = getPrivyUserId(claims);
      const user = await resolveUser(privyId);
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
      await next();
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(401, "UNAUTHORIZED", "Invalid Privy access token");
    }
  };
}

export function getAuthUser(c: Context) {
  return c.get("authUser" as never) as AuthenticatedUser | null | undefined;
}
