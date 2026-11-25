import "dotenv/config";
import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
// Local operator command only. Never exposed through the API or MCP.
const target = resolve(".env.x402");
if (existsSync(target))
  throw new Error(".env.x402 already exists; refusing to replace keys");
const payerKey = generatePrivateKey(),
  address = privateKeyToAccount(payerKey).address;
const executor = randomBytes(32).toString("hex"),
  encryption = randomBytes(32).toString("hex");
const payTo = process.env.PAYGRID_TREASURY_ADDRESS ?? "";
const common = `X402_SELLER_ENABLED=false\nX402_PAYER_ENABLED=false\nX402_API_KEY=\nX402_PAY_TO=${payTo}\nX402_PAYER_ADDRESS=${address}\nX402_ENCRYPTION_KEY=${encryption}\nX402_PUBLIC_API_URL=https://api.celopaygrid.xyz\n`;
writeFileSync(
  target,
  common +
    `X402_PAYER_PRIVATE_KEY=${payerKey}\nX402_EXECUTOR_API_KEY=${executor}\n`,
  { flag: "wx", mode: 0o600 },
);
writeFileSync(resolve(".env.x402.worker"), common, { flag: "wx", mode: 0o600 });
for (const module of ["mcp", "agent"]) {
  const path = resolve("..", module, ".env.x402");
  if (!existsSync(path))
    writeFileSync(path, `X402_EXECUTOR_API_KEY=${executor}\n`, {
      flag: "wx",
      mode: 0o600,
    });
}
console.log(
  JSON.stringify({
    created: true,
    payerAddress: address,
    payTo,
    files: [
      "backend/.env.x402",
      "backend/.env.x402.worker",
      "mcp/.env.x402",
      "agent/.env.x402",
    ],
    next: "Set the facilitator API key in the backend and worker env files, verify payTo, fund the payer, and run x402:preflight before enabling flags. Never paste keys into chat.",
  }),
);
