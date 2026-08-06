import { loadEnv } from "../src/config/env.js";
import { runRipioPreflight } from "../src/services/ripio.js";

const result = await runRipioPreflight(loadEnv());
console.log(JSON.stringify({
  ok: true,
  chainId: result.chainId,
  feeBps: result.feeBps,
  owner: result.owner,
  routerLink: result.routerLink,
  treasury: result.treasury,
  token: result.token,
  decimals: result.decimals,
  symbol: result.symbol,
}, null, 2));
