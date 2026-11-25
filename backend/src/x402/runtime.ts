import type { Env } from "../config/env.js";
import { getSupabase } from "../db/supabase.js";
import { config } from "./config.js";
import { CeloProtocol } from "./protocol.js";
import { Payments } from "./service.js";
import { SupabaseStore } from "./store.js";
import { SafeTransport } from "./transport.js";
const services = new WeakMap<Env, Payments>();
export function getPayments(env: Env) {
  let service = services.get(env);
  if (!service) {
    const cfg = config(env);
    service = new Payments(
      cfg,
      new SupabaseStore(getSupabase(env)),
      new CeloProtocol(cfg),
      new SafeTransport(cfg),
    );
    services.set(env, service);
  }
  return service;
}
