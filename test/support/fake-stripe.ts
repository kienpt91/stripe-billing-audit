import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { World } from "./stripe-fixtures.ts";

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly authorization: string | undefined;
}

/** Replaces the answer for one path. Return true when the response was fully handled. */
export type Override = (req: IncomingMessage, res: ServerResponse, hit: number) => boolean | Promise<boolean>;

const jsonHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({ "content-type": "application/json", ...extra });

function stripeError(res: ServerResponse, status: number, message: string, type = "invalid_request_error", code?: string): void {
  res.writeHead(status, jsonHeaders());
  res.end(JSON.stringify({ error: { message, type, ...(code ? { code } : {}) } }));
}

/**
 * A fake Stripe API on a loopback port. It checks the bearer key, answers only GET, pages lists with
 * `limit` and `starting_after`, can deny paths with a 403 like a restricted key does, and can be told to
 * misbehave per path (overrides). Every request is recorded.
 */
export class FakeStripe {
  readonly requests: RecordedRequest[] = [];
  readonly denied = new Set<string>();
  readonly overrides = new Map<string, Override>();
  private readonly hits = new Map<string, number>();
  private readonly server: Server;
  url = "";
  world: World;
  private readonly expectedKey: string;

  constructor(world: World, expectedKey: string) {
    this.world = world;
    this.expectedKey = expectedKey;
    this.server = createServer((req, res) => void this.handle(req, res));
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private page(items: readonly unknown[], query: URLSearchParams): unknown {
    const limit = Math.min(100, Number(query.get("limit") ?? 10));
    const after = query.get("starting_after");
    const start = after === null ? 0 : items.findIndex((i) => (i as { id: string }).id === after) + 1;
    const data = items.slice(start, start + limit);
    return { object: "list", data, has_more: start + data.length < items.length, url: "/v1/x" };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const query = Object.fromEntries(url.searchParams.entries());
    this.requests.push({ method: req.method ?? "", path: url.pathname, query, authorization: req.headers.authorization });
    const hit = (this.hits.get(url.pathname) ?? 0) + 1;
    this.hits.set(url.pathname, hit);

    if (req.method !== "GET") return stripeError(res, 405, "method not allowed");
    if (req.headers.authorization !== `Bearer ${this.expectedKey}`) return stripeError(res, 401, "Invalid API Key provided", "invalid_request_error", "api_key_invalid");
    const override = this.overrides.get(url.pathname);
    if (override && (await override(req, res, hit))) return;
    if ([...this.denied].some((d) => url.pathname === d || url.pathname.startsWith(`${d}/`))) {
      return stripeError(res, 403, `The provided key '${this.expectedKey}' does not have the required permissions for this endpoint.`);
    }

    const w = this.world;
    const headers = jsonHeaders(w.stripeVersion ? { "stripe-version": w.stripeVersion } : {});
    const send = (body: unknown): void => {
      res.writeHead(200, headers);
      res.end(JSON.stringify(body));
    };
    const q = url.searchParams;
    switch (url.pathname) {
      case "/v1/account":
        return send(w.account);
      case "/v1/webhook_endpoints":
        return send(this.page(w.webhookEndpoints, q));
      case "/v1/subscriptions":
        return send(this.page(q.get("status") === "all" || q.get("status") === null ? w.subscriptions : w.subscriptions.filter((s) => s.status === q.get("status")), q));
      case "/v1/invoices":
        return send(this.page(w.invoices.filter((i) => q.get("status") === null || i.status === q.get("status")), q));
      case "/v1/prices":
        return send(this.page(w.prices.filter((p) => q.get("active") !== "true" || p.active === true), q));
      case "/v1/products":
        return send(this.page(w.products.filter((p) => q.get("active") !== "true" || p.active === true), q));
      case "/v1/billing_portal/configurations":
        return send(this.page(w.portalConfigurations, q));
      case "/v1/tax/settings":
        return w.taxSettings === null ? stripeError(res, 404, "No such resource") : send(w.taxSettings);
      case "/v1/tax/registrations":
        return send(this.page(w.taxRegistrations, q));
      case "/v1/events":
        return send(this.page(q.get("delivery_success") === "false" ? w.failedEvents : [], q));
    }
    const customer = /^\/v1\/customers\/(cus_[A-Za-z0-9]+)$/.exec(url.pathname)?.[1];
    if (customer !== undefined) {
      const found = w.customers[customer];
      return found ? send(found) : stripeError(res, 404, `No such customer: '${customer}'`, "invalid_request_error", "resource_missing");
    }
    return stripeError(res, 404, "Unrecognized request URL");
  }
}
