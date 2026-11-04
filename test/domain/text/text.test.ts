import { describe, expect, it } from "vitest";
import { clip, markdownCode, markdownFence, visibleText } from "../../../src/domain/text/text.js";
import { hostileString, prng } from "../../support/prng.js";

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u200b-\u200f\u2028\u2029\u2060-\u206f\ufeff]/;

describe("visibleText", () => {
  it("leaves printable text alone", () => {
    expect(visibleText("plain text é 日 😀")).toBe("plain text é 日 😀");
  });

  it("makes terminal escapes, newlines and bidi overrides visible", () => {
    expect(visibleText("\u001b[31mred\u001b[0m")).toBe("\\x1B[31mred\\x1B[0m");
    expect(visibleText("a\nb\rc\td")).toBe("a\\nb\\rc\\td");
    expect(visibleText("x\u202ey")).toBe("x\\u{202E}y");
    expect(visibleText("\u0085\u007f")).toBe("\\x85\\x7F");
    expect(visibleText("lone\ud800")).toBe("lone\\u{D800}");
  });

  it("cuts to a code point limit that includes the ellipsis", () => {
    expect(visibleText("abcdefghij", 5)).toBe("abcd…");
    expect(visibleText("abc", 5)).toBe("abc");
    expect(visibleText("abc", 0)).toBe("");
    expect(Array.from(visibleText("😀😀😀😀😀😀", 4))).toHaveLength(4);
  });

  it("never lets a control character through and never exceeds the limit (property)", () => {
    const rand = prng(1);
    for (let i = 0; i < 500; i++) {
      const input = hostileString(rand, 60);
      const max = 1 + Math.floor(rand() * 30);
      const out = visibleText(input, max);
      expect(CONTROL.test(out)).toBe(false);
      expect(Array.from(out).length).toBeLessThanOrEqual(max);
      expect(visibleText(input)).toBe(visibleText(input));
    }
  });
});

describe("markdown helpers", () => {
  it("uses a fence longer than any backtick run in the content", () => {
    const out = markdownFence("a ``` b ```` c");
    expect(out.startsWith("`````\n")).toBe(true);
    expect(out.endsWith("\n`````")).toBe(true);
  });

  it("keeps real newlines in a fence but escapes escapes", () => {
    expect(markdownFence("one\ntwo\u001b")).toBe("```\none\ntwo\\x1B\n```");
  });

  it("builds an inline code span its content cannot close", () => {
    expect(markdownCode("a`b")).toBe("``a`b``");
    expect(markdownCode("`x`")).toBe("`` `x` ``");
    expect(markdownCode("")).toBe("` `");
    expect(markdownCode("line\nbreak")).toBe("`line\\nbreak`");
    expect(markdownCode("abcdefgh", 4)).toBe("`abc…`");
  });
});

describe("clip", () => {
  it("cuts by code points", () => {
    expect(clip("abcdef", 4)).toBe("abc…");
    expect(clip("abc", 4)).toBe("abc");
    expect(clip("😀😀😀", 2)).toBe("😀…");
  });
});
