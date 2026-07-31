import { randomUUID } from "node:crypto";
import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verifyTx } from "@celo/attribution-tags";
import type { Env } from "../config/env.js";
import {
  getSupabase,
  type TreasuryFundOperationRow,
  type TreasuryPositionRow,
  type TreasuryWithdrawalAddressRow,
} from "../db/supabase.js";
import { withServerAttribution } from "../lib/attribution.js";
import { createChainClients, paygridRouterAbiConst } from "../lib/chain.js";
import { ApiError } from "../lib/errors.js";
import {
  calculateAvailableUnits,
  isMiniPayWithdrawalAsset,
  KNOWN_TREASURY_ASSET_DECIMALS,
  normalizeFundAmount,
  TREASURY_FUND_ASSETS,
  type TreasuryFundAsset,
  type TreasuryWithdrawalMode,
} from "../lib/treasury-funds.js";
import { getTokenAddress, type Stablecoin } from "../lib/tokens.js";
import { createPaymentLink } from "./links.js";
import { withTreasuryExecutionLease } from "./treasury-lease.js";

const DEFAULT_ASSET_ADDRESSES: Record<Exclude<TreasuryFundAsset, Stablecoin | "CELO">, Address> = {
  XAUT0: "0xaf37E8B6C9ED7f6318979f56Fc287d76c30847ff",
  WETH: "0xD221812de1BD094f35587EE8E174B07B6167D9Af",
  WBTC: "0x8aC2901Dd8A1F17a1A4768A6bA4C3751e3995B2D",
  EURM: "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73",
};

type CreateAddressInput = {
  label: string;
  address: string;
  destinationType: TreasuryWithdrawalAddressRow["destination_type"];
  asset: TreasuryFundAsset;
};

type WithdrawalInput = {
  requestId: string;
  asset: TreasuryFundAsset;
  amount: string;
  withdrawalAddressId: string;
  mode: TreasuryWithdrawalMode;
};

function requireFundsEnabled(env: Env) {
  if (env.TREASURY_FUNDS_ENABLED !== "true") {
    throw new ApiError(409, "TREASURY_FUNDS_DISABLED", "Treasury deposits and withdrawals are disabled");
  }
  if (!env.TREASURY_EXECUTOR_PRIVATE_KEY) {
    throw new ApiError(409, "TREASURY_EXECUTOR_UNAVAILABLE", "Treasury executor is not configured");
  }
}

function executorAddress(env: Env) {
  if (env.TREASURY_EXECUTOR_PRIVATE_KEY) {
    return privateKeyToAccount(env.TREASURY_EXECUTOR_PRIVATE_KEY).address;
  }
  return env.TREASURY_EXECUTOR_ADDRESS ?? null;
}

function attributionCode(env: Env) {
  return env.CELO_ATTRIBUTION_CODE ?? null;
}

function configuredAssetAddress(env: Env, asset: Exclude<TreasuryFundAsset, "CELO">): Address {
  if (asset === "USDC" || asset === "USDT" || asset === "USDm") {
    return getTokenAddress(env, asset);
  }
  const configured = {
    XAUT0: env.TREASURY_XAUT0_ADDRESS,
    WETH: env.TREASURY_WETH_ADDRESS,
    WBTC: env.TREASURY_WBTC_ADDRESS,
    EURM: env.TREASURY_EURM_ADDRESS,
  }[asset];
  if (configured) return configured;
  if (env.CHAIN_ID === 42220) return DEFAULT_ASSET_ADDRESSES[asset];
  throw new ApiError(409, "ASSET_NOT_CONFIGURED", `${asset} is not configured on this network`);
}

async function assetDecimals(env: Env, asset: TreasuryFundAsset) {
  const known = KNOWN_TREASURY_ASSET_DECIMALS[asset];
  if (known !== undefined) return known;
  if (asset === "CELO") return 18;
  const { publicClient } = createChainClients(env);
  return Number(await publicClient.readContract({
    address: configuredAssetAddress(env, asset),
    abi: erc20Abi,
    functionName: "decimals",
  }));
}

async function assetBalance(env: Env, asset: TreasuryFundAsset, owner: Address) {
  const { publicClient } = createChainClients(env);
  if (asset === "CELO") return publicClient.getBalance({ address: owner });
  return publicClient.readContract({
    address: configuredAssetAddress(env, asset),
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
}

function serializeAddress(row: TreasuryWithdrawalAddressRow) {
  return {
    id: row.id,
    label: row.label,
    address: getAddress(row.address),
    destinationType: row.destination_type,
    chainId: row.chain_id,
    asset: row.asset,
    active: row.active,
    createdAt: row.created_at,
    deactivatedAt: row.deactivated_at,
  };
}

function serializeOperation(row: TreasuryFundOperationRow) {
  return {
    id: row.id,
    requestId: row.request_id,
    type: row.operation_type,
    asset: row.asset,
    amount: String(row.amount),
    destinationAddress: row.destination_address ? getAddress(row.destination_address) : null,
    withdrawalAddressId: row.withdrawal_address_id,
    paymentLinkId: row.payment_link_id,
    creationTxHash: row.creation_tx_hash,
    mode: row.mode,
    status: row.status,
    txHash: row.tx_hash,
    attributionCode: row.attribution_code,
    attributionVerified: row.attribution_verified,
    positionIds: row.position_ids ?? [],
    error: row.error,
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
    confirmedAt: row.confirmed_at,
    updatedAt: row.updated_at,
  };
}

async function verifyOperationAttribution(env: Env, hash: Hex) {
  if (!env.CELO_ATTRIBUTION_CODE) return null;
  const { publicClient } = createChainClients(env);
  const decoded = await verifyTx({ client: publicClient, hash });
  return decoded?.codes.includes(env.CELO_ATTRIBUTION_CODE) ?? false;
}

async function reservedByAsset(env: Env) {
  const { data, error } = await getSupabase(env)
    .from("treasury_quant_positions")
    .select("id,asset,amount_asset,status")
    .in("status", ["open", "closing"]);
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
  const reserved = new Map<TreasuryFundAsset, bigint>();
  for (const position of (data ?? []) as Pick<TreasuryPositionRow, "id" | "asset" | "amount_asset" | "status">[]) {
    const decimals = await assetDecimals(env, position.asset);
    const units = parseUnits(String(position.amount_asset), decimals);
    reserved.set(position.asset, (reserved.get(position.asset) ?? 0n) + units);
  }
  return reserved;
}

async function syncFundOperations(env: Env, rows: TreasuryFundOperationRow[]) {
  const supabase = getSupabase(env);
  const linkIds = rows.flatMap((row) => row.operation_type === "deposit" && row.payment_link_id ? [row.payment_link_id] : []);
  const links = linkIds.length
    ? await supabase.from("payment_links").select("id,status,tx_hash").in("id", linkIds)
    : { data: [], error: null };
  if (links.error) throw new ApiError(500, "INTERNAL_ERROR", links.error.message);
  const linksById = new Map((links.data ?? []).map((link) => [link.id as string, link]));
  const { publicClient } = createChainClients(env);

  for (const row of rows) {
    if (row.operation_type === "deposit" && row.payment_link_id) {
      const link = linksById.get(row.payment_link_id);
      const nextStatus = link?.status === "paid" ? "paid" : link?.status === "expired" ? "expired" : row.status;
      const nextHash = link?.tx_hash ?? row.tx_hash;
      const verified = nextStatus === "paid" && nextHash
        ? await verifyOperationAttribution(env, nextHash as Hex)
        : row.attribution_verified;
      if (nextStatus !== row.status || nextHash !== row.tx_hash || verified !== row.attribution_verified) {
        const now = new Date().toISOString();
        await supabase.from("treasury_fund_operations").update({
          status: nextStatus,
          tx_hash: nextHash,
          attribution_verified: verified,
          confirmed_at: nextStatus === "paid" ? now : row.confirmed_at,
          updated_at: now,
        }).eq("id", row.id);
        row.status = nextStatus;
        row.tx_hash = nextHash;
        row.attribution_verified = verified;
        if (nextStatus === "paid") row.confirmed_at = now;
      }
    }

    if (row.operation_type === "withdrawal" && row.status === "submitted" && row.tx_hash) {
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash: row.tx_hash as Hex });
        const now = new Date().toISOString();
        if (receipt.status === "success") {
          await confirmWithdrawal(env, row, now);
        } else {
          await supabase.from("treasury_fund_operations").update({
            status: "failed",
            error: "Withdrawal transaction reverted onchain",
            updated_at: now,
          }).eq("id", row.id);
          row.status = "failed";
          row.error = "Withdrawal transaction reverted onchain";
        }
      } catch {
        // A missing receipt is expected while the transaction is pending.
      }
    }
  }
  return rows;
}

async function confirmWithdrawal(env: Env, row: TreasuryFundOperationRow, now = new Date().toISOString()) {
  const supabase = getSupabase(env);
  const attributionVerified = row.tx_hash
    ? await verifyOperationAttribution(env, row.tx_hash as Hex)
    : false;
  if (row.position_ids?.length) {
    const { error: positionError } = await supabase
      .from("treasury_quant_positions")
      .update({
        status: "failed",
        close_reason: "manual_withdrawal",
        exit_tx_hash: row.tx_hash,
        closed_at: now,
      })
      .in("id", row.position_ids)
      .in("status", ["open", "closing"]);
    if (positionError) throw new ApiError(500, "INTERNAL_ERROR", positionError.message);

    await supabase.from("treasury_quant_audit").insert(row.position_ids.map((positionId) => ({
      event_type: "position_manual_withdrawal",
      position_id: positionId,
      details: {
        operationId: row.id,
        asset: row.asset,
        amount: String(row.amount),
        destination: row.destination_address,
        txHash: row.tx_hash,
      },
    })));
  }
  const { error } = await supabase.from("treasury_fund_operations").update({
    status: "confirmed",
    confirmed_at: now,
    updated_at: now,
    error: null,
    attribution_verified: attributionVerified,
  }).eq("id", row.id);
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
  row.status = "confirmed";
  row.confirmed_at = now;
  row.updated_at = now;
  row.attribution_verified = attributionVerified;
}

export async function getTreasuryFunds(env: Env) {
  const address = executorAddress(env);
  const supabase = getSupabase(env);
  const [{ data: addresses, error: addressError }, { data: operations, error: operationError }, reserved] = await Promise.all([
    supabase.from("treasury_withdrawal_addresses").select("*").order("created_at", { ascending: false }),
    supabase.from("treasury_fund_operations").select("*").order("created_at", { ascending: false }).limit(100),
    reservedByAsset(env),
  ]);
  if (addressError) throw new ApiError(500, "INTERNAL_ERROR", addressError.message);
  if (operationError) throw new ApiError(500, "INTERNAL_ERROR", operationError.message);

  const balances = await Promise.all(TREASURY_FUND_ASSETS.map(async (asset) => {
    if (!address) return { asset, balance: "unavailable", reserved: "0", available: "0" };
    try {
      const decimals = await assetDecimals(env, asset);
      const balance = await assetBalance(env, asset, address);
      const reservedUnits = reserved.get(asset) ?? 0n;
      const gasReserve = asset === "CELO"
        ? parseUnits(env.TREASURY_MIN_CELO_GAS_RESERVE ?? "0.05", decimals)
        : 0n;
      return {
        asset,
        balance: formatUnits(balance, decimals),
        reserved: formatUnits(reservedUnits, decimals),
        available: formatUnits(calculateAvailableUnits(balance, reservedUnits, gasReserve), decimals),
      };
    } catch {
      return { asset, balance: "unavailable", reserved: "0", available: "0" };
    }
  }));

  const synced = await syncFundOperations(env, (operations ?? []) as TreasuryFundOperationRow[]);
  return {
    enabled: env.TREASURY_FUNDS_ENABLED === "true",
    chainId: env.CHAIN_ID,
    walletAddress: address,
    attributionCode: attributionCode(env),
    balances,
    addresses: ((addresses ?? []) as TreasuryWithdrawalAddressRow[]).map(serializeAddress),
    operations: synced.map(serializeOperation),
  };
}

export async function createTreasuryDepositLink(
  env: Env,
  input: { requestId?: string; amount: string; token: Stablecoin; description?: string },
) {
  requireFundsEnabled(env);
  const recipient = executorAddress(env);
  if (!recipient) throw new ApiError(409, "TREASURY_EXECUTOR_UNAVAILABLE", "Treasury executor is not configured");
  const amount = normalizeFundAmount(input.amount, KNOWN_TREASURY_ASSET_DECIMALS[input.token]!);
  const requestId = input.requestId ?? `deposit:${randomUUID()}`;
  const supabase = getSupabase(env);
  const { data: existing } = await supabase.from("treasury_fund_operations").select("*").eq("request_id", requestId).maybeSingle();
  if (existing) return serializeOperation(existing as TreasuryFundOperationRow);

  const amountUnits = parseUnits(amount, KNOWN_TREASURY_ASSET_DECIMALS[input.token]!);
  const { publicClient } = createChainClients(env);
  const feeBps = await publicClient.readContract({
    address: env.PAYGRID_ROUTER_ADDRESS,
    abi: paygridRouterAbiConst,
    functionName: "feeBps",
  }) as bigint;
  const feeUnits = amountUnits * feeBps / 10_000n;
  const link = await createPaymentLink(env, {
    amount,
    token: input.token,
    description: input.description?.trim() || `Treasury funding · ${input.token}`,
    acceptedMethods: ["crypto"],
    recipientAddress: recipient,
  });
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("treasury_fund_operations").insert({
    request_id: requestId,
    operation_type: "deposit",
    asset: input.token,
    amount,
    destination_address: recipient.toLowerCase(),
    payment_link_id: link.id,
    creation_tx_hash: link.txHash,
    status: "active",
    attribution_code: attributionCode(env),
    updated_at: now,
  }).select("*").single();
  if (error || !data) throw new ApiError(500, "INTERNAL_ERROR", error?.message ?? "Deposit operation insert failed");
  return {
    ...serializeOperation(data as TreasuryFundOperationRow),
    paymentUrl: link.url,
    creationTxHash: link.txHash,
    feeBps: Number(feeBps),
    fee: formatUnits(feeUnits, KNOWN_TREASURY_ASSET_DECIMALS[input.token]!),
    estimatedNet: formatUnits(amountUnits - feeUnits, KNOWN_TREASURY_ASSET_DECIMALS[input.token]!),
  };
}

export async function createTreasuryWithdrawalAddress(env: Env, input: CreateAddressInput) {
  requireFundsEnabled(env);
  if (!isAddress(input.address)) throw new ApiError(400, "INVALID_ADDRESS", "Enter a valid Celo address");
  if (input.destinationType === "minipay" && !isMiniPayWithdrawalAsset(input.asset)) {
    throw new ApiError(400, "MINIPAY_ASSET_UNSUPPORTED", "MiniPay destinations support USDC, USDT and USDm");
  }
  const { data, error } = await getSupabase(env).from("treasury_withdrawal_addresses").insert({
    label: input.label.trim(),
    address: getAddress(input.address).toLowerCase(),
    destination_type: input.destinationType,
    chain_id: env.CHAIN_ID,
    asset: input.asset,
  }).select("*").single();
  if (error || !data) {
    if (error?.code === "23505") throw new ApiError(409, "DESTINATION_EXISTS", "This destination is already approved for the asset");
    throw new ApiError(500, "INTERNAL_ERROR", error?.message ?? "Destination insert failed");
  }
  return serializeAddress(data as TreasuryWithdrawalAddressRow);
}

export async function deactivateTreasuryWithdrawalAddress(env: Env, id: string) {
  const now = new Date().toISOString();
  const { data, error } = await getSupabase(env).from("treasury_withdrawal_addresses").update({
    active: false,
    deactivated_at: now,
  }).eq("id", id).eq("active", true).select("*").maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
  if (!data) throw new ApiError(404, "NOT_FOUND", "Active destination not found");
  return serializeAddress(data as TreasuryWithdrawalAddressRow);
}

export async function previewTreasuryWithdrawal(env: Env, input: WithdrawalInput) {
  requireFundsEnabled(env);
  const supabase = getSupabase(env);
  const { data: destination, error } = await supabase.from("treasury_withdrawal_addresses")
    .select("*").eq("id", input.withdrawalAddressId).eq("active", true).maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
  if (!destination) throw new ApiError(404, "DESTINATION_NOT_FOUND", "Approved destination not found");
  const addressRow = destination as TreasuryWithdrawalAddressRow;
  if (addressRow.asset !== input.asset || addressRow.chain_id !== env.CHAIN_ID) {
    throw new ApiError(409, "DESTINATION_MISMATCH", "Destination is not approved for this asset and network");
  }
  const decimals = await assetDecimals(env, input.asset);
  const amount = normalizeFundAmount(input.amount, decimals);
  const amountUnits = parseUnits(amount, decimals);
  const owner = executorAddress(env)!;
  const balance = await assetBalance(env, input.asset, owner);
  const { data: positions, error: positionError } = await supabase.from("treasury_quant_positions")
    .select("*").eq("asset", input.asset).in("status", ["open", "closing"]);
  if (positionError) throw new ApiError(500, "INTERNAL_ERROR", positionError.message);
  const positionRows = (positions ?? []) as TreasuryPositionRow[];
  const reserved = positionRows.reduce((sum, position) => sum + parseUnits(String(position.amount_asset), decimals), 0n);
  const gasReserve = input.asset === "CELO"
    ? parseUnits(env.TREASURY_MIN_CELO_GAS_RESERVE ?? "0.05", decimals)
    : 0n;
  const available = calculateAvailableUnits(balance, reserved, gasReserve);

  if (input.mode === "free" && amountUnits > available) {
    throw new ApiError(409, "INSUFFICIENT_FREE_BALANCE", "Amount exceeds the balance not reserved by open positions");
  }
  if (input.mode === "evacuate") {
    const { data: control, error: controlError } = await supabase.from("treasury_quant_control")
      .select("paused").eq("id", "global").single();
    if (controlError) throw new ApiError(500, "INTERNAL_ERROR", controlError.message);
    if (!control.paused) throw new ApiError(409, "TREASURY_NOT_PAUSED", "Pause the Treasury agent before evacuating positions");
    if (amountUnits < reserved) {
      throw new ApiError(409, "PARTIAL_EVACUATION", "Evacuation amount must cover every reserved position for the asset");
    }
    if (positionRows.some((position) => position.status === "closing")) {
      throw new ApiError(409, "POSITION_EXIT_PENDING", "A position already has a close in progress");
    }
  }
  if (amountUnits + gasReserve > balance) {
    throw new ApiError(409, "INSUFFICIENT_BALANCE", "Treasury balance is insufficient after preserving the network-fee reserve");
  }

  return {
    requestId: input.requestId,
    asset: input.asset,
    amount,
    mode: input.mode,
    destination: serializeAddress(addressRow),
    balance: formatUnits(balance, decimals),
    reserved: formatUnits(reserved, decimals),
    available: formatUnits(available, decimals),
    gasReserve: formatUnits(gasReserve, decimals),
    positionIds: input.mode === "evacuate" ? positionRows.map((position) => position.id) : [],
    attributionCode: attributionCode(env),
  };
}

export async function executeTreasuryWithdrawal(env: Env, input: WithdrawalInput) {
  requireFundsEnabled(env);
  return withTreasuryExecutionLease(env, `withdrawal:${input.requestId}`, () => (
    executeTreasuryWithdrawalWithLease(env, input)
  ));
}

async function executeTreasuryWithdrawalWithLease(env: Env, input: WithdrawalInput) {
  const supabase = getSupabase(env);
  const { data: existing, error: existingError } = await supabase.from("treasury_fund_operations")
    .select("*").eq("request_id", input.requestId).maybeSingle();
  if (existingError) throw new ApiError(500, "INTERNAL_ERROR", existingError.message);
  if (existing) return serializeOperation(existing as TreasuryFundOperationRow);

  const preview = await previewTreasuryWithdrawal(env, input);
  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabase.from("treasury_fund_operations").insert({
    request_id: input.requestId,
    operation_type: "withdrawal",
    asset: input.asset,
    amount: preview.amount,
    destination_address: preview.destination.address.toLowerCase(),
    withdrawal_address_id: input.withdrawalAddressId,
    mode: input.mode,
    status: "pending",
    attribution_code: attributionCode(env),
    position_ids: preview.positionIds,
    updated_at: now,
  }).select("*").single();
  if (insertError || !inserted) {
    if (insertError?.code === "23505") {
      const { data: raced } = await supabase.from("treasury_fund_operations").select("*").eq("request_id", input.requestId).single();
      return serializeOperation(raced as TreasuryFundOperationRow);
    }
    throw new ApiError(500, "INTERNAL_ERROR", insertError?.message ?? "Withdrawal operation insert failed");
  }
  const row = inserted as TreasuryFundOperationRow;

  const account = privateKeyToAccount(env.TREASURY_EXECUTOR_PRIVATE_KEY!);
  const { publicClient, walletClient } = createChainClients(env, env.TREASURY_EXECUTOR_PRIVATE_KEY);
  const decimals = await assetDecimals(env, input.asset);
  const amountUnits = parseUnits(preview.amount, decimals);
  let hash: Hex;
  try {
    if (input.asset === "CELO") {
      hash = await walletClient.sendTransaction({
        account,
        to: preview.destination.address,
        value: amountUnits,
        data: withServerAttribution(env, "0x"),
      });
    } else {
      const transferData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [preview.destination.address, amountUnits],
      });
      hash = await walletClient.sendTransaction({
        account,
        to: configuredAssetAddress(env, input.asset),
        value: 0n,
        data: withServerAttribution(env, transferData),
      });
    }
  } catch (sendError) {
    const message = sendError instanceof Error ? sendError.message : String(sendError);
    await supabase.from("treasury_fund_operations").update({ status: "failed", error: message, updated_at: new Date().toISOString() }).eq("id", row.id);
    throw sendError;
  }

  const submittedAt = new Date().toISOString();
  await supabase.from("treasury_fund_operations").update({
    status: "submitted",
    tx_hash: hash,
    submitted_at: submittedAt,
    updated_at: submittedAt,
  }).eq("id", row.id);
  row.status = "submitted";
  row.tx_hash = hash;
  row.submitted_at = submittedAt;

  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      const failure = "Withdrawal transaction reverted onchain";
      await supabase.from("treasury_fund_operations").update({ status: "failed", error: failure, updated_at: new Date().toISOString() }).eq("id", row.id);
      row.status = "failed";
      row.error = failure;
      return serializeOperation(row);
    }
    await confirmWithdrawal(env, row);
  } catch {
    // Keep submitted: a later funds read reconciles the receipt idempotently.
  }
  return serializeOperation(row);
}
