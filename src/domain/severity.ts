export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Higher is worse. */
export function severityRank(s: Severity): number {
  return SEVERITIES.length - 1 - SEVERITIES.indexOf(s);
}

export function isSeverity(value: string): value is Severity {
  return (SEVERITIES as readonly string[]).includes(value);
}

/** True when `s` is at least as bad as `threshold`. */
export function atLeast(s: Severity, threshold: Severity): boolean {
  return severityRank(s) >= severityRank(threshold);
}

export function worst(list: readonly Severity[]): Severity | null {
  return list.reduce<Severity | null>((acc, s) => (acc === null || severityRank(s) > severityRank(acc) ? s : acc), null);
}
