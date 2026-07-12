import { codeFromHostname, toDataSuffix } from "@celo/attribution-tags";
import { concat, type Hex } from "viem";
import { appConfig } from "@/lib/env";

export function withAttribution(data: Hex): Hex {
  if (typeof window === "undefined") return data;
  try {
    const hostCode = codeFromHostname(window.location.hostname);
    const codes = appConfig.attributionCode
      ? [hostCode, appConfig.attributionCode]
      : hostCode;
    return concat([data, toDataSuffix(codes)]) as Hex;
  } catch {
    return data;
  }
}
