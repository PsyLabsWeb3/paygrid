import "dotenv/config";
import { z } from "zod";

const optionalString = () =>
  z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional());

const optionalUrl = () =>
  z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional());

const optionalAddress = () =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional()
      .transform((v) => (v ? (v as `0x${string}`) : undefined)),
  );

const requiredString = () => z.string().trim().min(1);

const rawEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: requiredString(),
  SUPABASE_ANON_KEY: optionalString(),
  CORS_ORIGINS: optionalString(),
  PUBLIC_APP_URL: z.string().url().default("https://celopaygrid.xyz"),
  PRIVY_APP_ID: optionalString(),
  PRIVY_APP_SECRET: optionalString(),
  PRIVY_JWT_VERIFICATION_KEY: optionalString(),
  FONBNK_API_KEY: optionalString(),
  FONBNK_API_BASE_URL: optionalUrl(),
  FONBNK_PAY_BASE_URL: optionalUrl(),
  FONBNK_WEBHOOK_SECRET: optionalString(),
  RAMP_API_KEY: optionalString(),
  RAMP_ENV: z.enum(["demo", "production"]).default("demo"),
  RAMP_API_BASE_URL: optionalUrl(),
  RAMP_WIDGET_URL: optionalUrl(),
  RAMP_WEBHOOK_BASE_URL: optionalUrl(),
  RAMP_WEBHOOK_PUBLIC_KEY: optionalString(),
  ROUTER_OWNER_PRIVATE_KEY: optionalString(),
  CELO_RPC_URL: optionalUrl(),
  CELO_SEPOLIA_RPC: optionalUrl(),
  USDC_ADDRESS: optionalAddress(),
  USDT_ADDRESS: optionalAddress(),
  USDM_ADDRESS: optionalAddress(),
  CHAIN_ID: z.coerce.number().default(11142220),
  PAYGRID_LINK_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((v) => v as `0x${string}`),
  PAYGRID_ROUTER_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((v) => v as `0x${string}`),
  PAYGRID_TREASURY_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional()
    .transform((v) => (v ? (v as `0x${string}`) : undefined)),
  BACKEND_WALLET_PRIVATE_KEY: z
    .string()
    .min(1)
    .transform((v) => {
      const trimmed = v.trim();
      const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
      if (!/^0x[a-fA-F0-9]{64}$/.test(hex)) {
        throw new Error("BACKEND_WALLET_PRIVATE_KEY must be 32 bytes hex");
      }
      return hex as `0x${string}`;
    }),
  PORT: z.coerce.number().default(3001),
});

const envSchema = rawEnvSchema.transform((env, ctx) => {
  const rpcUrl = env.CELO_RPC_URL ?? env.CELO_SEPOLIA_RPC;
  if (!rpcUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CELO_RPC_URL"],
      message: "CELO_RPC_URL is required",
    });
    return z.NEVER;
  }

  return {
    ...env,
    CELO_RPC_URL: rpcUrl,
  };
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  return envSchema.parse(process.env);
}
