const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");

const key = generatePrivateKey();
const account = privateKeyToAccount(key);

console.log("\n=== AGENT OWNER WALLET ===\n");
console.log(`Private Key: ${key}`);
console.log(`Address:     ${account.address}`);
console.log("\nGuarda esta key en /agent/.env como AGENT_OWNER_PRIVATE_KEY");
console.log("NUNCA la commitees.");
console.log("\nFondea esta address con 0.01 CELO para gas en Mainnet.");
console.log("Para Sepolia, usa el faucet: https://faucet.celo.org/celo-sepolia\n");
