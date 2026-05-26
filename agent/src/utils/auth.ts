import { account, ERC8004_AGENT_ID, BACKEND_URL } from "../wallet";
import crypto from "crypto";

export async function fetchWithAgentAuth(path: string, options: RequestInit = {}) {
  const url = new URL(path, BACKEND_URL);
  
  const method = (options.method || "GET").toUpperCase();
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const agentId = ERC8004_AGENT_ID;
  const address = account.address.toLowerCase();
  
  // Format: paygrid:erc8004:<agentId>:<address>:<METHOD>:<path>:<timestamp>:<nonce>
  const message = `paygrid:erc8004:${agentId}:${address}:${method}:${path}:${timestamp}:${nonce}`;
  
  const signature = await account.signMessage({ message });

  const headers = new Headers(options.headers);
  headers.set("x-erc8004-agent-id", agentId as string);
  headers.set("x-erc8004-address", address);
  headers.set("x-erc8004-timestamp", timestamp);
  headers.set("x-erc8004-nonce", nonce);
  headers.set("x-erc8004-signature", signature);

  return fetch(url.toString(), {
    ...options,
    headers,
  });
}
