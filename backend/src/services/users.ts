import type { Env } from "../config/env.js";
import { getSupabase, type UserRow } from "../db/supabase.js";
import { ApiError } from "../lib/errors.js";

export async function getOrCreatePrivyUser(
  env: Env,
  privyId: string,
): Promise<UserRow> {
  const supabase = getSupabase(env);
  const { data: existing, error: lookupError } = await supabase
    .from("users")
    .select("*")
    .eq("privy_id", privyId)
    .maybeSingle();

  if (lookupError) {
    throw new ApiError(500, "INTERNAL_ERROR", lookupError.message);
  }
  if (existing) {
    return existing as UserRow;
  }

  const { data, error } = await supabase
    .from("users")
    .insert({ privy_id: privyId })
    .select("*")
    .single();

  if (error || !data) {
    throw new ApiError(500, "INTERNAL_ERROR", error?.message ?? "Failed to create user");
  }

  return data as UserRow;
}
