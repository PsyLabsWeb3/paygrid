import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().optional(),
  PRIVY_APP_ID: z.string().min(1).optional(),
  PRIVY_APP_SECRET: z.string().min(1).optional(),
  PRIVY_JWT_VERIFICATION_KEY: z.string().min(1).optional(),
  FONBNK_API_KEY: z.string().min(1).optional(),
  FONBNK_API_BASE_URL: z.string().url().optional(),
  FONBNK_PAY_BASE_URL: z.string().url().optional(),
  FONBNK_WEBHOOK_SECRET: z.string().min(1).optional(),
  ROUTER_OWNER_PRIVATE_KEY: z.string().min(1).optional(),
  CELO_SEPOLIA_RPC: z.string().url(),
  CHAIN_ID: z.coerce.number().default(11142220),
  PAYGRID_LINK_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((v) => v as `0x${string}`),
  PAYGRID_ROUTER_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((v) => v as `0x${string}`),
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

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  return envSchema.parse(process.env);
}
