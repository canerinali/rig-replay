import { describe, expect, it } from "vitest";
import { extractPatchPaths } from "../src/parsers/applyPatch.js";

describe("extractPatchPaths", () => {
  it("extracts add/update/delete/move headers in order", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/a.ts",
      "*** Move to: src/b.ts",
      "@@",
      "-x",
      "+y",
      "*** Add File: src/new file.ts",
      "+hello",
      "*** Delete File: /abs/old.ts",
      "*** End Patch",
    ].join("\n");
    expect(extractPatchPaths(patch)).toEqual([
      { path: "src/a.ts", op: "update" },
      { path: "src/b.ts", op: "move" },
      { path: "src/new file.ts", op: "add" },
      { path: "/abs/old.ts", op: "delete" },
    ]);
  });

  it("ignores content lines that merely look like headers and handles CRLF", () => {
    const patch = "*** Begin Patch\r\n*** Update File: a.ts\r\n+*** Add File: fake.ts\r\n*** End Patch\r\n";
    expect(extractPatchPaths(patch)).toEqual([{ path: "a.ts", op: "update" }]);
  });

  it("trims header paths and stays linear on long whitespace runs", () => {
    expect(extractPatchPaths("*** Update File:   a.ts   \n*** Add File:    ")).toEqual([{ path: "a.ts", op: "update" }]);
    const evil = `*** Update File: ${" ".repeat(200_000)}x`;
    const t0 = performance.now();
    expect(extractPatchPaths(evil)).toEqual([{ path: "x", op: "update" }]);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it("returns nothing for non-patch text", () => {
    expect(extractPatchPaths("hello world")).toEqual([]);
    expect(extractPatchPaths("")).toEqual([]);
  });
});
