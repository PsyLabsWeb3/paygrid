import { codeFromHostname, toDataSuffix } from "@celo/attribution-tags";
import { concat, type Hex } from "viem";
import type { Env } from "../config/env.js";

export function withServerAttribution(env: Env, data: Hex): Hex {
  try {
    const hostname = new URL(env.PUBLIC_APP_URL).hostname;
    const hostCode = codeFromHostname(hostname);
    const codes = env.CELO_ATTRIBUTION_CODE
      ? [...new Set([hostCode, env.CELO_ATTRIBUTION_CODE])]
      : [hostCode];
    return concat([data, toDataSuffix(codes)]) as Hex;
  } catch {
    return data;
  }
}
