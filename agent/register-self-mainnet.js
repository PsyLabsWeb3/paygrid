const { SelfAgent } = require("@selfxyz/agent-sdk");
const { readFileSync } = require("fs");
const path = require("path");

function readDotenv() {
  return Object.fromEntries(
    readFileSync(path.join(__dirname, ".env"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

async function main() {
  const env = readDotenv();
  const privateKey = env.AGENT_OWNER_PRIVATE_KEY || env.AGENT_PRIVATE_KEY;

  if (!privateKey) {
    console.error("No AGENT_OWNER_PRIVATE_KEY or AGENT_PRIVATE_KEY found in agent/.env");
    process.exit(1);
  }

  const agent = new SelfAgent({ privateKey, network: "mainnet" });
  console.log(`Owner address: ${agent.address}`);

  const body = {
    mode: "linked",
    humanAddress: agent.address,
    network: "mainnet",
  };

  console.log("\nCalling Self Agent ID API (Mainnet)...");
  console.log("Body:", JSON.stringify(body, null, 2));

  const res = await fetch("https://app.ai.self.xyz/api/agent/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log("\nStatus:", data.stage);
  console.log("Agent address:", data.agentAddress);
  console.log("Expires:", data.expiresAt);

  if (data.scanUrl) {
    console.log("\n⚠️  SCAN THIS WITH SELF APP:");
    console.log(data.scanUrl);
    console.log("\nSession token:", data.sessionToken);
    console.log(`Poll: GET https://app.ai.self.xyz/api/agent/register/status?sessionToken=${data.sessionToken}`);
    console.log("\nAfter verification, update the hosted MCP env with:");
    console.log("SELF_VERIFICATION_STATUS=verified");
    console.log("SELF_AGENT_ID=<id returned by the status endpoint>");
    console.log("SELF_VERIFICATION_URL=<public Self status/proof URL if provided>");
  } else {
    console.log("\nFull response:", JSON.stringify(data, null, 2));
  }
}

main().catch(console.error);
