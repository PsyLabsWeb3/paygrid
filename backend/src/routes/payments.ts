import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";
import { createPrivyAuthMiddleware, getAuthUser } from "../middleware/privy-auth.js";
import { listUserPayments } from "../services/payments.js";

const paymentsQuerySchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(["pending", "confirmed", "failed"] as const).optional(),
  token: z.enum(["USDm", "USDC", "USDT"] as const).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export function paymentsRoutes(env: Env) {
  const app = new Hono();
  const requiredPrivyAuth = createPrivyAuthMiddleware(env, { required: true });

  app.get("/", requiredPrivyAuth, async (c) => {
    const auth = getAuthUser(c);
    if (!auth) {
      throw new ApiError(401, "UNAUTHORIZED", "Missing authenticated user");
    }

    const query = paymentsQuerySchema.parse(c.req.query());
    const result = await listUserPayments(env, auth.user.id, query);
    return c.json(result);
  });

  return app;
}
