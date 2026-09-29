import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";

export class UnsafeOutputError extends Error {}

/**
 * Write the report without following a symlink at the output path, with private permissions (0600).
 * `lstat` refuses a symlink up front (O_NOFOLLOW is not available on every platform); O_NOFOLLOW then
 * closes the race between the check and the open where the platform supports it.
 */
export async function writeReportFile(file: string, body: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  try {
    const st = await lstat(file);
    if (st.isSymbolicLink()) throw new UnsafeOutputError(`refusing to write through symlink ${file}`);
    if (!st.isFile()) throw new UnsafeOutputError(`refusing to overwrite non-regular file ${file}`);
  } catch (e) {
    if (e instanceof UnsafeOutputError) throw e;
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);
  let fh;
  try {
    fh = await open(file, flags, 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ELOOP") throw new UnsafeOutputError(`refusing to write through symlink ${file}`);
    throw e;
  }
  try {
    await fh.chmod(0o600);
    await fh.writeFile(body);
  } finally {
    await fh.close();
  }
}
