import { createPublicClient, erc20Abi, http, parseAbi } from "viem";
import type { Env } from "../config/env.js";
import { getSupabase } from "../db/supabase.js";
import { ApiError } from "../lib/errors.js";
import { getTokenAddresses, WMXN_ADDRESS } from "../lib/tokens.js";

const core = ["USDC", "USDT", "USDm"] as const;
const abi = parseAbi([
  "function router() view returns (address)",
  "function paygridLink() view returns (address)",
  "function supportedTokens(address) view returns (bool)",
]);
type WmxnState = { enabled: boolean; reason?: string };
const cache = new WeakMap<Env, { until: number; value: Promise<WmxnState> }>();

export async function hasAtomicLinkStorage(env: Env) {
  const { error } = await getSupabase(env).from("payment_links")
    .select("id,amount_atomic,settlement_decimals,accepted_payer_assets").limit(0);
  if (!error) return true;
  if (["42703", "PGRST204"].includes(error.code)) return false;
  throw new ApiError(503, "STORAGE_UNAVAILABLE", "Payment link storage is unavailable");
}
async function inspectWmxn(env: Env): Promise<WmxnState> {
  if (env.WMXN_LINKS_ENABLED !== "true") return { enabled: false, reason: "disabled" };
  if (env.CHAIN_ID !== 42220) return { enabled: false, reason: "mainnet_only" };
  const address = getTokenAddresses(env).wMXN;
  if (address.toLowerCase() !== WMXN_ADDRESS.toLowerCase())
    return { enabled: false, reason: "token_not_configured" };
  try {
    if (!await hasAtomicLinkStorage(env)) return { enabled: false, reason: "migration_required" };
    const rpc = createPublicClient({ transport: http(env.CELO_RPC_URL, { timeout: 10_000, retryCount: 1 }) });
    if (await rpc.getChainId() !== env.CHAIN_ID) return { enabled: false, reason: "network_mismatch" };
    const [decimals, activeRouter, routerLink, supported] = await Promise.all([
      rpc.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
      rpc.readContract({ address: env.PAYGRID_LINK_ADDRESS, abi, functionName: "router" }),
      rpc.readContract({ address: env.PAYGRID_ROUTER_ADDRESS, abi, functionName: "paygridLink" }),
      rpc.readContract({ address: env.PAYGRID_ROUTER_ADDRESS, abi, functionName: "supportedTokens", args: [address] }),
    ]);
    if (decimals !== 18 || !supported ||
        activeRouter.toLowerCase() !== env.PAYGRID_ROUTER_ADDRESS.toLowerCase() ||
        routerLink.toLowerCase() !== env.PAYGRID_LINK_ADDRESS.toLowerCase())
      return { enabled: false, reason: "router_not_ready" };
    return { enabled: true };
  } catch { return { enabled: false, reason: "temporarily_unavailable" }; }
}
export async function wmxnLinkAvailability(env: Env, fresh = false) {
  const previous = cache.get(env);
  if (!fresh && previous && previous.until > Date.now()) return previous.value;
  const entry = { until: Date.now() + 30_000, value: inspectWmxn(env) };
  cache.set(env, entry);
  const result = await entry.value;
  if (!result.enabled) entry.until = Date.now() + 3_000;
  return result;
}
export async function getPaymentLinkConfig(env: Env) {
  const wMXN = await wmxnLinkAvailability(env);
  return { chainId: env.CHAIN_ID, tokens: wMXN.enabled ? [...core, "wMXN"] : [...core], wMXN };
}
