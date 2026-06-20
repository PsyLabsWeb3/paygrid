const { createWalletClient, http, createPublicClient } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { celo } = require("viem/chains");
const { existsSync, readFileSync } = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const DEFAULT_METADATA_URI = "https://mcp.celopaygrid.xyz/.well-known/paygrid-agent.json";

const IDENTITY_ABI = [
  {
    inputs: [],
    name: "register",
    outputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "string", name: "agentURI", type: "string" }],
    name: "register",
    outputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "agentId", type: "uint256" },
      { internalType: "string", name: "agentURI", type: "string" },
    ],
    name: "setAgentURI",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "agentId", type: "uint256" },
      { internalType: "address", name: "wallet", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "bytes", name: "sig", type: "bytes" },
    ],
    name: "setAgentWallet",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    name: "getAgentWallet",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
];

function readEnvFileValue(filePath, name) {
  if (!existsSync(filePath)) return undefined;
  return readFileSync(filePath, "utf8")
    .split("\n")
    .find((line) => line.trim().startsWith(`${name}=`))
    ?.split("=")
    .slice(1)
    .join("=")
    .trim();
}

function readPrivateKey() {
  const files = [
    path.join(__dirname, ".env"),
    path.join(__dirname, "../mcp/.env"),
    path.join(__dirname, "../backend/.env"),
  ];
  const names = ["AGENT_OWNER_PRIVATE_KEY", "AGENT_PRIVATE_KEY", "BACKEND_WALLET_PRIVATE_KEY"];

  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  for (const filePath of files) {
    for (const name of names) {
      const value = readEnvFileValue(filePath, name);
      if (value) return value;
    }
  }
  return undefined;
}

async function main() {
  const privateKey = readPrivateKey();

  if (!privateKey) {
    console.error("No agent private key found. Set AGENT_OWNER_PRIVATE_KEY, AGENT_PRIVATE_KEY, or BACKEND_WALLET_PRIVATE_KEY.");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  const metadataURI = process.env.AGENT_METADATA_URI || DEFAULT_METADATA_URI;
  const shouldBroadcast = process.env.CONFIRM_MAINNET_REGISTER === "true";

  console.log(`Owner: ${account.address}`);
  console.log(`Identity Registry: ${IDENTITY_REGISTRY}`);
  console.log(`Metadata URI: ${metadataURI}`);

  const publicClient = createPublicClient({
    chain: celo,
    transport: http(process.env.CELO_RPC_URL || "https://forno.celo.org"),
  });
  const walletClient = createWalletClient({
    chain: celo,
    transport: http(process.env.CELO_RPC_URL || "https://forno.celo.org"),
    account,
  });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance: ${Number(balance) / 1e18} CELO`);

  await publicClient.simulateContract({
    address: IDENTITY_REGISTRY,
    abi: IDENTITY_ABI,
    functionName: "register",
    args: [metadataURI],
    account,
  });

  if (!shouldBroadcast) {
    console.log("\nDry run OK. To broadcast on Celo mainnet, run:");
    console.log("CONFIRM_MAINNET_REGISTER=true node register-mainnet.js");
    return;
  }

  console.log("\n=== REGISTERING PAYGRID AGENT ON CELO MAINNET ===");
  const hash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi: IDENTITY_ABI,
    functionName: "register",
    args: [metadataURI],
  });

  console.log(`TX: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Confirmed: block ${receipt.blockNumber}`);

  for (const log of receipt.logs) {
    if (log.topics.length === 4 && log.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef") {
      const agentId = BigInt(log.topics[3]);
      console.log(`\n███████████████████████████████████████`);
      console.log(`██  AGENT ID: ${agentId}`);
      console.log(`██  https://8004scan.io/agents/celo/${agentId}`);
      console.log(`███████████████████████████████████████`);
    }
  }
}

main().catch(console.error);
