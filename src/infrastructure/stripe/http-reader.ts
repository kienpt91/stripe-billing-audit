import type { ApiFailureKind, ApiResult, StripeReader } from "../../application/ports.js";
import type { RequestBudget } from "../../domain/budget.js";
import { validateRead } from "../../domain/stripe/allowlist.js";

export interface HttpReaderOptions {
  readonly origin: string;
  /** Sent only as the bearer token of requests to `origin`. Never logged, never part of an error. */
  readonly apiKey: string;
  readonly userAgent: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxRetries: number;
  readonly maxBackoffMs: number;
  readonly budget: RequestBudget;
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

const ERROR_BODY_LIMIT = 64 * 1024;
const CODE = /^[a-z_]{1,40}$/;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function fail(kind: ApiFailureKind, status: number | null = null, code: string | null = null): ApiResult {
  return { ok: false, kind, status, code };
}

/** Reads at most `limit` bytes of the body; null when the body is larger (and cancels the rest). */
async function readLimited(response: Response, limit: number): Promise<string | null> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

/** Stripe's machine-readable error code, if the body has one of the expected shape. */
async function errorCode(response: Response): Promise<string | null> {
  try {
    const text = await readLimited(response, ERROR_BODY_LIMIT);
    const parsed: unknown = text === null ? null : JSON.parse(text);
    const error = typeof parsed === "object" && parsed !== null ? (parsed as { error?: unknown }).error : null;
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : null;
    return typeof code === "string" && CODE.test(code) ? code : null;
  } catch {
    return null;
  }
}

function retryDelay(response: Response | null, attempt: number, maxBackoffMs: number): number {
  const header = response?.headers.get("retry-after");
  const seconds = header !== null && header !== undefined && /^\d{1,4}$/.test(header) ? Number(header) : null;
  const delay = seconds !== null ? seconds * 1000 : 500 * 2 ** attempt;
  return Math.min(delay, maxBackoffMs);
}

/**
 * GET-only Stripe reader. Every request is checked against the path allowlist, counted against the global
 * budget (retries included), bounded in time and size, and never follows a redirect, so the key cannot be
 * forwarded anywhere. HTTP 429 and 5xx are retried with backoff.
 */
export class HttpStripeReader implements StripeReader {
  private readonly options: HttpReaderOptions;

  constructor(options: HttpReaderOptions) {
    this.options = options;
  }

  async get(path: string, query: Readonly<Record<string, string>> = {}): Promise<ApiResult> {
    const o = this.options;
    const request = validateRead(path, query);
    if (!request.ok) return fail("refused");
    const url = new URL(path, o.origin);
    for (const [name, value] of Object.entries(request.value.query)) url.searchParams.set(name, value);
    const doFetch = o.fetch ?? fetch;
    const sleep = o.sleep ?? defaultSleep;

    let last: ApiResult = fail("network");
    for (let attempt = 0; attempt <= o.maxRetries; attempt++) {
      if (!o.budget.tryTake()) return fail("budget");
      let response: Response;
      try {
        response = await doFetch(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${o.apiKey}`, Accept: "application/json", "User-Agent": o.userAgent },
          redirect: "error",
          signal: AbortSignal.timeout(o.timeoutMs),
        });
      } catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return fail("timeout");
        last = fail("network");
        if (attempt < o.maxRetries) await sleep(retryDelay(null, attempt, o.maxBackoffMs));
        continue;
      }

      const status = response.status;
      if (status >= 200 && status < 300) {
        let text: string | null;
        try {
          text = await readLimited(response, o.maxResponseBytes);
        } catch {
          return fail("network", status);
        }
        if (text === null) return fail("too_large", status);
        try {
          return { ok: true, body: JSON.parse(text) as unknown, stripeVersion: response.headers.get("stripe-version") };
        } catch {
          return fail("malformed", status);
        }
      }

      const code = await errorCode(response);
      if (status === 401) return fail("auth", status, code);
      if (status === 403) return fail("permission", status, code);
      if (status === 404) return fail("not_found", status, code);
      if (status === 429 || status >= 500) {
        last = fail(status === 429 ? "rate_limited" : "server", status, code);
        if (attempt < o.maxRetries) await sleep(retryDelay(response, attempt, o.maxBackoffMs));
        continue;
      }
      return fail("rejected", status, code);
    }
    return last;
  }
}
