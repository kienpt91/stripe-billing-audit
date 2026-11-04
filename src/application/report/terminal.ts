import type { Finding } from "../../domain/rule.js";
import type { AuditReport } from "../../domain/report.js";
import { MANUAL_ITEMS } from "../../domain/manual.js";
import { SEVERITIES } from "../../domain/severity.js";
import { visibleText, wrap } from "../../domain/text/text.js";

const WIDTH = 100;

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function findingBlock(f: Finding): string {
  const lines = [`[${f.severity.toUpperCase()}] ${visibleText(f.id, 60)}: ${visibleText(f.title, 160)}`, "  Evidence:"];
  for (const e of f.evidence) lines.push(wrap(`- ${visibleText(e, 400)}`, WIDTH, 4).replace(/\n(\s+)/g, "\n$1  "));
  lines.push(`  Why it matters:\n${wrap(f.why, WIDTH, 4)}`, `  Fix:\n${wrap(f.fix, WIDTH, 4)}`);
  return lines.join("\n");
}

function exitMeaning(report: AuditReport): string {
  switch (report.exitCode) {
    case 0:
      return "nothing at or above the fail-on severity";
    case 1:
      return `findings at or above ${report.options.failOn}`;
    case 3:
      return "API errors left the audit incomplete";
    case 4:
      return "checks skipped for lack of permission";
    default:
      return "see the documentation";
  }
}

export function renderTerminal(report: AuditReport): string {
  const a = report.account;
  const out: string[] = [];
  out.push(`${report.tool.name} ${report.tool.version}: read-only Stripe billing audit`);
  out.push(`Account ${visibleText(a.id ?? "(not readable)", 40)}${a.country ? `, ${visibleText(a.country, 8)}` : ""}${a.defaultCurrency ? `, default currency ${visibleText(a.defaultCurrency, 8)}` : ""}`);
  out.push(`Mode: ${a.mode.toUpperCase()}   Key: ${a.keyKind}   Account API version: ${visibleText(a.apiVersion ?? "not reported", 40)}`);
  out.push(`Checked ${report.generatedAt}, ${plural(report.requests.used, "request")} (GET only)`);
  for (const w of report.warnings) out.push(`Warning: ${visibleText(w, 300)}`);
  out.push("");

  if (report.findings.length === 0) out.push("No findings.", "");
  for (const f of report.findings) out.push(findingBlock(f), "");

  const unreadable = report.skipped.filter((s) => s.reason !== "disabled");
  const switchedOff = report.skipped.filter((s) => s.reason === "disabled");
  if (unreadable.length > 0) {
    out.push("Skipped checks (could not read what they need):");
    for (const s of unreadable) out.push(wrap(`- ${visibleText(s.checkId, 60)}: ${visibleText(s.resource, 80)}: ${visibleText(s.detail, 240)}`, WIDTH, 2).replace(/\n(\s+)/g, "\n$1  "));
    out.push("");
  }
  if (switchedOff.length > 0) {
    out.push("Checks not run (switched off by the options):");
    for (const s of switchedOff) out.push(wrap(`- ${visibleText(s.checkId, 60)}: ${visibleText(s.detail, 240)}`, WIDTH, 2).replace(/\n(\s+)/g, "\n$1  "));
    out.push("");
  }
  if (report.truncated.length > 0) out.push(`Listed only up to the page cap, so counts are lower bounds: ${report.truncated.map((t) => visibleText(t, 80)).join(", ")}.`, "");
  if (report.ignoredObjects > 0) out.push(`${plural(report.ignoredObjects, "object")} with an unexpected shape were ignored.`, "");

  out.push("Not readable through the Stripe API (see --checklist for what to check by hand):");
  for (const n of report.notReadable) out.push(`- ${visibleText(n.title, 160)}`);
  out.push("");

  const by = SEVERITIES.filter((s) => report.summary.bySeverity[s] > 0).map((s) => `${report.summary.bySeverity[s]} ${s}`);
  const c = report.summary.checks;
  out.push(
    `Summary: ${plural(report.summary.findings, "finding")}${by.length > 0 ? ` (${by.join(", ")})` : ""}; checks: ${c.passed} passed, ${c.failed} failed, ${c.not_applicable} not applicable, ${c.skipped} skipped; exit code ${report.exitCode} (${exitMeaning(report)})`,
  );
  return `${out.join("\n")}\n`;
}

export function renderChecklistTerminal(): string {
  const out = ["Billing reliability checklist: what the Stripe API cannot show, to check by hand", ""];
  let area = "";
  for (const item of MANUAL_ITEMS) {
    if (item.area !== area) {
      area = item.area;
      out.push(`${area}`);
    }
    out.push(`  [ ] ${item.title}`, wrap(item.detail, WIDTH, 6), "");
  }
  return `${out.join("\n")}`;
}
