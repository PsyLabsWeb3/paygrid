import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";
import { createOwnershipAuthMiddleware } from "../middleware/ownership-auth.js";
import { getAuthAgent } from "../middleware/erc8004-auth.js";
import { getAuthUser } from "../middleware/privy-auth.js";
import { listOwnedPayments } from "../services/payments.js";

const paymentsQuerySchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(["pending", "confirmed", "failed"] as const).optional(),
  token: z.enum(["USDm", "USDC", "USDT"] as const).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

function resolveOwner(c: any) {
  const authUser = getAuthUser(c);
  if (authUser) {
    return { id: authUser.user.id, type: "user" as const };
  }

  const authAgent = getAuthAgent(c);
  if (authAgent) {
    return { id: authAgent.agent.id, type: "agent" as const };
  }

  return null;
}

export function paymentsRoutes(env: Env) {
  const app = new Hono();
  const requireOwnershipAuth = createOwnershipAuthMiddleware(env);

  app.get("/", requireOwnershipAuth, async (c) => {
    const owner = resolveOwner(c);
    if (!owner) {
      throw new ApiError(401, "UNAUTHORIZED", "Missing authenticated user or agent");
    }

    const query = paymentsQuerySchema.parse(c.req.query());
    const result = await listOwnedPayments(env, owner, query);
    return c.json(result);
  });

  return app;
}
