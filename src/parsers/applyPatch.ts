export type PatchOp = "add" | "update" | "delete" | "move";

export interface PatchPath {
  path: string;
  op: PatchOp;
}

const HEADER = /^\*\*\* (Add File|Update File|Delete File|Move to): (.*)$/;

const OPS: Record<string, PatchOp> = {
  "Add File": "add",
  "Update File": "update",
  "Delete File": "delete",
  "Move to": "move",
};

/**
 * Extract the file paths touched by a Codex `apply_patch` envelope
 * (`*** Begin Patch` ... `*** End Patch`). Paths are returned exactly as written
 * (usually relative to the session cwd); callers resolve them.
 */
export function extractPatchPaths(patchText: string): PatchPath[] {
  const out: PatchPath[] = [];
  for (const raw of patchText.split(/\r?\n/)) {
    const m = HEADER.exec(raw);
    if (!m) continue;
    const p = m[2]!.trim();
    if (p) out.push({ path: p, op: OPS[m[1]!]! });
  }
  return out;
}
