/** Why a read did not produce a body. The adapter classifies; the application decides what it means. */
export type ApiFailureKind =
  | "permission"
  | "auth"
  | "not_found"
  | "rate_limited"
  | "server"
  | "network"
  | "timeout"
  | "malformed"
  | "too_large"
  | "budget"
  | "refused";

export type ApiResult =
  | { readonly ok: true; readonly body: unknown; /** `Stripe-Version` response header, when present. */ readonly stripeVersion: string | null }
  | {
      readonly ok: false;
      readonly kind: ApiFailureKind;
      readonly status: number | null;
      /** Stripe's machine-readable error code, only when it has the shape of one. Never the message. */
      readonly code: string | null;
    };

/** Read-only access to the Stripe API. There is no way to write through this port. */
export interface StripeReader {
  get(path: string, query?: Readonly<Record<string, string>>): Promise<ApiResult>;
}

export interface Clock {
  nowSeconds(): number;
}

/** The key was rejected (HTTP 401): nothing else can be learned, so the audit stops. */
export class AuthenticationError extends Error {
  constructor() {
    super("Stripe rejected the API key (HTTP 401).");
    this.name = "AuthenticationError";
  }
}
