export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_TOKEN"
  | "INVALID_AMOUNT"
  | "UNSUPPORTED_METHOD"
  | "NOT_FOUND"
  | "ALREADY_PAID"
  | "EXPIRED"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "PAYMENT_REQUIRED"
  | "ONRAMP_ERROR"
  | "FONBNK_ERROR"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorResponse(err: ApiError) {
  return {
    error: {
      code: err.code,
      message: err.message,
      details: err.details,
    },
  };
}
