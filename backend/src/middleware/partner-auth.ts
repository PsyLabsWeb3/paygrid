import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { Env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";

export function isValidPartnerAuthorization(header: string | undefined, expected: string) {
  if (!header?.startsWith("Bearer ") || !expected) return false;
  const supplied = Buffer.from(header.slice("Bearer ".length), "utf8");
  const configured = Buffer.from(expected, "utf8");
  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}

export function createPartnerAuthMiddleware(env: Env): MiddlewareHandler {
  return async (c, next) => {
    if (env.ODELEITE_PARTNER_ENABLED !== "true") {
      throw new ApiError(404, "PARTNER_DISABLED", "Partner payment links are disabled");
    }
    if (!isValidPartnerAuthorization(c.req.header("Authorization"), env.ODELEITE_PARTNER_API_KEY ?? "")) {
      throw new ApiError(401, "UNAUTHORIZED", "Invalid partner credential");
    }
    await next();
  };
}
