import assert from "node:assert/strict";
import test from "node:test";
import { fromDataSuffix } from "@celo/attribution-tags";
import type { Env } from "../config/env.js";
import { withServerAttribution } from "../lib/attribution.js";

test("server attribution includes the assigned hackathon code", () => {
  const env = {
    PUBLIC_APP_URL: "https://www.celopaygrid.xyz",
    CELO_ATTRIBUTION_CODE: "celo_7b12194aeec1",
  } as unknown as Env;
  const tagged = withServerAttribution(env, "0x1234");
  const decoded = fromDataSuffix(tagged);
  assert.ok(decoded);
  assert.ok(decoded.codes.includes("celo_7b12194aeec1"));
});
