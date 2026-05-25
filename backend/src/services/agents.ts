import type { Env } from "../config/env.js";
import { getSupabase, type AgentRow } from "../db/supabase.js";
import { ApiError } from "../lib/errors.js";

export type AgentIdentityInput = {
  agentId: string;
  address: `0x${string}`;
  name?: string | null;
  metadataUri?: string | null;
};

export async function getOrCreateAgent(env: Env, input: AgentIdentityInput): Promise<AgentRow> {
  const supabase = getSupabase(env);
  const { data: existing, error: lookupError } = await supabase
    .from("agents")
    .select("*")
    .eq("agent_id", input.agentId)
    .maybeSingle();

  if (lookupError) {
    throw new ApiError(500, "INTERNAL_ERROR", lookupError.message);
  }

  if (existing) {
    if (existing.address.toLowerCase() !== input.address.toLowerCase()) {
      throw new ApiError(403, "FORBIDDEN", "Agent address does not match registered identity");
    }
    return existing as AgentRow;
  }

  const { data, error } = await supabase
    .from("agents")
    .insert({
      agent_id: input.agentId,
      address: input.address.toLowerCase(),
      name: input.name ?? null,
      metadata_uri: input.metadataUri ?? null,
      reputation_score: 0,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new ApiError(500, "INTERNAL_ERROR", error?.message ?? "Failed to create agent");
  }

  return data as AgentRow;
}
