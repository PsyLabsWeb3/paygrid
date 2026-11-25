import "dotenv/config";
import { config as loadX402Env } from "dotenv";
loadX402Env({ path: process.env.X402_ENV_FILE ?? ".env.x402" });

export type X402Token = "USDC" | "USDT" | "wMXN";
export type X402PaymentResult = {
  operationId: string;
  state: "pending" | "settled" | "failed" | "unknown";
  paid: boolean;
  payment: {
    network: string;
    asset: string;
    token: X402Token;
    amountAtomic: string;
    payer: string;
    payTo: string;
    txHash?: string;
  } | null;
  result: { httpStatus: number; body: string; contentType: string } | null;
  resultExpired: boolean;
  error: string | null;
};
type Options = {
  url?: string;
  path?: string;
  method?: "GET" | "POST";
  body?: unknown;
  preferredToken?: X402Token;
  idempotencyKey: string;
  fetchImpl?: typeof fetch;
};
function executorConfig() {
  const backend = process.env.BACKEND_URL ?? "http://localhost:3001";
  const key = process.env.X402_EXECUTOR_API_KEY;
  if (!key)
    throw new Error(
      "X402_EXECUTOR_API_KEY is required; agent wallets never sign x402 payments locally",
    );
  return { backend, key };
}
async function executor(
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
) {
  const { backend, key } = executorConfig();
  const response = await fetchImpl(new URL(path, backend), {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${key}`,
      ...init.headers,
    },
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      `x402 executor returned ${response.status}: ${body?.error?.message ?? "Request failed"}`,
    );
  return body;
}
export async function fetchX402Endpoint(
  options: Options,
): Promise<X402PaymentResult> {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(options.idempotencyKey))
    throw new Error("A stable Idempotency-Key is required");
  const url =
    options.url ??
    new URL(
      options.path ?? "/api/x402/data",
      process.env.X402_PUBLIC_API_URL ?? "https://api.celopaygrid.xyz",
    ).href;
  return executor(
    "/api/x402/pay",
    {
      method: "POST",
      headers: { "Idempotency-Key": options.idempotencyKey },
      body: JSON.stringify({
        url,
        method: options.method ?? "GET",
        body: options.body,
        preferredToken: options.preferredToken,
      }),
    },
    options.fetchImpl,
  );
}
export async function getX402PaymentStatus(
  operationId: string,
): Promise<X402PaymentResult> {
  return executor("/api/x402/payments/" + encodeURIComponent(operationId));
}
export async function getX402Capabilities() {
  const response = await fetch(
    new URL(
      "/api/x402/capabilities",
      process.env.BACKEND_URL ?? "http://localhost:3001",
    ),
    { redirect: "error", signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) throw new Error("x402 capabilities unavailable");
  return response.json();
}
