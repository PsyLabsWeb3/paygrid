const { SelfAgent } = require("@selfxyz/agent-sdk");
const { readFileSync } = require("fs");
const path = require("path");

async function main() {
  const privateKey = readFileSync(path.join(__dirname, ".env"), "utf8")
    .split("\n")
    .find(line => line.startsWith("AGENT_OWNER_PRIVATE_KEY="))
    ?.split("=")[1];

  if (!privateKey) {
    console.error("No AGENT_OWNER_PRIVATE_KEY found in .env");
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
  } else {
    console.log("\nFull response:", JSON.stringify(data, null, 2));
  }
}

main().catch(console.error);
