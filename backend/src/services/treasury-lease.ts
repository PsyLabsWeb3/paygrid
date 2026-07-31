import { randomUUID } from "node:crypto";
import type { Env } from "../config/env.js";
import { getSupabase } from "../db/supabase.js";
import { ApiError } from "../lib/errors.js";

export async function withTreasuryExecutionLease<T>(
  env: Env,
  purpose: string,
  operation: () => Promise<T>,
) {
  const holder = `${purpose}:${randomUUID()}`;
  const ttlSeconds = env.TREASURY_EXECUTION_LEASE_SECONDS ?? 180;
  const { data, error } = await getSupabase(env).rpc("acquire_treasury_execution_lease", {
    p_holder: holder,
    p_purpose: purpose,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
  if (data !== true) {
    throw new ApiError(409, "TREASURY_BUSY", "Another Treasury transaction is being executed");
  }

  try {
    return await operation();
  } finally {
    await getSupabase(env).rpc("release_treasury_execution_lease", { p_holder: holder });
  }
}
