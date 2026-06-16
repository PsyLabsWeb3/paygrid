import type { Env } from "../../config/env.js";

export const ONRAMP_PROVIDERS = {
  fonbnk: "fonbnk",
  ramp: "ramp",
  card: "card",
  minipayCard: "minipay_card",
} as const;

export type OnrampProvider = (typeof ONRAMP_PROVIDERS)[keyof typeof ONRAMP_PROVIDERS];

export type OnrampProviderAdapter<Config, SessionInput, SessionOutput, WebhookPayload> = {
  provider: OnrampProvider;
  getConfig(env: Env, countryIsoCode: string): Promise<Config>;
  createSession(env: Env, linkId: string, input: SessionInput): Promise<SessionOutput>;
  handleWebhook(env: Env, payload: WebhookPayload, rawBody: string, headers: Headers): Promise<unknown>;
};
