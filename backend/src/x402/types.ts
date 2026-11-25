import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";

export type Token = "USDC" | "USDT" | "wMXN";
export type State = "pending" | "settled" | "failed" | "unknown";
export type Request = {
  url: string;
  method: "GET" | "POST";
  body?: unknown;
  preferredToken?: Token;
};
export type Result = { httpStatus: number; body: string; contentType: string };
export type Payment = {
  network: string;
  asset: string;
  token: Token;
  amountAtomic: string;
  payer: string;
  payTo: string;
  txHash?: string;
};
export type Operation = {
  id: string;
  direction: "incoming" | "outgoing";
  identity_key: string;
  request_hash: string;
  request: Request;
  network: string;
  state: State;
  phase: "created" | "reserved" | "signed" | "submitted" | "complete";
  payer: string | null;
  asset: string | null;
  amount_atomic: string | null;
  token: Token | null;
  requirements: PaymentRequirements | null;
  authorization_key: string | null;
  authorization_hash: string | null;
  authorization_expires_at: string | null;
  ciphertext: string | null;
  receipt: SettleResponse | null;
  result: Result | null;
  result_expires_at: string | null;
  reserved: boolean;
  budget_date: string | null;
  error: string | null;
  lease_owner: string | null;
  lease_until: string | null;
  created_at: string;
  updated_at: string;
};
export type Patch = Partial<Operation>;
export interface Store {
  create(
    direction: Operation["direction"],
    key: string,
    hash: string,
    request: Request,
    network: string,
  ): Promise<Operation>;
  get(id: string): Promise<Operation | null>;
  find(key: string): Promise<Operation | null>;
  claim(id: string, owner: string): Promise<Operation | null>;
  patch(id: string, owner: string, patch: Patch): Promise<Operation>;
  reserve(
    id: string,
    owner: string,
    payment: Payment,
    requirements: PaymentRequirements,
    daily: string,
  ): Promise<Operation>;
  recoverable(network: string): Promise<Operation[]>;
  prune(): Promise<void>;
  health(): Promise<void>;
}
export interface Transport {
  send(request: Request, headers?: Record<string, string>): Promise<Response>;
}
export interface Protocol {
  requirements(): Promise<PaymentRequired>;
  sign(
    required: PaymentRequired,
    selected: PaymentRequirements,
  ): Promise<PaymentPayload>;
  verify(payload: PaymentPayload, required: PaymentRequirements): Promise<void>;
  settle(
    payload: PaymentPayload,
    required: PaymentRequirements,
  ): Promise<SettleResponse>;
  confirm(
    receipt: SettleResponse,
    required: PaymentRequirements,
    payer: string,
    payload: PaymentPayload,
  ): Promise<void>;
  expiredUnused(
    payload: PaymentPayload,
    required: PaymentRequirements,
  ): Promise<boolean>;
  preflight(): Promise<Record<string, unknown>>;
}
export class X402Error extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
