import type { AuditReport } from "../../domain/report.js";
import { MANUAL_ITEMS } from "../../domain/manual.js";
import { REPORT_SCHEMA_VERSION } from "../../domain/report.js";

/** The stable machine-readable report; `schemaVersion` changes only when the shape does. See docs/json-output.md. */
export function renderJson(report: AuditReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderChecklistJson(): string {
  return `${JSON.stringify({ schemaVersion: REPORT_SCHEMA_VERSION, items: MANUAL_ITEMS.map(({ id, area, title, detail }) => ({ id, area, title, detail })) }, null, 2)}\n`;
}
