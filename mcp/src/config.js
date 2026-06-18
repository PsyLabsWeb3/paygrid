export function loadConfig() {
  const optionalEnv = (name, fallback) => {
    const value = process.env[name]?.trim();
    return value || fallback;
  };

  return {
    backendUrl: optionalEnv("BACKEND_URL", process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001").replace(/\/$/, ""),
    publicApiUrl: optionalEnv("MCP_PUBLIC_API_URL", "https://api.celopaygrid.xyz").replace(/\/$/, ""),
    agentPrivateKey: process.env.AGENT_PRIVATE_KEY,
    agentId: process.env.ERC8004_AGENT_ID,
    agentName: process.env.PAYGRID_AGENT_NAME ?? "Paygrid Agent",
    agentAddress: process.env.AGENT_ADDRESS,
    chainId: Number(process.env.CHAIN_ID ?? process.env.CELO_CHAIN_ID ?? "11142220"),
    celoRpcUrl: process.env.CELO_RPC_URL ?? "https://forno.celo-sepolia.celo-testnet.org",
    mcpApiKey: process.env.PAYGRID_MCP_API_KEY,
    httpPort: Number(process.env.MCP_HTTP_PORT ?? "3002"),
    publicBaseUrl: optionalEnv("MCP_PUBLIC_BASE_URL", "https://mcp.celopaygrid.xyz"),
    tokenAddresses: {
      USDC: optionalEnv("USDC_ADDRESS", "0xcebA9300f2b948710d2653dD7B07f33A8B32118C"),
      USDT: optionalEnv("USDT_ADDRESS", "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"),
      USDm: optionalEnv("USDM_ADDRESS", "0x765DE816845861e75A25fCA122bb6898B8B1282a"),
    },
  };
}

export function isWriteAuthorized(config, headers = {}) {
  if (!config.mcpApiKey) return false;
  const authHeader = headers.authorization ?? headers.Authorization;
  const bearer = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const apiKey = headers["x-api-key"] ?? headers["X-API-Key"] ?? bearer;
  return apiKey === config.mcpApiKey;
}
