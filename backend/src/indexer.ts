import { loadEnv } from "./config/env.js";
import { createChainClients, paygridRouterAbiConst } from "./lib/chain.js";
import { giftVaultAbi } from "./lib/gifts.js";
import { getSupabase } from "./db/supabase.js";
import {
  handleGiftClaimed,
  handleGiftClosed,
  handleGiftCreated,
  handlePaymentReceived,
} from "./services/indexer-handler.js";

const env = loadEnv();
const { publicClient } = createChainClients(env);

console.log("[indexer] watching PaymentReceived on", env.PAYGRID_ROUTER_ADDRESS);

const checkpointStream = "paygrid-main";
const supabase = getSupabase(env);
const { data: checkpoint } = await supabase
  .from("indexer_checkpoints")
  .select("block_number")
  .eq("stream", checkpointStream)
  .maybeSingle();
let lastScannedBlock = checkpoint?.block_number != null
  ? BigInt(checkpoint.block_number)
  : env.INDEXER_START_BLOCK !== undefined
    ? BigInt(env.INDEXER_START_BLOCK)
    : await publicClient.getBlockNumber();
let scanning = false;

console.log("[indexer] starting from block", lastScannedBlock.toString());

async function scanPaymentReceived() {
  if (scanning) return;
  scanning = true;
  try {
    const latestBlock = await publicClient.getBlockNumber();
    if (latestBlock <= lastScannedBlock) return;
    const scanToBlock = latestBlock - lastScannedBlock > 9_999n
      ? lastScannedBlock + 9_999n
      : latestBlock;

    const logs = await publicClient.getContractEvents({
      address: env.PAYGRID_ROUTER_ADDRESS,
      abi: paygridRouterAbiConst,
      eventName: "PaymentReceived",
      fromBlock: lastScannedBlock + 1n,
      toBlock: scanToBlock,
    });

    for (const log of logs) {
      if (!("args" in log) || !log.args || !log.transactionHash) continue;
      const args = log.args as {
        linkId: bigint;
        payer: `0x${string}`;
        token: `0x${string}`;
        amount: bigint;
        fee: bigint;
        method: number;
      };
      await handlePaymentReceived(env, {
        linkId: args.linkId,
        payer: args.payer,
        token: args.token,
        amount: args.amount,
        fee: args.fee,
        method: args.method,
        transactionHash: log.transactionHash,
      });
    }

    if (env.PAYGRID_GIFT_VAULT_ADDRESS) {
      const giftCreatedLogs = await publicClient.getContractEvents({
        address: env.PAYGRID_GIFT_VAULT_ADDRESS,
        abi: giftVaultAbi,
        eventName: "GiftCreated",
        fromBlock: lastScannedBlock + 1n,
        toBlock: scanToBlock,
      });
      for (const log of giftCreatedLogs) {
        if (!log.transactionHash || !log.args.giftId || !log.args.sender || !log.args.claimHash) continue;
        await handleGiftCreated(env, {
          giftId: log.args.giftId,
          sender: log.args.sender,
          claimHash: log.args.claimHash,
          transactionHash: log.transactionHash,
        });
      }

      const giftClaimedLogs = await publicClient.getContractEvents({
        address: env.PAYGRID_GIFT_VAULT_ADDRESS,
        abi: giftVaultAbi,
        eventName: "GiftClaimed",
        fromBlock: lastScannedBlock + 1n,
        toBlock: scanToBlock,
      });
      for (const log of giftClaimedLogs) {
        if (!log.transactionHash || !log.args.giftId || !log.args.recipient) continue;
        await handleGiftClaimed(env, {
          giftId: log.args.giftId,
          recipient: log.args.recipient,
          transactionHash: log.transactionHash,
        });
      }

      for (const eventName of ["GiftCancelled", "GiftRefunded"] as const) {
        const closedLogs = await publicClient.getContractEvents({
          address: env.PAYGRID_GIFT_VAULT_ADDRESS,
          abi: giftVaultAbi,
          eventName,
          fromBlock: lastScannedBlock + 1n,
          toBlock: scanToBlock,
        });
        for (const log of closedLogs) {
          if (!log.transactionHash || !log.args.giftId) continue;
          await handleGiftClosed(env, {
            giftId: log.args.giftId,
            status: eventName === "GiftCancelled" ? "cancelled" : "refunded",
            transactionHash: log.transactionHash,
          });
        }
      }
    }

    lastScannedBlock = scanToBlock;
    await supabase.from("indexer_checkpoints").upsert({
      stream: checkpointStream,
      block_number: scanToBlock.toString(),
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[indexer] subscription error", error);
  } finally {
    scanning = false;
  }
}

setInterval(() => {
  void scanPaymentReceived();
}, 5_000);
