import { x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402Client } from "@x402/fetch";
import { ExactEvmScheme as ExactServer } from "@x402/evm/exact/server";
import {
  ExactEvmScheme as ExactClient,
  getPermit2AllowanceReadParams,
} from "@x402/evm/exact/client";
import {
  x402ExactPermit2ProxyAddress,
  x402ExactPermit2ProxyABI,
} from "@x402/evm";
import {
  declarePaymentIdentifierExtension,
  paymentIdentifierResourceServerExtension,
} from "@x402/extensions/payment-identifier";
import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  keccak256,
  toBytes,
  erc20Abi,
  http,
  parseAbi,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";
import { PERMIT2, type Config } from "./config.js";
import { X402Error, type Protocol } from "./types.js";
import { authorization } from "./security.js";

export const declaredExtensions = {
  "payment-identifier": declarePaymentIdentifierExtension(),
  eip2612GasSponsoring: {
    info: {
      description: "Sponsor an exact EIP-2612 permit to Permit2",
      version: "1",
    },
  },
};
export class CeloProtocol implements Protocol {
  readonly rpc;
  readonly facilitator;
  private server;
  private init?: Promise<void>;
  constructor(private cfg: Config) {
    this.rpc = createPublicClient({
      transport: http(cfg.rpcUrl, { timeout: 20_000, retryCount: 1 }),
    });
    this.facilitator = new HTTPFacilitatorClient({
      url: cfg.facilitatorUrl,
      timeoutMs: 90_000,
      createAuthHeaders: async () => {
        const headers: Record<string, string> = cfg.apiKey
          ? { "X-API-Key": cfg.apiKey }
          : {};
        return { verify: headers, settle: headers, supported: headers };
      },
    });
    this.server = new x402ResourceServer(this.facilitator)
      .register(cfg.network, new ExactServer())
      .registerExtension(paymentIdentifierResourceServerExtension);
  }
  private async initialize() {
    if (!this.init)
      this.init = this.server.initialize().catch((error) => {
        this.init = undefined;
        throw error;
      });
    await this.init;
  }
  async preflight() {
    const chain = await this.rpc.getChainId();
    if (chain !== this.cfg.chainId)
      throw new Error("RPC chain does not match x402 configuration");
    const supported = await this.facilitator.getSupported();
    const exact = supported.kinds.find(
      (k) =>
        k.x402Version === 2 &&
        k.network === this.cfg.network &&
        k.scheme === "exact",
    );
    if (!exact)
      throw new Error(
        "Facilitator does not advertise exact v2 on the configured network",
      );
    const extra = exact.extra as Record<string, unknown> | undefined;
    const supportedAssets = extra?.supportedAssets as
      | { asset: string }[]
      | undefined;
    for (const asset of this.cfg.assets) {
      if (
        !supportedAssets?.some(
          (a) => a.asset.toLowerCase() === asset.address.toLowerCase(),
        )
      )
        throw new Error("Facilitator asset support is missing: " + asset.token);
      const decimals = await this.rpc.readContract({
        address: asset.address as Address,
        abi: erc20Abi,
        functionName: "decimals",
      });
      if (decimals !== asset.decimals)
        throw new Error("Token decimals mismatch: " + asset.token);
    }
    if (
      this.cfg.assets.some((a) => a.method === "permit2") &&
      !supported.extensions.includes("eip2612GasSponsoring")
    )
      throw new Error("Facilitator Permit2 sponsoring is unavailable");
    return {
      chainId: chain,
      network: this.cfg.network,
      facilitator: this.cfg.facilitatorUrl,
      assets: this.cfg.assets.map((a) => a.token),
    };
  }
  async requirements(): Promise<PaymentRequired> {
    await this.initialize();
    if (!this.cfg.payTo)
      throw new X402Error(
        503,
        "X402_UNAVAILABLE",
        "Seller payout address is not configured",
      );
    const accepts = (
      await Promise.all(
        this.cfg.assets.map((asset) =>
          this.server.buildPaymentRequirements({
            scheme: "exact",
            network: this.cfg.network,
            payTo: this.cfg.payTo!,
            maxTimeoutSeconds: 120,
            price: {
              amount: asset.price,
              asset: asset.address,
              extra: {
                name: asset.name,
                version: asset.version,
                assetTransferMethod: asset.method,
                paymentFlow: "upfront",
              },
            },
          }),
        ),
      )
    ).flat();
    return this.server.createPaymentRequiredResponse(
      accepts,
      {
        url: this.cfg.publicApiUrl + "/api/x402/data",
        description: "Paygrid paid API reference",
        mimeType: "application/json",
      },
      undefined,
      declaredExtensions,
    );
  }
  async balance(asset: string) {
    if (!this.cfg.payerAddress) throw new Error("Payer address is missing");
    return this.rpc.readContract({
      address: asset as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [this.cfg.payerAddress],
    });
  }
  async sign(
    required: PaymentRequired,
    selected: PaymentRequirements,
  ): Promise<PaymentPayload> {
    if (!this.cfg.payerKey)
      throw new X402Error(
        503,
        "X402_UNAVAILABLE",
        "Payer signer is unavailable",
      );
    if (selected.maxTimeoutSeconds <= 0 || selected.maxTimeoutSeconds > 120)
      throw new X402Error(
        403,
        "POLICY_DENIED",
        "Authorization validity must not exceed 120 seconds",
      );
    const account = privateKeyToAccount(this.cfg.payerKey);
    const asset = this.cfg.assets.find(
      (a) => a.address.toLowerCase() === selected.asset.toLowerCase(),
    )!;
    if ((await this.balance(asset.address)) < BigInt(selected.amount))
      throw new X402Error(
        409,
        "INSUFFICIENT_BALANCE",
        "Payer token balance is insufficient",
      );
    if (asset.method === "permit2") {
      const allowance = await this.rpc.readContract(
        getPermit2AllowanceReadParams({
          tokenAddress: asset.address as Address,
          ownerAddress: account.address,
        }),
      );
      if (
        allowance < BigInt(selected.amount) &&
        !required.extensions?.eip2612GasSponsoring
      )
        throw new X402Error(
          412,
          "PERMIT2_ALLOWANCE_REQUIRED",
          "Merchant must advertise EIP-2612 sponsoring or provide sufficient Permit2 allowance",
        );
    }
    const signer = {
      address: account.address,
      signTypedData: async (args: any) => {
        const d = args.domain,
          m = args.message;
        if (Number(d.chainId) !== this.cfg.chainId)
          throw new X402Error(403, "POLICY_DENIED", "Signer chain mismatch");
        const eq = (a: unknown, b: string) =>
          typeof a === "string" && a.toLowerCase() === b.toLowerCase();
        const exactAmount = (a: unknown) =>
          BigInt(String(a)) === BigInt(selected.amount);
        const expiry = (a: unknown) =>
          Number(a) > Date.now() / 1000 && Number(a) <= Date.now() / 1000 + 125;
        if (args.primaryType === "TransferWithAuthorization") {
          if (
            !eq(d.verifyingContract, asset.address) ||
            d.name !== asset.name ||
            d.version !== asset.version ||
            !eq(m.from, account.address) ||
            !eq(m.to, selected.payTo) ||
            !exactAmount(m.value) ||
            !expiry(m.validBefore)
          )
            throw new X402Error(
              403,
              "POLICY_DENIED",
              "Transfer authorization differs from reserved payment",
            );
        } else if (args.primaryType === "PermitWitnessTransferFrom") {
          if (
            !eq(d.verifyingContract, PERMIT2) ||
            d.name !== "Permit2" ||
            !eq(m.permitted.token, asset.address) ||
            !exactAmount(m.permitted.amount) ||
            !eq(m.spender, x402ExactPermit2ProxyAddress) ||
            !eq(m.witness.to, selected.payTo) ||
            !expiry(m.deadline)
          )
            throw new X402Error(
              403,
              "POLICY_DENIED",
              "Permit2 authorization differs from reserved payment",
            );
        } else if (args.primaryType === "Permit") {
          if (
            !eq(d.verifyingContract, asset.address) ||
            d.name !== asset.name ||
            d.version !== asset.version ||
            !eq(m.owner, account.address) ||
            !eq(m.spender, PERMIT2) ||
            !exactAmount(m.value) ||
            !expiry(m.deadline)
          )
            throw new X402Error(
              403,
              "POLICY_DENIED",
              "Sponsorship permit differs from reserved payment",
            );
        } else
          throw new X402Error(
            403,
            "POLICY_DENIED",
            "Unsupported signature type",
          );
        return account.signTypedData(args);
      },
    };
    const client = new x402Client();
    client.setSpendControls({
      allowedAssets: [
        {
          network: this.cfg.network,
          asset: asset.address,
          maxAmountPerPayment: asset.perPayment,
        },
      ],
    });
    client.register(
      this.cfg.network,
      new ExactClient(signer, { rpcUrl: this.cfg.rpcUrl }),
    );
    const payload = await client.createPaymentPayload({
      ...required,
      accepts: [selected],
    });
    const auth = authorization(payload);
    if (auth.payer.toLowerCase() !== account.address.toLowerCase())
      throw new X402Error(403, "POLICY_DENIED", "Unexpected payer");
    return payload;
  }
  async verify(payload: PaymentPayload, requirement: PaymentRequirements) {
    // Call the facilitator explicitly as upfront flows skip the SDK's optional verify phase.
    const verified = await this.facilitator.verify(payload, requirement);
    if (!verified.isValid)
      throw new X402Error(
        402,
        "INVALID_PAYMENT",
        "Payment authorization was rejected",
      );
  }
  async settle(payload: PaymentPayload, requirement: PaymentRequirements) {
    await this.initialize();
    return this.server.settlePayment(
      payload,
      requirement,
      declaredExtensions,
      undefined,
      undefined,
      "before-handler",
    );
  }
  async confirm(
    receipt: SettleResponse,
    requirement: PaymentRequirements,
    payer: string,
    payload: PaymentPayload,
  ) {
    if ((await this.rpc.getChainId()) !== this.cfg.chainId)
      throw new Error("RPC chain mismatch during confirmation");
    if (
      !receipt.success ||
      receipt.network !== this.cfg.network ||
      !/^0x[0-9a-f]{64}$/i.test(receipt.transaction) ||
      receipt.payer?.toLowerCase() !== payer.toLowerCase()
    )
      throw new Error("Settlement receipt does not match payment");
    const mined = await this.rpc.getTransactionReceipt({
      hash: receipt.transaction as `0x${string}`,
    });
    if (mined.status !== "success")
      throw new Error("Settlement transaction did not succeed");
    const signed = payload.payload as Record<string, any>;
    if (signed.authorization) {
      const topic = keccak256(toBytes("AuthorizationUsed(address,bytes32)"));
      if (
        !mined.logs.some(
          (log) =>
            log.address.toLowerCase() === requirement.asset.toLowerCase() &&
            log.topics[0] === topic &&
            log.topics[1]?.toLowerCase() ===
              "0x" + payer.slice(2).toLowerCase().padStart(64, "0") &&
            log.topics[2]?.toLowerCase() ===
              String(signed.authorization.nonce).toLowerCase(),
        )
      )
        throw new Error("Receipt belongs to a different authorization nonce");
    } else if (signed.permit2Authorization) {
      const tx = await this.rpc.getTransaction({
        hash: receipt.transaction as `0x${string}`,
      });
      if (tx.to?.toLowerCase() !== x402ExactPermit2ProxyAddress.toLowerCase())
        throw new Error("Unexpected Permit2 settlement target");
      const decoded = decodeFunctionData({
        abi: x402ExactPermit2ProxyABI,
        data: tx.input,
      });
      if (!["settle", "settleWithPermit"].includes(decoded.functionName))
        throw new Error("Unsupported Permit2 settlement call");
      const args = decoded.args as readonly any[],
        offset = decoded.functionName === "settleWithPermit" ? 1 : 0;
      const permit = args[offset],
        owner = args[offset + 1],
        witness = args[offset + 2],
        signature = args[offset + 3];
      if (
        BigInt(permit.nonce) !== BigInt(signed.permit2Authorization.nonce) ||
        owner.toLowerCase() !== payer.toLowerCase() ||
        witness.to.toLowerCase() !== requirement.payTo.toLowerCase() ||
        signature.toLowerCase() !== String(signed.signature).toLowerCase()
      )
        throw new Error("Receipt belongs to a different Permit2 authorization");
    } else throw new Error("Missing settlement authorization");

    const transfers = mined.logs
      .filter(
        (log) => log.address.toLowerCase() === requirement.asset.toLowerCase(),
      )
      .flatMap((log) => {
        try {
          const event = decodeEventLog({
            abi: erc20Abi,
            data: log.data,
            topics: log.topics,
          });
          return event.eventName === "Transfer" ? [event.args] : [];
        } catch {
          return [];
        }
      });
    if (
      !transfers.some(
        (t) =>
          t.from.toLowerCase() === payer.toLowerCase() &&
          t.to.toLowerCase() === requirement.payTo.toLowerCase() &&
          t.value === BigInt(requirement.amount),
      )
    )
      throw new Error("Expected token transfer is missing");
  }
  async expiredUnused(
    payload: PaymentPayload,
    requirement: PaymentRequirements,
  ) {
    if ((await this.rpc.getChainId()) !== this.cfg.chainId)
      throw new Error("RPC chain mismatch during expiry reconciliation");
    const auth = authorization(payload),
      block = await this.rpc.getBlock({ blockTag: "latest" });
    if (block.timestamp <= BigInt(auth.expiry) + 12n) return false;
    const p = payload.payload as Record<string, any>;
    if (p.permit2Authorization) {
      const nonce = BigInt(p.permit2Authorization.nonce);
      const bitmap = await this.rpc.readContract({
        address: PERMIT2,
        abi: parseAbi([
          "function nonceBitmap(address,uint256) view returns (uint256)",
        ]),
        functionName: "nonceBitmap",
        args: [auth.payer as Address, nonce >> 8n],
      });
      return (bitmap & (1n << (nonce & 255n))) === 0n;
    }
    return !(await this.rpc.readContract({
      address: requirement.asset as Address,
      abi: parseAbi([
        "function authorizationState(address,bytes32) view returns (bool)",
      ]),
      functionName: "authorizationState",
      args: [auth.payer as Address, p.authorization.nonce],
    }));
  }
}
