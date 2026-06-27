import { Mento, deadlineFromMinutes } from "@mento-protocol/mento-sdk";
import { encodeFunctionData, erc20Abi, parseAbi, type Address, type Hex } from "viem";
import type { Env } from "../config/env.js";
import type { PaymentLinkRow } from "../db/supabase.js";
import { createChainClients, paygridRouterAbiConst } from "../lib/chain.js";
import { ApiError } from "../lib/errors.js";
import { getTokenAddress, parseHumanAmount, TOKEN_DECIMALS, type Stablecoin } from "../lib/tokens.js";

const uniswapQuoterAbi = parseAbi([
  "function quoteExactOutput(bytes path, uint256 amountOut) returns (uint256 amountIn, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

const uniswapSwapRouterAbi = parseAbi([
  "function exactOutput((bytes path,address recipient,uint256 amountOut,uint256 amountInMaximum)) payable returns (uint256 amountIn)",
]);

export type SwapQuoteInput = {
  payerToken: Stablecoin;
  slippageBps?: number;
};

export type CryptoQuote = {
  paymentMode: "exact" | "swap";
  payerToken: Stablecoin;
  settlementToken: Stablecoin;
  amountOut: string;
  amountIn: string;
  amountInMax: string;
  minAmountOut: string;
  priceImpact: string | null;
  protocol: "none" | "mento" | "uniswap-v3";
  swapTarget: Address | null;
  expiresAt: string;
};

function addBps(amount: bigint, bps: number) {
  return (amount * BigInt(10000 + bps) + 9999n) / 10000n;
}

function rescaleAmount(amount: bigint, fromDecimals: number, toDecimals: number) {
  if (fromDecimals === toDecimals) return amount;
  if (fromDecimals < toDecimals) return amount * 10n ** BigInt(toDecimals - fromDecimals);
  return amount / 10n ** BigInt(fromDecimals - toDecimals);
}

function getMentoChainId(env: Env) {
  if (env.CHAIN_ID !== 42220 && env.CHAIN_ID !== 11142220) {
    throw new Error(`Unsupported Mento chain ID ${env.CHAIN_ID}`);
  }
  return env.CHAIN_ID;
}

async function createMento(env: Env) {
  return Mento.create(getMentoChainId(env), env.CELO_RPC_URL);
}

async function findMentoAmountIn(
  env: Env,
  payerToken: Stablecoin,
  settlementToken: Stablecoin,
  amountOut: bigint,
) {
  const mento = await createMento(env);
  const tokenIn = getTokenAddress(env, payerToken);
  const tokenOut = getTokenAddress(env, settlementToken);
  const route = await mento.routes.findRoute(tokenIn, tokenOut);

  let low = 1n;
  let high = rescaleAmount(amountOut, TOKEN_DECIMALS[settlementToken], TOKEN_DECIMALS[payerToken]);
  if (high < 1n) high = 1n;
  high = addBps(high, 100);

  for (let i = 0; i < 16; i += 1) {
    const quotedOut = await mento.quotes.getAmountOut(tokenIn, tokenOut, high, route);
    if (quotedOut >= amountOut) {
      break;
    }
    high *= 2n;
  }

  const highOut = await mento.quotes.getAmountOut(tokenIn, tokenOut, high, route);
  if (highOut < amountOut) {
    throw new Error("Mento route cannot satisfy output amount");
  }

  while (low < high) {
    const mid = (low + high) / 2n;
    const quotedOut = await mento.quotes.getAmountOut(tokenIn, tokenOut, mid, route);
    if (quotedOut >= amountOut) {
      high = mid;
    } else {
      low = mid + 1n;
    }
  }

  return { mento, route, amountIn: high };
}

function normalizeSlippage(env: Env, slippageBps?: number) {
  const requested = slippageBps ?? (env.MAX_SWAP_SLIPPAGE_BPS ?? 100);
  if (!Number.isInteger(requested) || requested < 1 || requested > (env.MAX_SWAP_SLIPPAGE_BPS ?? 100)) {
    throw new ApiError(400, "INVALID_SLIPPAGE", `slippageBps must be between 1 and ${(env.MAX_SWAP_SLIPPAGE_BPS ?? 100)}`);
  }
  return requested;
}

function encodeV3Path(tokens: Address[], fees: number[]): Hex {
  if (tokens.length !== fees.length + 1) throw new Error("Invalid Uniswap path");
  let encoded = tokens[0].toLowerCase();
  for (let i = 0; i < fees.length; i += 1) {
    encoded += fees[i].toString(16).padStart(6, "0");
    encoded += tokens[i + 1].toLowerCase().slice(2);
  }
  return encoded as Hex;
}

function getExactOutputPath(env: Env, payerToken: Stablecoin, settlementToken: Stablecoin): Hex {
  const payerAddress = getTokenAddress(env, payerToken);
  const settlementAddress = getTokenAddress(env, settlementToken);
  const usdmAddress = getTokenAddress(env, "USDm");
  const fee = (env.UNISWAP_POOL_FEE ?? 500);

  if (payerToken === "USDm" || settlementToken === "USDm") {
    return encodeV3Path([settlementAddress, payerAddress], [fee]);
  }
  return encodeV3Path([settlementAddress, usdmAddress, payerAddress], [fee, fee]);
}

export function ensureCryptoPayable(link: PaymentLinkRow) {
  if (link.status === "paid") throw new ApiError(409, "ALREADY_PAID", "Link already settled");
  if (link.status !== "active") throw new ApiError(410, "EXPIRED", `Link is ${link.status}`);
  if (!link.accepted_methods.includes("crypto")) {
    throw new ApiError(400, "UNSUPPORTED_METHOD", "Crypto payments not accepted for this link");
  }
}

export async function quoteCryptoPayment(env: Env, link: PaymentLinkRow, input: SwapQuoteInput): Promise<CryptoQuote> {
  ensureCryptoPayable(link);
  const settlementToken = link.token as Stablecoin;
  const amountOut = parseHumanAmount(link.amount, settlementToken);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();

  if (input.payerToken === settlementToken) {
    return {
      paymentMode: "exact",
      payerToken: input.payerToken,
      settlementToken,
      amountOut: amountOut.toString(),
      amountIn: amountOut.toString(),
      amountInMax: amountOut.toString(),
      minAmountOut: amountOut.toString(),
      priceImpact: "0",
      protocol: "none",
      swapTarget: null,
      expiresAt,
    };
  }

  const slippageBps = normalizeSlippage(env, input.slippageBps);

  try {
    const { mento, amountIn } = await findMentoAmountIn(env, input.payerToken, settlementToken, amountOut);
    return {
      paymentMode: "swap",
      payerToken: input.payerToken,
      settlementToken,
      amountOut: amountOut.toString(),
      amountIn: amountIn.toString(),
      amountInMax: addBps(amountIn, slippageBps).toString(),
      minAmountOut: amountOut.toString(),
      priceImpact: null,
      protocol: "mento",
      swapTarget: mento.getContractAddress("Router") as Address,
      expiresAt,
    };
  } catch (mentoError) {
    if (!env.UNISWAP_ROUTER_ADDRESS || !env.UNISWAP_QUOTER_ADDRESS) {
      throw new ApiError(503, "SWAP_UNAVAILABLE", "Mento quote failed and Uniswap fallback is not configured", {
        mento: mentoError instanceof Error ? mentoError.message : String(mentoError),
      });
    }

    const { publicClient } = createChainClients(env);
    const path = getExactOutputPath(env, input.payerToken, settlementToken);
    let quotedAmountIn: bigint;
    try {
      const quote = await publicClient.readContract({
        address: env.UNISWAP_QUOTER_ADDRESS,
        abi: uniswapQuoterAbi,
        functionName: "quoteExactOutput",
        args: [path, amountOut],
      });
      quotedAmountIn = quote[0];
    } catch (uniswapError) {
      throw new ApiError(503, "SWAP_UNAVAILABLE", "Unable to quote stablecoin swap on Mento or Uniswap", {
        mento: mentoError instanceof Error ? mentoError.message : String(mentoError),
        uniswap: uniswapError instanceof Error ? uniswapError.message : String(uniswapError),
      });
    }

    return {
      paymentMode: "swap",
      payerToken: input.payerToken,
      settlementToken,
      amountOut: amountOut.toString(),
      amountIn: quotedAmountIn.toString(),
      amountInMax: addBps(quotedAmountIn, slippageBps).toString(),
      minAmountOut: amountOut.toString(),
      priceImpact: null,
      protocol: "uniswap-v3",
      swapTarget: env.UNISWAP_ROUTER_ADDRESS,
      expiresAt,
    };
  }
}

export async function buildPreparedCryptoPayTx(env: Env, link: PaymentLinkRow, input: SwapQuoteInput) {
  const quote = await quoteCryptoPayment(env, link, input);
  const settlementToken = link.token as Stablecoin;
  const tokenInAddress = getTokenAddress(env, quote.payerToken);
  const approveAmount = BigInt(quote.amountInMax);
  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [env.PAYGRID_ROUTER_ADDRESS, approveAmount],
  });

  let payData: Hex;
  if (quote.paymentMode === "exact") {
    payData = encodeFunctionData({
      abi: paygridRouterAbiConst,
      functionName: "pay",
      args: [BigInt(link.on_chain_link_id), tokenInAddress, approveAmount],
    });
  } else if (quote.protocol === "mento") {
    const mento = await createMento(env);
    const tokenOutAddress = getTokenAddress(env, settlementToken);
    const swap = await mento.swap.buildSwapParams(
      tokenInAddress,
      tokenOutAddress,
      approveAmount,
      env.PAYGRID_ROUTER_ADDRESS,
      {
        slippageTolerance: (input.slippageBps ?? (env.MAX_SWAP_SLIPPAGE_BPS ?? 100)) / 100,
        deadline: deadlineFromMinutes(1),
      },
    );
    payData = encodeFunctionData({
      abi: paygridRouterAbiConst,
      functionName: "payWithSwap",
      args: [
        BigInt(link.on_chain_link_id),
        tokenInAddress,
        approveAmount,
        BigInt(quote.minAmountOut),
        swap.params.to as Address,
        swap.params.data as Hex,
        BigInt(Math.floor(new Date(quote.expiresAt).getTime() / 1000)),
      ],
    });
  } else {
    payData = encodeFunctionData({
      abi: paygridRouterAbiConst,
      functionName: "payWithSwap",
      args: [
        BigInt(link.on_chain_link_id),
        tokenInAddress,
        BigInt(quote.amountInMax),
        BigInt(quote.minAmountOut),
        quote.swapTarget,
        encodeFunctionData({
          abi: uniswapSwapRouterAbi,
          functionName: "exactOutput",
          args: [{
            path: getExactOutputPath(env, quote.payerToken, settlementToken),
            recipient: env.PAYGRID_ROUTER_ADDRESS,
            amountOut: BigInt(quote.amountOut),
            amountInMaximum: BigInt(quote.amountInMax),
          }],
        }),
        BigInt(Math.floor(new Date(quote.expiresAt).getTime() / 1000)),
      ],
    });
  }

  return {
    method: "crypto" as const,
    paymentMode: quote.paymentMode,
    approveTx: {
      to: tokenInAddress,
      data: approveData,
      value: "0",
      amount: quote.amountInMax,
      token: quote.payerToken,
    },
    payTx: {
      to: env.PAYGRID_ROUTER_ADDRESS,
      data: payData,
      value: "0",
    },
    quote,
    link: {
      id: link.id,
      onChainLinkId: String(link.on_chain_link_id),
      amount: String(link.amount),
      token: settlementToken,
    },
  };
}
