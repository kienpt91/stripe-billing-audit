import type { AuditReport } from "../../domain/report.js";
import { MANUAL_ITEMS } from "../../domain/manual.js";
import { SEVERITIES } from "../../domain/severity.js";
import { escapeMarkdown, markdownCode, markdownFence } from "../../domain/text/text.js";

const title = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A report to hand to a client. Dynamic text appears only in code spans and fenced blocks, so nothing in it
 * can turn into markup; static text (why, fix) is ours.
 */
export function renderMarkdown(report: AuditReport): string {
  const a = report.account;
  const out: string[] = ["# Stripe billing audit", ""];
  out.push("| | |", "| --- | --- |");
  out.push(`| Account | ${markdownCode(a.id ?? "not readable")} |`);
  out.push(`| Mode | ${a.mode} |`, `| Key | ${a.keyKind}, read-only requests |`);
  out.push(`| Account API version | ${markdownCode(a.apiVersion ?? "not reported")} |`);
  out.push(`| Checked | ${markdownCode(report.generatedAt)} |`);
  out.push(`| Tool | ${markdownCode(`${report.tool.name} ${report.tool.version}`)} |`, "");
  for (const w of report.warnings) out.push(`> Warning: ${markdownCode(w, 300)}`, "");

  out.push("## Summary", "", "| Severity | Findings |", "| --- | ---: |");
  for (const s of SEVERITIES) out.push(`| ${title(s)} | ${report.summary.bySeverity[s]} |`);
  const c = report.summary.checks;
  out.push("", `${c.passed + c.failed + c.not_applicable + c.skipped} checks ran: ${c.passed} passed, ${c.failed} failed, ${c.not_applicable} not applicable, ${c.skipped} skipped.`, "");

  out.push("## Findings", "");
  if (report.findings.length === 0) out.push("No findings.", "");
  for (const severity of SEVERITIES) {
    const group = report.findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    out.push(`### ${title(severity)}`, "");
    for (const f of group) {
      out.push(`#### ${markdownCode(f.id)}: ${escapeMarkdown(f.title, 160)}`, "", "**Evidence**", "", markdownFence(f.evidence.join("\n")), "");
      out.push("**Why it matters**", "", f.why, "", "**Suggested fix**", "", f.fix, "");
    }
  }

  const unreadable = report.skipped.filter((s) => s.reason !== "disabled");
  const switchedOff = report.skipped.filter((s) => s.reason === "disabled");
  if (unreadable.length > 0) {
    out.push("## Checks that could not run", "", "These checks need a resource the key could not read. No conclusion is drawn for them.", "");
    out.push("| Check | Resource | Reason |", "| --- | --- | --- |");
    for (const s of unreadable) out.push(`| ${markdownCode(s.checkId)} | ${markdownCode(s.resource, 80)} | ${markdownCode(s.detail, 240)} |`);
    out.push("");
  }
  if (switchedOff.length > 0) {
    out.push("## Checks not run", "", "These checks were switched off by the options of this run.", "");
    out.push("| Check | Reason |", "| --- | --- |");
    for (const s of switchedOff) out.push(`| ${markdownCode(s.checkId)} | ${markdownCode(s.detail, 240)} |`);
    out.push("");
  }
  if (report.truncated.length > 0) out.push(`Listed only up to the page cap, so counts are lower bounds: ${report.truncated.map((t) => markdownCode(t)).join(", ")}.`, "");
  if (report.ignoredObjects > 0) out.push(`${report.ignoredObjects} object(s) with an unexpected shape were ignored.`, "");

  out.push("## Not visible through the Stripe API", "", "These matter for reliable billing but Stripe does not expose them, so they were not guessed. Check them by hand:", "");
  for (const n of report.notReadable) {
    const item = MANUAL_ITEMS.find((m) => m.id === n.id);
    out.push(`- **${escapeMarkdown(n.title)}**${item ? `: ${item.detail}` : ""}`);
  }
  out.push("", "## Scope and method", "");
  out.push(
    `The audit made ${report.requests.used} read-only GET requests to a fixed list of Stripe endpoints. It wrote nothing to the account. It does not request customer emails, names or addresses, and this report contains none; object ids are shortened. The API key is not stored or printed.`,
    "",
  );
  return `${out.join("\n")}`;
}

export function renderChecklistMarkdown(): string {
  const out = ["# Billing reliability checklist", "", "What the Stripe API cannot show, to check by hand.", ""];
  let area = "";
  for (const item of MANUAL_ITEMS) {
    if (item.area !== area) {
      area = item.area;
      out.push(`## ${escapeMarkdown(area)}`, "");
    }
    out.push(`- [ ] **${escapeMarkdown(item.title)}**: ${item.detail}`);
  }
  return `${out.join("\n")}\n`;
}
