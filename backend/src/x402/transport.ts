import dns from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";
import { X402Error, type Request, type Transport } from "./types.js";
import { merchantFor } from "./security.js";
import type { Config } from "./config.js";

export function publicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export class SafeTransport implements Transport {
  constructor(
    private cfg: Config,
    private resolve = dns.lookup,
  ) {}
  async send(
    request: Request,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    merchantFor(this.cfg, request);
    const url = new URL(request.url);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await this.resolve(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw new X402Error(
        403,
        "POLICY_DENIED",
        "Target must resolve exclusively to public IP addresses",
      );
    const pinned = addresses[0];
    // Connect to the validated address, retaining the original hostname for TLS/SNI.
    const dispatcher = new Agent({
      connect: {
        lookup: (_host, options, callback) => {
          if (typeof options === "object" && options.all)
            callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        },
      },
    });
    try {
      const res = await undiciFetch(url, {
        method: request.method,
        headers: { "content-type": "application/json", ...headers },
        body:
          request.body === undefined ? undefined : JSON.stringify(request.body),
        redirect: "manual",
        signal: AbortSignal.timeout(90_000),
        dispatcher,
      });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel();
        throw new X402Error(
          403,
          "POLICY_DENIED",
          "Redirects are not permitted",
        );
      }
      // Keep the dispatcher alive until the streaming response has been consumed.
      const body = res.body;
      const reader = body?.getReader();
      const wrapped = reader
        ? new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                const next = await reader.read();
                if (next.done) {
                  controller.close();
                  await dispatcher.close();
                } else controller.enqueue(next.value);
              } catch (error) {
                controller.error(error);
                await dispatcher.destroy();
              }
            },
            async cancel(reason) {
              await reader.cancel(reason).catch(() => {});
              await dispatcher.destroy();
            },
          })
        : null;
      if (!body) await dispatcher.close();
      return new Response(wrapped, {
        status: res.status,
        headers: res.headers,
      });
    } catch (error) {
      await dispatcher.destroy();
      throw error;
    }
  }
}
