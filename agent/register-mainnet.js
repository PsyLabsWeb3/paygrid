const { createWalletClient, http, createPublicClient } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { celo } = require("viem/chains");
const { readFileSync } = require("fs");
const path = require("path");

const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

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

async function main() {
  const privateKey = readFileSync(path.join(__dirname, ".env"), "utf8")
    .split("\n")
    .find(line => line.startsWith("AGENT_OWNER_PRIVATE_KEY="))
    ?.split("=")[1];

  if (!privateKey) {
    console.error("No AGENT_OWNER_PRIVATE_KEY found in .env");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  console.log(`Owner: ${account.address}`);

  const publicClient = createPublicClient({ chain: celo, transport: http() });
  const walletClient = createWalletClient({ chain: celo, transport: http(), account });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance: ${Number(balance) / 1e18} CELO`);

  const metadataURI = "ipfs://placeholder-bafkreipaygrid-agent-275";

  console.log("\n=== REGISTERING ON CELO MAINNET (no metadata — cheaper) ===");
  const hash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi: IDENTITY_ABI,
    functionName: "register",
    args: [],  // bare register — cheaper gas, no metadata string
  });

  console.log(`TX: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Confirmed: block ${receipt.blockNumber}`);

  for (const log of receipt.logs) {
    if (log.topics.length === 4 && log.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef") {
      const agentId = BigInt(log.topics[3]);
      console.log(`\n███████████████████████████████████████`);
      console.log(`██  AGENT ID: ${agentId}`);
      console.log(`██  https://8004scan.com/agent/${agentId}`);
      console.log(`https://www.8004scan.com/agent/${agentId}`);
      console.log(`███████████████████████████████████████`);
    }
  }
}

main().catch(console.error);
