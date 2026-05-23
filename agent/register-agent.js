const { SelfAgent } = require("@selfxyz/agent-sdk");
const { readFileSync } = require("fs");
const path = require("path");

async function main() {
  const mode = process.argv[2] || "wallet-free";
  const network = process.argv[3] || "testnet";

  console.log(`Mode: ${mode}, Network: ${network}`);

  let body;

  if (mode === "linked") {
    const privateKey = readFileSync(path.join(__dirname, ".env"), "utf8")
      .split("\n")
      .find(line => line.startsWith("AGENT_OWNER_PRIVATE_KEY="))
      ?.split("=")[1];

    if (!privateKey) {
      console.error("No AGENT_OWNER_PRIVATE_KEY found in .env");
      process.exit(1);
    }

    const agent = new SelfAgent({ privateKey, network });
    body = {
      mode: "linked",
      humanAddress: agent.address,
      network: network === "testnet" ? "testnet" : "mainnet",
    };
  } else {
    body = {
      mode: "wallet-free",
      network: network === "testnet" ? "testnet" : "mainnet",
    };
  }

  console.log("\nCalling register API...");
  console.log("Body:", JSON.stringify(body, null, 2));

  const res = await fetch("https://app.ai.self.xyz/api/agent/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log("\nResponse:", JSON.stringify(data, null, 2));

  if (data.qrCode || data.qrUrl) {
    console.log("\n⚠️  A HUMAN must scan this QR code with the Self app (iOS/Android)");
    console.log(`QR: ${data.qrCode || data.qrUrl}`);
  }

  if (data.sessionToken) {
    console.log(`\nSession token: ${data.sessionToken}`);
    console.log(`Poll status: GET https://app.ai.self.xyz/api/agent/register/status?sessionToken=${data.sessionToken}`);
  }
}

main().catch(console.error);
