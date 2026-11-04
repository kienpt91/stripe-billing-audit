import type { ApiFailureKind, ApiResult, Clock, StripeReader } from "../../src/application/ports.js";
import { NOW } from "./builders.js";

export type Route = (query: Readonly<Record<string, string>>) => ApiResult;

export function body(value: unknown, stripeVersion: string | null = null): ApiResult {
  return { ok: true, body: value, stripeVersion };
}

export function fail(kind: ApiFailureKind, status: number | null = null, code: string | null = null): ApiResult {
  return { ok: false, kind, status, code };
}

/** A list endpoint that pages through `items` with cursors, `pageSize` objects at a time. */
export function paged(items: readonly { id: string }[], pageSize = 100): Route {
  return (query) => {
    const start = query.starting_after === undefined ? 0 : items.findIndex((i) => i.id === query.starting_after) + 1;
    const data = items.slice(start, start + Math.min(pageSize, Number(query.limit ?? 100)));
    return body({ object: "list", data, has_more: start + data.length < items.length });
  };
}

/** In-memory StripeReader: routes by exact path, records every call, 404 for anything else. */
export class FakeReader implements StripeReader {
  readonly calls: Array<{ path: string; query: Record<string, string> }> = [];
  private readonly routes = new Map<string, Route>();

  on(path: string, route: Route | ApiResult): this {
    this.routes.set(path, typeof route === "function" ? route : () => route);
    return this;
  }

  async get(path: string, query: Readonly<Record<string, string>> = {}): Promise<ApiResult> {
    this.calls.push({ path, query: { ...query } });
    const route = this.routes.get(path);
    return route ? route(query) : fail("not_found", 404);
  }
}

export const clock: Clock = { nowSeconds: () => NOW };

/** A reader that serves a small healthy account on every endpoint the collector reads. */
export function healthyReader(): FakeReader {
  const list = (data: unknown[] = []): Route => () => body({ object: "list", data, has_more: false });
  return new FakeReader()
    .on("/v1/account", body({ id: "acct_1AbCdEfGhIjKl", country: "US", default_currency: "usd" }, "2025-09-30.clover"))
    .on("/v1/webhook_endpoints", list([{ id: "we_1AbCdEfGhIjKl", status: "enabled", url: "https://app.example.com/hooks", enabled_events: ["*"], api_version: null, livemode: true }]))
    .on("/v1/subscriptions", list([]))
    .on("/v1/invoices", list())
    .on("/v1/prices", list())
    .on("/v1/products", list())
    .on("/v1/billing_portal/configurations", list())
    .on("/v1/tax/settings", body({ object: "tax.settings", status: "active", defaults: { tax_behavior: "exclusive", tax_code: "txcd_1" } }))
    .on("/v1/tax/registrations", list());
}
