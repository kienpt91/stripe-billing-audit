import { err, ok, type Result } from "../result.js";

export interface ReadRequest {
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
}

const LIST_PARAMS = ["limit", "starting_after"] as const;

/** Every endpoint the tool may call, with the query parameters it may send. Everything else is refused. */
const ALLOWED: ReadonlyArray<{ readonly path: string | RegExp; readonly params: readonly string[] }> = [
  { path: "/v1/account", params: [] },
  { path: "/v1/webhook_endpoints", params: LIST_PARAMS },
  { path: "/v1/subscriptions", params: [...LIST_PARAMS, "status"] },
  { path: "/v1/invoices", params: [...LIST_PARAMS, "status"] },
  { path: "/v1/prices", params: [...LIST_PARAMS, "active"] },
  { path: "/v1/products", params: [...LIST_PARAMS, "active"] },
  { path: "/v1/billing_portal/configurations", params: [...LIST_PARAMS, "active"] },
  { path: "/v1/tax/settings", params: [] },
  { path: "/v1/tax/registrations", params: [...LIST_PARAMS, "status"] },
  { path: "/v1/events", params: [...LIST_PARAMS, "delivery_success"] },
  { path: /^\/v1\/customers\/cus_[A-Za-z0-9]{1,64}$/, params: [] },
];

const VALUE = /^[A-Za-z0-9_]{1,64}$/;

/**
 * The hard allowlist. The HTTP adapter can only issue GET and calls this before every request, so a bug
 * elsewhere cannot make the tool reach an endpoint that is not listed here.
 */
export function validateRead(path: string, query: Readonly<Record<string, string>>): Result<ReadRequest, string> {
  const entry = ALLOWED.find((a) => (typeof a.path === "string" ? a.path === path : a.path.test(path)));
  if (!entry) return err(`path is not on the allowlist: ${path.slice(0, 60)}`);
  for (const [name, value] of Object.entries(query)) {
    if (!entry.params.includes(name)) return err(`query parameter ${name} is not allowed for ${path.slice(0, 60)}`);
    if (!VALUE.test(value)) return err(`query parameter ${name} has an invalid value`);
  }
  return ok({ path, query });
}
