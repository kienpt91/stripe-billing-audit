import { err, ok, type Result } from "../result.js";

export type KeyKind = "restricted" | "secret";
export type Mode = "live" | "test";

export interface KeyInfo {
  readonly kind: KeyKind;
  readonly mode: Mode;
}

const KEY = /^(rk|sk)_(live|test)_[A-Za-z0-9]{8,255}$/;

/**
 * Classifies the key from its prefix only. The error text never contains any part of the input: the
 * value of a mistyped variable may well be a real secret.
 */
export function classifyKey(raw: string | undefined): Result<KeyInfo, string> {
  const value = (raw ?? "").trim();
  if (value.length === 0) return err("STRIPE_API_KEY is not set. Create a restricted key with read permissions and export it.");
  if (/^pk_/.test(value)) return err("STRIPE_API_KEY holds a publishable key (pk_...). Use a restricted key (rk_...) with read permissions.");
  const m = KEY.exec(value);
  if (!m) return err("STRIPE_API_KEY is not a Stripe secret or restricted key (expected rk_live_..., rk_test_..., sk_live_... or sk_test_...).");
  return ok({ kind: m[1] === "rk" ? "restricted" : "secret", mode: m[2] === "live" ? "live" : "test" });
}
