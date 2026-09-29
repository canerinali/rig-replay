import { describe, expect, it } from "vitest";
import { escapeHtml, safeJsonForScript } from "../src/report/escape.js";

describe("escape", () => {
  it("escapes html special chars", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
  it("makes JSON safe for a script element and still round-trips", () => {
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    const value = { s: `</script><img src=x onerror=alert(1)>&${LS}${PS}` };
    const json = safeJsonForScript(value);
    for (const ch of ["<", ">", "&", LS, PS]) expect(json).not.toContain(ch);
    expect(JSON.parse(json)).toEqual(value);
  });
});
