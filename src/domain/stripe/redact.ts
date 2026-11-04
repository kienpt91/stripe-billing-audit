/**
 * Stripe API keys and webhook signing secrets have a recognisable shape. There is no word boundary in front:
 * a key glued to other characters (`x` + key, `--` + key) is still a key.
 */
const KEY_SHAPED = /(?:[rsp]k_(?:live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+)/g;

/**
 * Replaces anything that looks like a Stripe secret, and every exact secret passed in, by `[redacted]`.
 * Applied to every byte the tool prints, as the last line of defence behind the code that never puts a
 * secret into a report in the first place.
 */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text.replace(KEY_SHAPED, "[redacted]");
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join("[redacted]");
  }
  return out;
}

export function containsSecret(text: string, secrets: readonly string[] = []): boolean {
  KEY_SHAPED.lastIndex = 0;
  return KEY_SHAPED.test(text) || secrets.some((s) => s.length >= 8 && text.includes(s));
}
