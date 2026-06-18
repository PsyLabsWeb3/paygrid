import { privateKeyToAccount } from "viem/accounts";

function ensureHexPrivateKey(value) {
  if (!value) return null;
  const key = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) {
    throw new Error("AGENT_PRIVATE_KEY must be a 32-byte hex string");
  }
  return key;
}

export function createAgentSigner(config) {
  const privateKey = ensureHexPrivateKey(config.agentPrivateKey);
  if (!privateKey || !config.agentId) return null;
  return privateKeyToAccount(privateKey);
}

export async function buildAgentAuthHeaders(config, method, path) {
  const account = createAgentSigner(config);
  if (!account) {
    throw new Error("AGENT_PRIVATE_KEY and ERC8004_AGENT_ID are required for write tools");
  }

  const timestamp = Date.now().toString();
  const nonce = crypto.randomUUID();
  const normalizedMethod = method.toUpperCase();
  const address = account.address.toLowerCase();
  const message = `paygrid:erc8004:${config.agentId}:${address}:${normalizedMethod}:${path}:${timestamp}:${nonce}`;
  const signature = await account.signMessage({ message });

  return {
    "x-erc8004-agent-id": String(config.agentId),
    "x-erc8004-address": address,
    "x-erc8004-timestamp": timestamp,
    "x-erc8004-nonce": nonce,
    "x-erc8004-signature": signature,
  };
}

export async function paygridRequest(config, path, init = {}, options = {}) {
  const method = init.method ?? "GET";
  const url = new URL(path, config.backendUrl);
  const headers = {
    "content-type": "application/json",
    ...(init.headers ?? {}),
  };

  if (options.agentAuth) {
    Object.assign(headers, await buildAgentAuthHeaders(config, method, url.pathname));
  }

  const response = await fetch(url.toString(), {
    ...init,
    method,
    headers,
  });
  const body = await response.json().catch(async () => ({ text: await response.text().catch(() => "") }));
  if (!response.ok) {
    const message =
      body?.message ??
      body?.error?.message ??
      (typeof body?.error === "string" ? body.error : undefined) ??
      `Paygrid API returned ${response.status}`;
    throw new Error(message);
  }
  return body;
}
