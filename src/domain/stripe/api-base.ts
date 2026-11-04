import { err, ok, type Result } from "../result.js";

export const STRIPE_API = "https://api.stripe.com";

export interface ApiBase {
  readonly origin: string;
  readonly overridden: boolean;
}

const LOOPBACK_V4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * The key is only ever sent to api.stripe.com or, for tests, to a loopback address named with
 * `--api-base`. Names are refused (a name can resolve anywhere), as are credentials, paths and queries.
 */
export function parseApiBase(raw: string | undefined): Result<ApiBase, string> {
  if (raw === undefined) return ok({ origin: STRIPE_API, overridden: false });
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return err("--api-base is not a URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return err("--api-base must be an http or https URL.");
  if (url.username !== "" || url.password !== "") return err("--api-base must not contain credentials.");
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return err("--api-base must be a bare origin such as http://127.0.0.1:12111.");
  if (!LOOPBACK_V4.test(url.hostname) && url.hostname !== "[::1]") {
    return err("--api-base must be a loopback IP address (127.x.x.x or [::1]); it exists for tests against a fake server.");
  }
  return ok({ origin: url.origin, overridden: true });
}
