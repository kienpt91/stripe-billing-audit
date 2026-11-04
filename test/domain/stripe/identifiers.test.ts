import { describe, expect, it } from "vitest";
import { safeUrl, shortId, validId } from "../../../src/domain/stripe/identifiers.js";
import { hostileString, prng } from "../../support/prng.js";

describe("validId and shortId", () => {
  it("accepts object-id shapes and rejects the rest", () => {
    expect(validId("sub_1QwErTyUiOp")).toBe("sub_1QwErTyUiOp");
    expect(validId("sub 1")).toBeNull();
    expect(validId("sub_\u001b[31m")).toBeNull();
    expect(validId("nounderscore")).toBeNull();
    expect(validId(12)).toBeNull();
    expect(validId("sub_" + "a".repeat(65))).toBeNull();
  });

  it("keeps the prefix and six characters", () => {
    expect(shortId("sub_1QwErTyUiOp")).toBe("sub_1QwErT…");
    expect(shortId("we_abc")).toBe("we_abc");
    expect(shortId("not an id")).toBe("<invalid-id>");
  });

  it("is always short, printable and never longer than the input (property)", () => {
    const rand = prng(7);
    for (let i = 0; i < 500; i++) {
      const id = validId(`pre_${Array.from({ length: 1 + Math.floor(rand() * 60) }, () => "abcXYZ019"[Math.floor(rand() * 9)]).join("")}`);
      const short = shortId(id ?? "x");
      expect(Array.from(short).length).toBeLessThanOrEqual(12);
      expect(short).not.toMatch(/[\u0000-\u001f]/);
      expect(shortId(hostileString(rand))).toMatch(/^<invalid-id>$|^[a-z]{2,12}_[A-Za-z0-9_]{1,6}…?$/);
    }
  });
});

describe("safeUrl", () => {
  it("drops credentials, query and fragment and masks long path segments", () => {
    const u = safeUrl("https://user:pw@example.com/hooks/stripe/abcdefghijklmnopqrstuvwxyz?token=s3cret#frag");
    expect(u?.display).toBe("https://example.com/hooks/stripe/…");
    expect(u?.display).not.toContain("s3cret");
    expect(u?.display).not.toContain("pw");
    expect(u?.scheme).toBe("https");
    expect(u?.development).toBe(false);
  });

  it("flags development hosts", () => {
    for (const host of ["http://localhost:3000/x", "https://abc.ngrok-free.app/x", "http://127.0.0.1/x", "http://192.168.1.4/x", "http://10.0.0.2/x", "http://172.20.1.1/x", "https://foo.test/x", "http://[::1]/x", "https://x.trycloudflare.com"]) {
      expect(safeUrl(host)?.development, host).toBe(true);
    }
    expect(safeUrl("https://172.32.0.1/x")?.development).toBe(false);
    expect(safeUrl("https://api.example.com/x")?.development).toBe(false);
  });

  it("rejects non-http URLs, junk and oversized input", () => {
    expect(safeUrl("ftp://example.com")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
    expect(safeUrl(5)).toBeNull();
    expect(safeUrl("https://example.com/" + "a/".repeat(2000))).toBeNull();
  });

  it("shortens long displays and never prints control characters (property)", () => {
    const rand = prng(11);
    for (let i = 0; i < 300; i++) {
      const u = safeUrl(`https://example.com/${encodeURIComponent(hostileString(rand, 200).replace(/[\ud800-\udfff]/g, "?"))}/${"a".repeat(Math.floor(rand() * 90))}`);
      if (u) {
        expect(Array.from(u.display).length).toBeLessThanOrEqual(80);
        expect(u.display).not.toMatch(/[\u0000-\u001f\u007f]/);
      }
    }
  });
});
