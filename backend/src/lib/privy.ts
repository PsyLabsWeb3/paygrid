import { PrivyClient, type VerifyAuthTokenResponse } from "@privy-io/node";
import type { Env } from "../config/env.js";

const clientCache = new Map<string, PrivyClient>();

function cacheKey(env: Env) {
  return [
    env.PRIVY_APP_ID ?? "",
    env.PRIVY_APP_SECRET ?? "",
    env.PRIVY_JWT_VERIFICATION_KEY ?? "",
  ].join(":");
}

export function getPrivyClient(env: Env) {
  if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) {
    throw new Error("PRIVY_APP_ID and PRIVY_APP_SECRET are required");
  }

  const key = cacheKey(env);
  const cached = clientCache.get(key);
  if (cached) {
    return cached;
  }

  const client = new PrivyClient({
    appId: env.PRIVY_APP_ID,
    appSecret: env.PRIVY_APP_SECRET,
    ...(env.PRIVY_JWT_VERIFICATION_KEY
      ? { jwtVerificationKey: env.PRIVY_JWT_VERIFICATION_KEY }
      : {}),
  });

  clientCache.set(key, client);
  return client;
}

export async function verifyPrivyAccessToken(
  env: Env,
  authToken: string,
): Promise<VerifyAuthTokenResponse> {
  return getPrivyClient(env).utils().auth().verifyAuthToken(authToken);
}
