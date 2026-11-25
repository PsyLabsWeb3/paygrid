import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { X402Error, type Request, type Result } from "./types.js";
import {
  REQUEST_LIMIT,
  RESPONSE_LIMIT,
  type Config,
  type Asset,
} from "./config.js";

function stable(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  return (
    "{" +
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ":" + stable(v))
      .join(",") +
    "}"
  );
}
export function digest(value: unknown) {
  return createHash("sha256").update(stable(value)).digest("hex");
}
export function encrypt(value: unknown, key: string): string {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
export function decrypt<T>(value: string, key: string): T {
  const bytes = Buffer.from(value, "base64"),
    decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(key, "hex"),
      bytes.subarray(0, 12),
    );
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(28)),
      decipher.final(),
    ]).toString(),
  );
}
export function authorized(
  header: string | undefined,
  key: string | undefined,
) {
  if (!key || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7)),
    b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function validateRequest(input: unknown): Request {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new X402Error(400, "VALIDATION_ERROR", "Expected a request object");
  const r = input as Record<string, unknown>;
  if (
    Object.keys(r).some(
      (k) => !["url", "method", "body", "preferredToken"].includes(k),
    )
  )
    throw new X402Error(
      400,
      "VALIDATION_ERROR",
      "Unknown fields; payment headers and signer overrides are forbidden",
    );
  if (typeof r.url !== "string")
    throw new X402Error(400, "VALIDATION_ERROR", "url is required");
  const method = r.method ?? "GET";
  if (
    !["GET", "POST"].includes(String(method)) ||
    (method === "GET" && r.body !== undefined)
  )
    throw new X402Error(
      400,
      "VALIDATION_ERROR",
      "Unsupported method or GET body",
    );
  if (
    r.preferredToken !== undefined &&
    !["USDC", "USDT", "wMXN"].includes(String(r.preferredToken))
  )
    throw new X402Error(400, "INVALID_TOKEN", "Unsupported x402 token");
  if (Buffer.byteLength(JSON.stringify(r)) > REQUEST_LIMIT)
    throw new X402Error(413, "REQUEST_TOO_LARGE", "Request exceeds 64 KiB");
  let url: URL;
  try {
    url = new URL(r.url);
  } catch {
    throw new X402Error(400, "VALIDATION_ERROR", "Invalid URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443")
  )
    throw new X402Error(
      403,
      "POLICY_DENIED",
      "HTTPS origin without credentials or fragment required",
    );
  return {
    url: url.href,
    method: method as Request["method"],
    ...(r.body === undefined ? {} : { body: r.body }),
    ...(r.preferredToken === undefined
      ? {}
      : { preferredToken: r.preferredToken as Request["preferredToken"] }),
  };
}
export function merchantFor(cfg: Config, request: Request) {
  const u = new URL(request.url);
  const merchant = cfg.merchants.find(
    (m) =>
      m.origin === u.origin &&
      m.paths.includes(u.pathname) &&
      m.methods.includes(request.method),
  );
  if (!merchant)
    throw new X402Error(
      403,
      "POLICY_DENIED",
      "Merchant origin, path or method is not authorized",
    );
  return merchant;
}
export function select(
  cfg: Config,
  request: Request,
  accepts: PaymentRequirements[],
): { asset: Asset; requirement: PaymentRequirements } {
  const merchant = merchantFor(cfg, request);
  for (const asset of cfg.assets) {
    if (request.preferredToken && request.preferredToken !== asset.token)
      continue;
    const requirement = accepts.find(
      (r) =>
        r.scheme === "exact" &&
        Number.isInteger(r.maxTimeoutSeconds) &&
        r.maxTimeoutSeconds > 0 &&
        r.maxTimeoutSeconds <= 120 &&
        r.network === cfg.network &&
        r.asset.toLowerCase() === asset.address.toLowerCase() &&
        merchant.payTo.some((a) => a.toLowerCase() === r.payTo.toLowerCase()) &&
        r.payTo.toLowerCase() !== cfg.payerAddress?.toLowerCase() &&
        /^[1-9][0-9]{0,77}$/.test(r.amount) &&
        BigInt(r.amount) <= BigInt(asset.perPayment) &&
        BigInt(r.amount) < 2n ** 256n &&
        (r.extra?.assetTransferMethod ?? "eip3009") === asset.method &&
        ["authorization", "upfront"].includes(
          String(r.extra?.paymentFlow ?? "authorization"),
        ) &&
        r.extra?.name === asset.name &&
        r.extra?.version === asset.version,
    );
    if (requirement) return { asset, requirement };
  }
  throw new X402Error(
    403,
    "POLICY_DENIED",
    "No payment option satisfies token, amount, network, transfer method and recipient policy",
  );
}
export function authorization(payload: PaymentPayload) {
  const p = payload.payload as Record<string, any>,
    r = payload.accepted;
  const permit = p.permit2Authorization;
  const auth = p.authorization;
  const payer = String(auth?.from ?? permit?.from ?? "");
  const rawNonce = String(auth?.nonce ?? permit?.nonce ?? "");
  let nonce: string;
  if (permit) {
    if (!/^[0-9]+$/.test(rawNonce) || BigInt(rawNonce) >= 2n ** 256n)
      throw new X402Error(
        400,
        "INVALID_AUTHORIZATION",
        "Invalid Permit2 nonce",
      );
    nonce = BigInt(rawNonce).toString();
  } else {
    if (!/^0x[0-9a-f]{64}$/i.test(rawNonce))
      throw new X402Error(
        400,
        "INVALID_AUTHORIZATION",
        "Invalid EIP-3009 nonce",
      );
    nonce = rawNonce.toLowerCase();
  }
  const expiry = Number(auth?.validBefore ?? permit?.deadline);
  if (
    !/^0x[0-9a-f]{40}$/i.test(payer) ||
    !nonce ||
    !Number.isSafeInteger(expiry) ||
    expiry <= 0
  )
    throw new X402Error(
      400,
      "INVALID_AUTHORIZATION",
      "Invalid payer, nonce or authorization expiry",
    );
  const contract = permit ? "permit2" : r.asset.toLowerCase();
  return {
    key: `${r.network}:${contract}:${payer.toLowerCase()}:${nonce.toLowerCase()}`,
    payer,
    expiry,
    hash: digest(payload),
  };
}
export function sameTerms(a: PaymentRequirements, b: PaymentRequirements) {
  return digest(a) === digest(b);
}
export async function readResult(response: Response): Promise<Result> {
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (reader)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > RESPONSE_LIMIT)
          throw new X402Error(
            502,
            "RESPONSE_TOO_LARGE",
            "Upstream response exceeds 1 MiB",
          );
        chunks.push(value);
      }
  } catch (error) {
    await reader?.cancel().catch(() => {});
    throw error;
  }
  return {
    httpStatus: response.status,
    body: Buffer.concat(chunks).toString("utf8"),
    contentType:
      response.headers.get("content-type") ?? "application/octet-stream",
  };
}

export function redactResult(result: Result, payload: PaymentPayload): Result {
  const secrets: string[] = [];
  function collect(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (key === "signature" && typeof entry === "string") secrets.push(entry);
      else collect(entry);
    }
  }
  collect(payload);
  secrets.push(Buffer.from(JSON.stringify(payload)).toString("base64"));
  let body = result.body;
  for (const secret of secrets)
    if (secret)
      body = body.replaceAll(secret, "[redacted payment authorization]");
  return { ...result, body };
}
