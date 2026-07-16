import { createRequire } from "node:module";
import type * as MentoSdk from "@mento-protocol/mento-sdk";
import {
  encodeFunctionData,
  erc20Abi,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import type { Env } from "../config/env.js";
import { createChainClients } from "../lib/chain.js";

const require = createRequire(import.meta.url);
const { Mento, deadlineFromMinutes } = require("@mento-protocol/mento-sdk") as typeof MentoSdk;
const MAINNET_UNISWAP_ROUTER = "0x5615CDAb10dc425a742d643d949a7F474C01abc4" as Address;
const MAINNET_UNISWAP_QUOTER = "0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8" as Address;

const uniswapQuoterAbi = parseAbi([
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

const uniswapRouterAbi = parseAbi([
  "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum)) payable returns (uint256 amountOut)",
]);

export type TreasuryRoute = "mento" | "uniswap-v3";

export type TreasurySwapQuote = {
  protocol: TreasuryRoute;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  expectedAmountOut: bigint;
  minAmountOut: bigint;
  expiresAt: number;
  path?: Hex;
};

export type TreasuryCall = {
  to: Address;
  data: Hex;
  value: bigint;
};

function subtractBps(amount: bigint, bps: number) {
  return (amount * BigInt(10_000 - bps)) / 10_000n;
}

function encodeV3Path(tokens: Address[], fees: number[]): Hex {
  if (tokens.length !== fees.length + 1) throw new Error("Invalid Uniswap path");
  let encoded = tokens[0].toLowerCase();
  for (let index = 0; index < fees.length; index += 1) {
    encoded += fees[index].toString(16).padStart(6, "0");
    encoded += tokens[index + 1].toLowerCase().slice(2);
  }
  return encoded as Hex;
}

async function createMento(env: Env) {
  if (env.CHAIN_ID !== 42220 && env.CHAIN_ID !== 11142220) {
    throw new Error(`Unsupported Mento chain ID ${env.CHAIN_ID}`);
  }
  return Mento.create(env.CHAIN_ID, env.CELO_RPC_URL);
}

function uniswapPaths(env: Env, tokenIn: Address, tokenOut: Address) {
  const usdm = env.USDM_ADDRESS ?? "0x765DE816845861e75A25fCA122bb6898B8B1282a";
  const feeTiers = [...new Set([env.UNISWAP_POOL_FEE ?? 3000, 500, 3000, 10000])];
  const paths: Hex[] = [];
  for (const fee of feeTiers) {
    paths.push(encodeV3Path([tokenIn, tokenOut], [fee]));
    if (
      tokenIn.toLowerCase() !== usdm.toLowerCase()
      && tokenOut.toLowerCase() !== usdm.toLowerCase()
    ) {
      paths.push(encodeV3Path([tokenIn, usdm, tokenOut], [fee, fee]));
    }
  }
  return paths;
}

function uniswapAddresses(env: Env) {
  return {
    router: env.UNISWAP_ROUTER_ADDRESS ?? (env.CHAIN_ID === 42220 ? MAINNET_UNISWAP_ROUTER : undefined),
    quoter: env.UNISWAP_QUOTER_ADDRESS ?? (env.CHAIN_ID === 42220 ? MAINNET_UNISWAP_QUOTER : undefined),
  };
}

async function quoteUniswap(
  env: Env,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  slippageBps: number,
): Promise<TreasurySwapQuote> {
  const addresses = uniswapAddresses(env);
  if (!addresses.quoter || !addresses.router) {
    throw new Error("Uniswap fallback is not configured");
  }
  let best: { path: Hex; amountOut: bigint } | null = null;
  let lastError: unknown;
  const clients = [createChainClients(env).publicClient];
  if (env.CHAIN_ID === 42220 && !env.CELO_RPC_URL.includes("forno.celo.org")) {
    clients.push(createChainClients({ ...env, CELO_RPC_URL: "https://forno.celo.org" }).publicClient);
  }
  for (const publicClient of clients) {
    for (const path of uniswapPaths(env, tokenIn, tokenOut)) {
      try {
        const simulation = await publicClient.simulateContract({
          address: addresses.quoter,
          abi: uniswapQuoterAbi,
          functionName: "quoteExactInput",
          args: [path, amountIn],
        });
        const amountOut = simulation.result[0];
        if (!best || amountOut > best.amountOut) best = { path, amountOut };
      } catch (error) {
        lastError = error;
      }
    }
    if (best) break;
  }
  if (!best) {
    throw new Error(lastError instanceof Error ? lastError.message : "No Uniswap route");
  }
  return {
    protocol: "uniswap-v3",
    tokenIn,
    tokenOut,
    amountIn,
    expectedAmountOut: best.amountOut,
    minAmountOut: subtractBps(best.amountOut, slippageBps),
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    path: best.path,
  };
}

export async function quoteTreasurySwap(
  env: Env,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  slippageBps = env.TREASURY_MAX_SLIPPAGE_BPS ?? 100,
): Promise<TreasurySwapQuote> {
  try {
    const mento = await createMento(env);
    const route = await mento.routes.findRoute(tokenIn, tokenOut);
    const tradable = await mento.trading.isPairTradable(tokenIn, tokenOut);
    if (!tradable) throw new Error("Mento pair is currently paused or limited");
    const expectedAmountOut = await mento.quotes.getAmountOut(tokenIn, tokenOut, amountIn, route);
    if (expectedAmountOut <= 0n) throw new Error("Mento returned zero output");
    return {
      protocol: "mento",
      tokenIn,
      tokenOut,
      amountIn,
      expectedAmountOut,
      minAmountOut: subtractBps(expectedAmountOut, slippageBps),
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    };
  } catch (mentoError) {
    try {
      return await quoteUniswap(env, tokenIn, tokenOut, amountIn, slippageBps);
    } catch (uniswapError) {
      throw new Error(
        `No executable treasury route. Mento: ${
          mentoError instanceof Error ? mentoError.message : String(mentoError)
        }. Uniswap: ${uniswapError instanceof Error ? uniswapError.message : String(uniswapError)}`,
      );
    }
  }
}

export async function buildTreasurySwapCalls(
  env: Env,
  quote: TreasurySwapQuote,
  owner: Address,
): Promise<{ approval: TreasuryCall | null; swap: TreasuryCall }> {
  if (quote.protocol === "mento") {
    const mento = await createMento(env);
    const route = await mento.routes.findRoute(quote.tokenIn, quote.tokenOut);
    const transaction = await mento.swap.buildSwapTransaction(
      quote.tokenIn,
      quote.tokenOut,
      quote.amountIn,
      owner,
      owner,
      {
        slippageTolerance: (env.TREASURY_MAX_SLIPPAGE_BPS ?? 100) / 100,
        deadline: deadlineFromMinutes(1),
      },
      route,
    );
    const approval = transaction.approval
      ? {
          to: transaction.approval.to as Address,
          data: transaction.approval.data as Hex,
          value: BigInt(transaction.approval.value ?? 0),
        }
      : null;
    return {
      approval,
      swap: {
        to: transaction.swap.params.to as Address,
        data: transaction.swap.params.data as Hex,
        value: BigInt(transaction.swap.params.value ?? 0),
      },
    };
  }

  const addresses = uniswapAddresses(env);
  if (!addresses.router || !quote.path) {
    throw new Error("Uniswap route is incomplete");
  }
  return {
    approval: {
      to: quote.tokenIn,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [addresses.router, quote.amountIn],
      }),
      value: 0n,
    },
    swap: {
      to: addresses.router,
      data: encodeFunctionData({
        abi: uniswapRouterAbi,
        functionName: "exactInput",
        args: [{
          path: quote.path,
          recipient: owner,
          amountIn: quote.amountIn,
          amountOutMinimum: quote.minAmountOut,
        }],
      }),
      value: 0n,
    },
  };
}
