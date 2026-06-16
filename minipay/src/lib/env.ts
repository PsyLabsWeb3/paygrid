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

export const appConfig = {
  backendUrl: publicEnv("NEXT_PUBLIC_BACKEND_URL", "http://localhost:3001").replace(/\/$/, ""),
  appEnv: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 11142220),
  rpcUrl:
    process.env.NEXT_PUBLIC_CELO_RPC_URL ??
    "https://forno.celo-sepolia.celo-testnet.org",
  paygridRouterAddress: publicAddress(
    "NEXT_PUBLIC_PAYGRID_ROUTER_ADDRESS",
    "0xe75027ff07931ef97248402f4df63a4d3287020d",
  ),
  paygridLinkAddress: publicAddress(
    "NEXT_PUBLIC_PAYGRID_LINK_ADDRESS",
    "0xd2dc71c47803b0939944ec29f13b644c48bae7de",
  ),
  usdcAddress: publicAddress(
    "NEXT_PUBLIC_USDC_ADDRESS",
    "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
  ),
};
