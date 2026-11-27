import { isAddress, type Address } from "viem";

// Next.js only inlines public environment values accessed with literal keys.
const publicValues: Record<string, string | undefined> = {
  NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL,
  NEXT_PUBLIC_PAYGRID_ROUTER_ADDRESS: process.env.NEXT_PUBLIC_PAYGRID_ROUTER_ADDRESS,
  NEXT_PUBLIC_PAYGRID_LINK_ADDRESS: process.env.NEXT_PUBLIC_PAYGRID_LINK_ADDRESS,
  NEXT_PUBLIC_PAYGRID_GIFT_VAULT_ADDRESS: process.env.NEXT_PUBLIC_PAYGRID_GIFT_VAULT_ADDRESS,
  NEXT_PUBLIC_PAYGRID_GIFT_ROUTER_ADDRESS: process.env.NEXT_PUBLIC_PAYGRID_GIFT_ROUTER_ADDRESS,
  NEXT_PUBLIC_USDC_ADDRESS: process.env.NEXT_PUBLIC_USDC_ADDRESS,
  NEXT_PUBLIC_USDT_ADDRESS: process.env.NEXT_PUBLIC_USDT_ADDRESS,
  NEXT_PUBLIC_USDM_ADDRESS: process.env.NEXT_PUBLIC_USDM_ADDRESS,
};

function publicEnv(name: string, fallback: string) {
  const value = publicValues[name] ?? fallback;
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function publicAddress(name: string, fallback: Address): Address {
  const value = publicEnv(name, fallback);
  if (!isAddress(value)) {
    throw new Error(`${name} must be an EVM address`);
  }
  return value;
}

function optionalPublicAddress(name: string): Address | undefined {
  const value = publicValues[name];
  if (!value) return undefined;
  if (!isAddress(value)) throw new Error(`${name} must be an EVM address`);
  return value;
}

const isProductionEnv = (process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV) === "production";

export const appConfig = {
  appEnv: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
  backendUrl: publicEnv(
    "NEXT_PUBLIC_BACKEND_URL",
    isProductionEnv ? "https://api.celopaygrid.xyz" : "http://localhost:3001",
  ).replace(/\/$/, ""),
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? (isProductionEnv ? 42220 : 11142220)),
  rpcUrl:
    process.env.NEXT_PUBLIC_CELO_RPC_URL ??
    (isProductionEnv ? "https://forno.celo.org" : "https://forno.celo-sepolia.celo-testnet.org"),
  paygridRouterAddress: publicAddress(
    "NEXT_PUBLIC_PAYGRID_ROUTER_ADDRESS",
    isProductionEnv
      ? "0x8d290c97100f0e87e04Efd1a790F27004fA3f08B"
      : "0x6c3363D33eCD912576051316AF0A1c95F77EAD73",
  ),
  paygridLinkAddress: publicAddress(
    "NEXT_PUBLIC_PAYGRID_LINK_ADDRESS",
    isProductionEnv
      ? "0x31Aa9Ba23e4CAC3f41d88fb1C904067c0b3dda89"
      : "0x86D9B260F96873e82852B476ff7B0c93bD755597",
  ),
  giftVaultAddress: optionalPublicAddress("NEXT_PUBLIC_PAYGRID_GIFT_VAULT_ADDRESS"),
  giftRouterAddress: optionalPublicAddress("NEXT_PUBLIC_PAYGRID_GIFT_ROUTER_ADDRESS"),
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  miniPayDeepLinkEnabled: process.env.NEXT_PUBLIC_MINIPAY_DEEPLINK_ENABLED === "true",
  attributionCode: process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_CODE,
  wmxnAddress: "0x337E7456B420bD3481e7FA61fA9850343d610d34" as Address,
  usdcAddress: publicAddress(
    "NEXT_PUBLIC_USDC_ADDRESS",
    isProductionEnv
      ? "0xcebA9300f2b948710d2653dD7B07f33A8B32118C"
      : "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
  ),
  usdtAddress: publicAddress(
    "NEXT_PUBLIC_USDT_ADDRESS",
    "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
  ),
  usdmAddress: publicAddress(
    "NEXT_PUBLIC_USDM_ADDRESS",
    "0x765DE816845861e75A25fCA122bb6898B8B1282a",
  ),
};
