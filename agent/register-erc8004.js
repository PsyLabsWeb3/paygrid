const { createWalletClient, http, createPublicClient } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { celoSepolia } = require("viem/chains");
const { readFileSync } = require("fs");
const path = require("path");

const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

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

  const publicClient = createPublicClient({
    chain: celoSepolia,
    transport: http(),
  });

  const walletClient = createWalletClient({
    chain: celoSepolia,
    transport: http(),
    account,
  });

  // Check CELO balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance: ${balance} wei (${Number(balance) / 1e18} CELO)`);

  if (balance < 1000000000000000n) {
    console.error("Need at least 0.001 CELO for gas");
    process.exit(1);
  }

  const metadataURI = "ipfs://bafkreiaplaceholder"; // Placeholder — update later

  console.log("\nRegistering agent on ERC-8004...");
  
  const hash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi: IDENTITY_ABI,
    functionName: "register",
    args: [metadataURI],
  });

  console.log(`TX hash: ${hash}`);
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Confirmed in block ${receipt.blockNumber}`);

  // Get agentId from event logs
  // The ERC-8004 register emits Transfer event with tokenId
  console.log("\nTX receipt:", JSON.stringify(receipt, null, 2));

  // Try to find the agent ID — typically the first Transfer event
  if (receipt.logs.length > 0) {
    // The agentId is in the third topic of Transfer event (topic[3])
    // But let's try reading the data first
    for (const log of receipt.logs) {
      if (log.topics.length === 4) {
        const agentId = BigInt(log.topics[3]);
        console.log(`\nAgent ID: ${agentId}`);
        
        const owner = await publicClient.readContract({
          address: IDENTITY_REGISTRY,
          abi: IDENTITY_ABI,
          functionName: "ownerOf",
          args: [agentId],
        });
        console.log(`Owner: ${owner}`);
        break;
      }
    }
  }

  console.log("\nCheck on: https://8004scan.com");
}

main().catch(console.error);
