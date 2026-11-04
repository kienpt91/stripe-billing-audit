/**
 * Text that comes back from an API is untrusted: it can carry terminal escape sequences, bidi overrides,
 * zero-width characters or markdown structure. These pure helpers turn such text into inert, visible text.
 */

const ELLIPSIS = "…";

function hex(cp: number, width: number): string {
  return cp.toString(16).toUpperCase().padStart(width, "0");
}

function isInvisibleFormat(cp: number): boolean {
  return (
    cp === 0x00ad ||
    cp === 0x061c ||
    cp === 0x180e ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x206f) ||
    cp === 0xfeff ||
    cp === 0xfffe ||
    cp === 0xffff ||
    (cp >= 0xe0000 && cp <= 0xe007f)
  );
}

function token(ch: string, keepLines: boolean): string {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp === 0x0a) return keepLines ? "\n" : "\\n";
  if (cp === 0x0d) return "\\r";
  if (cp === 0x09) return "\\t";
  if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) return `\\x${hex(cp, 2)}`;
  if ((cp >= 0xd800 && cp <= 0xdfff) || isInvisibleFormat(cp)) return `\\u{${hex(cp, 4)}}`;
  return ch;
}

function render(text: string, keepLines: boolean, max: number | undefined): string {
  // `for..of` walks code points, so astral characters count once and a lone surrogate arrives alone.
  const parts: string[] = [];
  for (const ch of text) parts.push(token(ch, keepLines));
  if (max === undefined) return parts.join("");
  const limit = Math.max(0, Math.floor(max));
  const lengths = parts.map((p) => Array.from(p).length);
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total <= limit) return parts.join("");
  if (limit === 0) return "";
  let used = 0;
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const n = lengths[i] ?? 0;
    if (used + n > limit - 1) break;
    out += parts[i] ?? "";
    used += n;
  }
  return out + ELLIPSIS;
}

/**
 * Single line that is safe to print on a terminal: every control character (including newline, CR and
 * tab), escape sequence introducer, bidi control, zero-width and invisible character and lone surrogate
 * becomes visible text such as `\x1B` or `\u{202E}`. When `max` is given the result has at most `max`
 * code points and ends with an ellipsis if it was cut.
 */
export function visibleText(text: string, max?: number): string {
  return render(text, false, max);
}

function longestBacktickRun(s: string): number {
  let longest = 0;
  let run = 0;
  for (const ch of s) {
    run = ch === "`" ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

/** Fenced code block whose fence is longer than any backtick run inside; content is made visible first. */
export function markdownFence(content: string): string {
  const body = render(content, true, undefined);
  const fence = "`".repeat(Math.max(3, longestBacktickRun(body) + 1));
  return `${fence}\n${body}\n${fence}`;
}

/** Inline code span that its own content cannot close early. */
export function markdownCode(text: string, max?: number): string {
  const content = render(text, false, max);
  if (content.length === 0) return "` `";
  const delimiter = "`".repeat(longestBacktickRun(content) + 1);
  const pad = content.startsWith("`") || content.endsWith("`") || content.startsWith(" ") || content.endsWith(" ");
  return pad ? `${delimiter} ${content} ${delimiter}` : `${delimiter}${content}${delimiter}`;
}

/** First `max` code points of `text`, with an ellipsis when something was cut. */
export function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, Math.max(0, max - 1)).join("") + ELLIPSIS;
}

const MARKDOWN_SPECIALS = "\\`*_{}[]()#+-.!|~$@:=";

/** Single-line markdown text in which nothing can form a tag, link, image, mention, table break or list. */
export function escapeMarkdown(text: string, max?: number): string {
  let out = "";
  for (const ch of render(text, false, max)) {
    out += ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === "&" ? "&amp;" : MARKDOWN_SPECIALS.includes(ch) ? `\\${ch}` : ch;
  }
  return out;
}

/** Word-wraps plain text to `width` columns, indenting every line by `indent` spaces. */
export function wrap(text: string, width: number, indent: number): string {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    if (line.length > 0 && indent + line.length + 1 + word.length > width) {
      lines.push(pad + line);
      line = word;
    } else {
      line = line.length === 0 ? word : `${line} ${word}`;
    }
  }
  if (line.length > 0) lines.push(pad + line);
  return lines.join("\n");
}
