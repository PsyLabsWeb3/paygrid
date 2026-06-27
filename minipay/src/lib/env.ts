import { isAddress, type Address } from "viem";

function publicEnv(name: string, fallback: string) {
  const value = process.env[name] ?? fallback;
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
      ? "0x2924FEf3eF7c3ADBFF22b286C42764a96c53f9f4"
      : "0x6c3363D33eCD912576051316AF0A1c95F77EAD73",
  ),
  paygridLinkAddress: publicAddress(
    "NEXT_PUBLIC_PAYGRID_LINK_ADDRESS",
    isProductionEnv
      ? "0x31Aa9Ba23e4CAC3f41d88fb1C904067c0b3dda89"
      : "0x86D9B260F96873e82852B476ff7B0c93bD755597",
  ),
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
