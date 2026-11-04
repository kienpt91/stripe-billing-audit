/**
 * Identifiers and URLs that come back from the API are validated before they are kept, and shortened
 * before they are shown: a report can be pasted into a ticket without handing out full object ids.
 */
import { clip } from "../text/text.js";

const ID = /^[a-z]{2,12}_[A-Za-z0-9_]{1,64}$/;

/** The id when it has the shape of a Stripe object id (`sub_1Abc...`), otherwise null. */
export function validId(value: unknown): string | null {
  return typeof value === "string" && ID.test(value) ? value : null;
}

const KEEP = 6;

/** `sub_1QwErTyUiOp` -> `sub_1QwErT…`. Short ids are shown whole. */
export function shortId(id: string): string {
  const cut = id.indexOf("_");
  if (cut < 0 || !ID.test(id)) return "<invalid-id>";
  const rest = id.slice(cut + 1);
  return rest.length <= KEEP ? id : `${id.slice(0, cut + 1)}${rest.slice(0, KEEP)}…`;
}

const DEV_SUFFIXES = [
  ".localhost",
  ".local",
  ".test",
  ".internal",
  ".ngrok.io",
  ".ngrok.app",
  ".ngrok.dev",
  ".ngrok-free.app",
  ".ngrok-free.dev",
  ".loca.lt",
  ".localtunnel.me",
  ".trycloudflare.com",
  ".serveo.net",
  ".lhr.life",
];

function isPrivateOrLoopbackIp(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return host === "[::1]" || host === "[::]";
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 0 || a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

export interface SafeUrl {
  readonly scheme: "http" | "https";
  readonly host: string;
  /** Printable form: no credentials, no query, no fragment, long path segments masked. */
  readonly display: string;
  /** localhost, a private address or a well-known development tunnel. */
  readonly development: boolean;
}

/**
 * Parses a webhook URL for display. Webhook URLs often carry a secret in the path or in the query
 * string, so the printable form keeps the scheme, host and a masked path only.
 */
export function safeUrl(raw: unknown): SafeUrl | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const scheme = url.protocol === "http:" ? "http" : "https";
  const host = url.host.toLowerCase();
  const path = url.pathname
    .split("/")
    .map((segment) => (segment.length >= 20 ? "…" : segment))
    .join("/");
  const hostname = url.hostname.toLowerCase();
  const development = hostname === "localhost" || isPrivateOrLoopbackIp(hostname) || DEV_SUFFIXES.some((s) => hostname.endsWith(s));
  return { scheme, host, display: clip(`${scheme}://${host}${path === "/" ? "" : path}`, 80), development };
}
