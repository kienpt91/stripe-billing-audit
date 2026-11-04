/** Key-shaped test values are assembled at run time and never written as literals (see the secret scanner). */
export function fakeKey(kind: "rk" | "sk" | "pk", mode: "live" | "test", body = "FAKEFAKEFAKEFAKEFAKEFAKE1234"): string {
  return [kind, mode, body].join("_");
}
