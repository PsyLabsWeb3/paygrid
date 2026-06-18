import { tool } from "ai";
import { z } from "zod";
import { publicClient, account } from "../wallet";

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
];

function optionalAddress(value: string | undefined, fallback: `0x${string}`) {
  return value && /^0x[a-fA-F0-9]{40}$/.test(value) ? (value as `0x${string}`) : fallback;
}

const TOKENS: Record<string, `0x${string}`> = {
  USDC: optionalAddress(process.env.USDC_ADDRESS, "0xcebA9300f2b948710d2653dD7B07f33A8B32118C"),
  USDT: optionalAddress(process.env.USDT_ADDRESS, "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"),
  USDm: optionalAddress(process.env.USDM_ADDRESS, "0x765DE816845861e75A25fCA122bb6898B8B1282a"),
};

export const getBalance = tool({
  description: "Gets the balance of the agent's payment wallet for a specific token.",
  inputSchema: z.object({
    token: z.enum(["USDC", "USDT", "USDm"]).optional().describe("The token to check. If omitted, checks all."),
  }),
  execute: async ({ token }) => {
    const balances: Record<string, string> = {};

    const tokensToCheck = token ? [token] : ["USDC", "USDT", "USDm"];

    for (const t of tokensToCheck) {
      const address = TOKENS[t];
      if (!address) continue;

      try {
        const balance = await publicClient.readContract({
          address,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [account.address],
        } as any);

        // USDC/USDT have 6 decimals, USDm has 18
        const decimals = t === "USDm" ? 18 : 6;
        balances[t] = (Number(balance) / 10 ** decimals).toString();
      } catch (e) {
        balances[t] = "0";
      }
    }

    return { balances };
  },
});
