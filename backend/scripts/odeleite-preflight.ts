import { erc20Abi, getAddress, parseAbi } from "viem";
import { loadEnv } from "../src/config/env.js";
import { createChainClients, paygridLinkAbiConst, paygridRouterAbiConst } from "../src/lib/chain.js";
import { getTokenAddress } from "../src/lib/tokens.js";
import { quoteStablecoinAmount } from "../src/services/swaps.js";

const adapterAbi = parseAbi(["function adaptedToken() view returns (address)"]);
const feeCurrencyDirectoryAbi = parseAbi(["function getCurrencies() view returns (address[])"]);
const expectedPaygridLink = "0x31Aa9Ba23e4CAC3f41d88fb1C904067c0b3dda89";
const expectedPaygridRouter = "0x8d290c97100f0e87e04Efd1a790F27004fA3f08B";

async function main() {
  const env = loadEnv();
  if (env.ODELEITE_PARTNER_ENABLED !== "true") {
    throw new Error("ODELEITE_PARTNER_ENABLED must be true for the production preflight");
  }
  const { publicClient, account } = createChainClients(env, env.ODELEITE_RELAYER_PRIVATE_KEY!);
  const chainId = await publicClient.getChainId();
  if (chainId !== 42220 || env.CHAIN_ID !== 42220) throw new Error(`Expected Celo Mainnet, got ${chainId}`);
  if (getAddress(env.PAYGRID_LINK_ADDRESS) !== getAddress(expectedPaygridLink)) throw new Error("Unexpected PaygridLink address");
  if (getAddress(env.PAYGRID_ROUTER_ADDRESS) !== getAddress(expectedPaygridRouter)) throw new Error("Unexpected PaygridRouterV2 address");

  for (const [name, address] of [
    ["PaygridLink", env.PAYGRID_LINK_ADDRESS],
    ["PaygridRouterV2", env.PAYGRID_ROUTER_ADDRESS],
  ] as const) {
    const code = await publicClient.getCode({ address });
    if (!code || code === "0x") throw new Error(`${name} has no bytecode at ${address}`);
  }

  const [linkRouter, routerLink, feeBps, maxFeeBps] = await Promise.all([
    publicClient.readContract({ address: env.PAYGRID_LINK_ADDRESS, abi: paygridLinkAbiConst, functionName: "router" }),
    publicClient.readContract({ address: env.PAYGRID_ROUTER_ADDRESS, abi: paygridRouterAbiConst, functionName: "paygridLink" }),
    publicClient.readContract({ address: env.PAYGRID_ROUTER_ADDRESS, abi: paygridRouterAbiConst, functionName: "feeBps" }),
    publicClient.readContract({ address: env.PAYGRID_ROUTER_ADDRESS, abi: paygridRouterAbiConst, functionName: "MAX_FEE_BPS" }),
  ]);
  if (getAddress(String(linkRouter)) !== getAddress(env.PAYGRID_ROUTER_ADDRESS)) throw new Error("PaygridLink.router mismatch");
  if (getAddress(String(routerLink)) !== getAddress(env.PAYGRID_LINK_ADDRESS)) throw new Error("PaygridRouterV2.paygridLink mismatch");
  if (Number(feeBps) < 0 || Number(feeBps) > Number(maxFeeBps)) {
    throw new Error(`feeBps=${feeBps} is outside the router limit 0..${maxFeeBps}`);
  }

  for (const token of ["USDC", "USDT", "USDm"] as const) {
    const address = getTokenAddress(env, token);
    const [decimals, supported] = await Promise.all([
      publicClient.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
      publicClient.readContract({ address: env.PAYGRID_ROUTER_ADDRESS, abi: paygridRouterAbiConst, functionName: "supportedTokens", args: [address] }),
    ]);
    const expectedDecimals = token === "USDm" ? 18 : 6;
    if (Number(decimals) !== expectedDecimals) throw new Error(`${token} decimals=${decimals}; expected ${expectedDecimals}`);
    if (!supported) throw new Error(`${token} is not enabled in PaygridRouterV2`);
  }

  for (const target of [env.MENTO_ROUTER_ADDRESS, env.UNISWAP_ROUTER_ADDRESS].filter(Boolean)) {
    const authorized = await publicClient.readContract({
      address: env.PAYGRID_ROUTER_ADDRESS,
      abi: paygridRouterAbiConst,
      functionName: "authorizedSwapTargets",
      args: [target!],
    });
    if (!authorized) throw new Error(`Swap target ${target} is not authorized`);
  }

  for (const [name, address] of [
    ["FeeCurrencyDirectory", env.CELO_FEE_CURRENCY_DIRECTORY_ADDRESS!],
    ["USDC fee adapter", env.USDC_FEE_CURRENCY_ADDRESS!],
    ["USDT fee adapter", env.USDT_FEE_CURRENCY_ADDRESS!],
  ] as const) {
    const code = await publicClient.getCode({ address });
    if (!code || code === "0x") throw new Error(`${name} has no bytecode at ${address}`);
  }

  const currencies = await publicClient.readContract({
    address: env.CELO_FEE_CURRENCY_DIRECTORY_ADDRESS!,
    abi: feeCurrencyDirectoryAbi,
    functionName: "getCurrencies",
  });
  const allowed = new Set(currencies.map((address) => getAddress(address)));
  for (const [symbol, adapter, token] of [
    ["USDC", env.USDC_FEE_CURRENCY_ADDRESS!, getTokenAddress(env, "USDC")],
    ["USDT", env.USDT_FEE_CURRENCY_ADDRESS!, getTokenAddress(env, "USDT")],
  ] as const) {
    const adaptedToken = await publicClient.readContract({ address: adapter, abi: adapterAbi, functionName: "adaptedToken" });
    if (getAddress(adaptedToken) !== getAddress(token)) throw new Error(`${symbol} fee adapter points to another token`);
    if (!allowed.has(getAddress(adapter))) throw new Error(`${symbol} fee adapter is not in the Celo fee-currency directory`);
  }
  if (!allowed.has(getAddress(getTokenAddress(env, "USDm")))) throw new Error("USDm is not in the Celo fee-currency directory");

  const quotes = await Promise.all([
    quoteStablecoinAmount(env, "USDT", "USDC", 1_000_000n, 100),
    quoteStablecoinAmount(env, "USDm", "USDC", 1_000_000n, 100),
  ]);
  for (const quote of quotes) {
    if (!quote.swapTarget) throw new Error(`${quote.payerToken} quote did not return a swap target`);
    const authorized = await publicClient.readContract({
      address: env.PAYGRID_ROUTER_ADDRESS,
      abi: paygridRouterAbiConst,
      functionName: "authorizedSwapTargets",
      args: [quote.swapTarget],
    });
    if (!authorized) throw new Error(`${quote.payerToken} quoted swap target is not authorized`);
  }

  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) throw new Error(`Odeleite relayer ${account.address} has no native balance`);
  if (env.ODELEITE_RELAYER_PRIVATE_KEY === env.BACKEND_WALLET_PRIVATE_KEY) {
    throw new Error("Odeleite relayer must not reuse BACKEND_WALLET_PRIVATE_KEY");
  }
  console.log(JSON.stringify({
    ok: true,
    chainId,
    feeBps: Number(feeBps),
    maxFeeBps: Number(maxFeeBps),
    relayer: account.address,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
