import assert from "node:assert/strict";
import {
  createPublicClient,
  createWalletClient,
  http,
  erc20Abi,
  keccak256,
  encodeAbiParameters,
  toHex,
  parseSignature,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import {
  eip3009ABI,
  x402ExactPermit2ProxyABI,
  x402ExactPermit2ProxyAddress,
} from "@x402/evm";
import { config, TOKENS, PERMIT2 } from "./x402/config.js";
import { CeloProtocol } from "./x402/protocol.js";
import type { Env } from "./config/env.js";
import type { PaymentRequirements } from "@x402/core/types";

// This command can mutate ONLY an Anvil fork on loopback. It never submits to Celo.
const url = process.env.X402_FORK_RPC ?? "http://127.0.0.1:18546";
const parsed = new URL(url);
assert.ok(
  ["127.0.0.1", "localhost"].includes(parsed.hostname),
  "Fork checks require loopback",
);
const rpc = createPublicClient({ transport: http(url) });
async function raw(method: string, params: unknown[] = []) {
  return rpc.request({ method, params } as any) as Promise<any>;
}
assert.match(await raw("web3_clientVersion"), /anvil/i);
assert.equal(await rpc.getChainId(), 42220);
const snapshot = await raw("evm_snapshot");
try {
  const payerKey = generatePrivateKey(),
    facilitatorKey = generatePrivateKey();
  const payer = privateKeyToAccount(payerKey),
    facilitator = privateKeyToAccount(facilitatorKey);
  const receiver = privateKeyToAccount(generatePrivateKey()).address;
  await raw("anvil_setBalance", [facilitator.address, toHex(10n ** 20n)]);
  const wallet = createWalletClient({
    account: facilitator,
    chain: celo,
    transport: http(url),
  });
  const cfg = config({
    CHAIN_ID: 42220,
    CELO_RPC_URL: url,
    X402_PAYER_PRIVATE_KEY: payerKey,
    X402_PAY_TO: receiver,
  } as unknown as Env);
  const protocol = new CeloProtocol(cfg);
  async function fundToken(token: Address, amount: bigint) {
    // Discover the mapping in fork-local storage; restore every failed candidate.
    const namespace =
      BigInt(
        keccak256(new TextEncoder().encode("openzeppelin.storage.ERC20")),
      ) - 1n;
    const erc7201 =
      BigInt(
        keccak256(encodeAbiParameters([{ type: "uint256" }], [namespace])),
      ) & ~255n;
    for (const index of [
      erc7201,
      ...Array.from({ length: 160 }, (_, i) => BigInt(i)),
    ]) {
      const slot = keccak256(
        encodeAbiParameters(
          [{ type: "address" }, { type: "uint256" }],
          [payer.address, index],
        ),
      );
      const before = await rpc.getStorageAt({ address: token, slot });
      await raw("anvil_setStorageAt", [
        token,
        slot,
        toHex(amount, { size: 32 }),
      ]);
      const balance = await rpc.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [payer.address],
      });
      if (balance === amount) return;
      await raw("anvil_setStorageAt", [
        token,
        slot,
        before ?? toHex(0n, { size: 32 }),
      ]);
    }
    throw new Error("Could not locate fork-local token balance mapping");
  }
  for (const name of ["USDT", "wMXN"] as const) {
    const asset = TOKENS[name],
      amount = BigInt(asset.price),
      token = asset.address as Address;
    await fundToken(token, amount * 3n);
    if (name === "wMXN")
      assert.ok(
        (await rpc.getCode({ address: x402ExactPermit2ProxyAddress }))
          ?.length! > 2,
        "Celo Permit2 proxy must be deployed",
      );
    for (let attempt = 0; attempt < (name === "wMXN" ? 2 : 1); attempt++) {
      const requirement: PaymentRequirements = {
        scheme: "exact",
        network: cfg.network,
        asset: token,
        amount: amount.toString(),
        payTo: receiver,
        maxTimeoutSeconds: 120,
        extra: {
          name: asset.name,
          version: asset.version,
          assetTransferMethod: asset.method,
          paymentFlow: "upfront",
        },
      };
      const payload = await protocol.sign(
        {
          x402Version: 2,
          resource: { url: "https://fork.example/data" },
          accepts: [requirement],
          extensions: { eip2612GasSponsoring: { info: { version: "1" } } },
        },
        requirement,
      );
      const signature = payload.payload.signature as Hex,
        p = payload.payload as Record<string, any>;
      let tx: Hex;
      if (name === "USDT") {
        const a = p.authorization,
          s = parseSignature(signature);
        tx = await wallet.writeContract({
          address: token,
          abi: eip3009ABI,
          functionName: "transferWithAuthorization",
          args: [
            payer.address,
            receiver,
            amount,
            BigInt(a.validAfter),
            BigInt(a.validBefore),
            a.nonce,
            27 + (s.yParity ?? 0),
            s.r,
            s.s,
          ],
          type: "legacy",
          gasPrice: await rpc.getGasPrice(),
        });
      } else {
        const a = p.permit2Authorization,
          extension = payload.extensions?.eip2612GasSponsoring as {
            info: Record<string, string>;
          };
        assert.ok(
          extension?.info,
          "Fresh wallet must receive an EIP-2612 sponsorship permit",
        );
        const info = extension.info,
          s = parseSignature(info.signature as Hex);
        assert.equal(
          info.amount,
          amount.toString(),
          "Allowance must equal the payment, never an unlimited approval",
        );
        tx = await wallet.writeContract({
          address: x402ExactPermit2ProxyAddress,
          abi: x402ExactPermit2ProxyABI,
          functionName: "settleWithPermit",
          args: [
            {
              value: BigInt(info.amount),
              deadline: BigInt(info.deadline),
              v: 27 + (s.yParity ?? 0),
              r: s.r,
              s: s.s,
            },
            {
              permitted: { token, amount },
              nonce: BigInt(a.nonce),
              deadline: BigInt(a.deadline),
            },
            payer.address,
            { to: receiver, validAfter: BigInt(a.witness.validAfter) },
            signature,
          ],
          type: "legacy",
          gasPrice: await rpc.getGasPrice(),
        });
      }
      await rpc.waitForTransactionReceipt({ hash: tx });
      await protocol.confirm(
        {
          success: true,
          transaction: tx,
          network: cfg.network,
          payer: payer.address,
        },
        requirement,
        payer.address,
        payload,
      );
      const replay = structuredClone(payload);
      if (name === "USDT")
        (replay.payload.authorization as any).nonce = "0x" + "ff".repeat(32);
      else
        (replay.payload.permit2Authorization as any).nonce = (
          BigInt(p.permit2Authorization.nonce) + 1n
        ).toString();
      await assert.rejects(
        () =>
          protocol.confirm(
            {
              success: true,
              transaction: tx,
              network: cfg.network,
              payer: payer.address,
            },
            requirement,
            payer.address,
            replay,
          ),
        /different.*nonce|different Permit2/,
      );
      assert.equal(
        await rpc.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [receiver],
        }),
        amount * BigInt(attempt + 1),
      );
      if (name === "wMXN")
        assert.equal(
          await rpc.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "allowance",
            args: [payer.address, PERMIT2],
          }),
          0n,
        );
      console.log(
        JSON.stringify({
          network: "local Celo fork",
          token: name,
          attempt: attempt + 1,
          confirmed: true,
          txHash: tx,
        }),
      );
    }
  }

  const expAsset = cfg.assets.find((a) => a.token === "wMXN")!;
  const expRequirement: PaymentRequirements = {
    scheme: "exact",
    network: cfg.network,
    asset: expAsset.address,
    amount: expAsset.price,
    payTo: receiver,
    maxTimeoutSeconds: 120,
    extra: {
      name: expAsset.name,
      version: expAsset.version,
      assetTransferMethod: "permit2",
      paymentFlow: "upfront",
    },
  };
  const expPayload = await protocol.sign(
    {
      x402Version: 2,
      accepts: [expRequirement],
      resource: { url: "https://fork.example/data" },
      extensions: { eip2612GasSponsoring: { info: { version: "1" } } },
    },
    expRequirement,
  );
  const expAuth = (expPayload.payload as any).permit2Authorization;
  const expInfo = (expPayload.extensions?.eip2612GasSponsoring as any).info;
  const expSignature = parseSignature(expInfo.signature as Hex);
  await raw("evm_increaseTime", [180]);
  await raw("evm_mine");
  assert.ok((await rpc.getBlock()).timestamp > BigInt(expInfo.deadline));
  assert.equal(await protocol.expiredUnused(expPayload, expRequirement), true);
  await assert.rejects(() =>
    rpc.simulateContract({
      account: facilitator.address,
      address: x402ExactPermit2ProxyAddress,
      abi: x402ExactPermit2ProxyABI,
      functionName: "settleWithPermit",
      args: [
        {
          value: BigInt(expInfo.amount),
          deadline: BigInt(expInfo.deadline),
          v: 27 + (expSignature.yParity ?? 0),
          r: expSignature.r,
          s: expSignature.s,
        },
        {
          permitted: {
            token: expAsset.address as Address,
            amount: BigInt(expAsset.price),
          },
          nonce: BigInt(expAuth.nonce),
          deadline: BigInt(expAuth.deadline),
        },
        payer.address,
        { to: receiver, validAfter: BigInt(expAuth.witness.validAfter) },
        expPayload.payload.signature as Hex,
      ],
    }),
  );
  console.log(
    JSON.stringify({
      network: "local Celo fork",
      token: "wMXN",
      expiredPermitRejected: true,
      unusedNonceProven: true,
    }),
  );
} finally {
  await raw("evm_revert", [snapshot]);
}
