import { parseAbi } from "viem";
import type { Env } from "../config/env.js";
import { ApiError } from "./errors.js";

export const giftVaultAbi = parseAbi([
  "function claimGift(uint256 giftId,uint256 nonce,uint256 deadline,bytes signature)",
  "function cancelGift(uint256 giftId)",
  "function refundExpiredGift(uint256 giftId)",
  "function getGift(uint256 giftId) view returns ((uint256 id,address sender,address token,uint256 amount,bytes32 claimHash,bytes32 metadataHash,uint256 expiresAt,address recipient,uint8 status))",
  "event GiftCreated(uint256 indexed giftId,address indexed sender,address indexed token,uint256 amount,bytes32 claimHash,bytes32 metadataHash,uint256 expiresAt)",
  "event GiftClaimed(uint256 indexed giftId,address indexed recipient,address indexed token,uint256 amount)",
  "event GiftCancelled(uint256 indexed giftId,address indexed sender)",
  "event GiftRefunded(uint256 indexed giftId,address indexed sender)",
]);

export const giftRouterAbi = parseAbi([
  "function feeBps() view returns (uint256)",
  "function createGift(address token,uint256 giftAmount,bytes32 claimHash,bytes32 metadataHash,uint256 expiresAt) returns (uint256 giftId)",
  "function createGiftWithSwap((address tokenIn,address tokenOut,uint256 giftAmount,uint256 amountInMax,uint256 minAmountOut,address swapTarget,bytes swapCalldata,uint256 deadline,bytes32 claimHash,bytes32 metadataHash,uint256 expiresAt) params) returns (uint256 giftId)",
  "event GiftFunded(uint256 indexed giftId,address indexed sender,address indexed token,uint256 giftAmount,uint256 fee)",
  "event GiftFundedWithSwap(uint256 indexed giftId,address indexed sender,address indexed tokenIn,address tokenOut,uint256 amountIn,uint256 giftAmount)",
]);

export function requireGiftContracts(env: Env) {
  if (!env.PAYGRID_GIFT_VAULT_ADDRESS || !env.PAYGRID_GIFT_ROUTER_ADDRESS) {
    throw new ApiError(503, "GIFTS_UNAVAILABLE", "Gift contracts are not configured");
  }
  return {
    vault: env.PAYGRID_GIFT_VAULT_ADDRESS,
    router: env.PAYGRID_GIFT_ROUTER_ADDRESS,
  };
}
