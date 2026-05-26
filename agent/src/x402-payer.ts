import { createThirdwebClient, defineChain } from "thirdweb";
import { viemAdapter } from "thirdweb/adapters/viem";
import { wrapFetchWithPayment } from "thirdweb/x402";

import { account, BACKEND_URL, CHAIN_ID, walletClient } from "./wallet";

export type X402Token = "USDC" | "USDT" | "USDm";

export type X402Proof = {
  resource: string;
  chainId: number;
  token: X402Token;
  amount: string;
  txHash: `0x${string}`;
  payer: `0x${string}`;
  paidAt: string;
};

export type X402Trace = {
  endpoint: string;
  chainId: number;
  token: X402Token;
  amount: string;
  txHash: `0x${string}`;
  payer: `0x${string}`;
};

type PaygridChallengeDetails = {
  resource: string;
  chainId: number;
  token: X402Token;
  amount: string;
  recipient?: string | null;
  proofHeader?: string;
};

type FetchX402EndpointOptions = {
  path?: string;
  method?: "GET" | "POST";
  maxRetries?: number;
  retryDelayMs?: number;
  txHash?: `0x${string}`;
  fetchImpl?: typeof fetch;
};

export type X402PaymentResult = {
  data: unknown;
  proof: X402Proof;
  trace: X402Trace;
};

const DEFAULT_X402_PATH = "/api/x402/data";
const PAYGRID_PROOF_HEADER = "x-paygrid-x402-proof";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(path: string) {
  return new URL(path, BACKEND_URL).toString();
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getChallengeDetails(body: unknown): PaygridChallengeDetails {
  const details = (body as any)?.error?.details?.challenge?.error?.details;
  if (!details) {
    throw new Error("x402 challenge response is missing payment details");
  }

  const { resource, chainId, token, amount, recipient, proofHeader } = details;
  if (!resource || !chainId || !token || !amount) {
    throw new Error("x402 challenge is missing resource, chainId, token, or amount");
  }

  if (!["USDC", "USDT", "USDm"].includes(token)) {
    throw new Error(`Unsupported x402 token: ${token}`);
  }

  return { resource, chainId, token, amount, recipient, proofHeader };
}

function defaultTestTxHash(): `0x${string}` {
  const timestampHex = BigInt(Date.now()).toString(16).padStart(64, "0");
  return `0x${timestampHex}`;
}

function buildProof(challenge: PaygridChallengeDetails, txHash?: `0x${string}`): X402Proof {
  return {
    resource: challenge.resource,
    chainId: challenge.chainId,
    token: challenge.token,
    amount: challenge.amount,
    txHash: txHash ?? (process.env.X402_TEST_TX_HASH as `0x${string}` | undefined) ?? defaultTestTxHash(),
    payer: account.address,
    paidAt: new Date().toISOString(),
  };
}

function logX402Trace(trace: X402Trace) {
  console.info(JSON.stringify({ event: "x402_payment", ...trace }));
}

async function retry<T>(
  operation: () => Promise<T>,
  options: { maxRetries: number; retryDelayMs: number; label: string },
) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === options.maxRetries) {
        break;
      }
      await sleep(options.retryDelayMs * (attempt + 1));
    }
  }

  throw new Error(`${options.label} failed after ${options.maxRetries + 1} attempts: ${(lastError as Error)?.message ?? String(lastError)}`);
}

export async function createThirdwebX402Fetch() {
  const secretKey = process.env.THIRDWEB_SECRET_KEY;
  if (!secretKey) {
    return null;
  }

  const client = createThirdwebClient({ secretKey });
  const wallet = viemAdapter.wallet.fromViem({ walletClient: walletClient as any });
  const chain = defineChain(CHAIN_ID);

  await wallet.switchChain(chain);
  return wrapFetchWithPayment(fetch, client, wallet);
}

export async function fetchX402Endpoint(options: FetchX402EndpointOptions = {}): Promise<X402PaymentResult> {
  const {
    path = DEFAULT_X402_PATH,
    method = "GET",
    maxRetries = 2,
    retryDelayMs = 500,
    txHash,
    fetchImpl = fetch,
  } = options;

  const url = buildUrl(path);

  const firstResponse = await retry(
    () => fetchImpl(url, { method }),
    { maxRetries, retryDelayMs, label: "Initial x402 request" },
  );

  if (firstResponse.status !== 402) {
    throw new Error(`Expected x402 challenge but received ${firstResponse.status}: ${JSON.stringify(await readJson(firstResponse))}`);
  }

  const challengeBody = await readJson(firstResponse);
  const challenge = getChallengeDetails(challengeBody);
  const proof = buildProof(challenge, txHash);
  const proofHeader = challenge.proofHeader ?? PAYGRID_PROOF_HEADER;

  const paidResponse = await retry(
    () => fetchImpl(url, {
      method,
      headers: {
        [proofHeader]: JSON.stringify(proof),
      },
    }),
    { maxRetries, retryDelayMs, label: "x402 proof retry" },
  );

  const data = await readJson(paidResponse);
  if (!paidResponse.ok) {
    throw new Error(`x402 proof rejected with ${paidResponse.status}: ${JSON.stringify(data)}`);
  }

  const trace = {
    endpoint: path,
    chainId: proof.chainId,
    token: proof.token,
    amount: proof.amount,
    txHash: proof.txHash,
    payer: proof.payer,
  };
  logX402Trace(trace);

  return { data, proof, trace };
}
