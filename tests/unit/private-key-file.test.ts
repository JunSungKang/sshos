import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  MAX_PRIVATE_KEY_BYTES,
  readPrivateKeyFile,
} from "../../src/main/connections/read-private-key";
const owned: string[] = [];
afterEach(async () => {
  for (const path of owned.splice(0)) await rm(path, { recursive: true });
});
async function fixture() {
  await mkdir(resolve(".local/tmp"), { recursive: true });
  const root = await mkdtemp(resolve(".local/tmp/key-files-"));
  owned.push(root);
  return root;
}
describe("bounded main-owned key read", () => {
  it("returns exact bytes through the maximum without exposing or truncating input", async () => {
    const root = await fixture(),
      path = join(root, "key"),
      bytes = Buffer.alloc(MAX_PRIVATE_KEY_BYTES, 65);
    await writeFile(path, bytes);
    const read = await readPrivateKeyFile(path);
    expect(read.equals(bytes)).toBe(true);
    read.fill(0);
    expect((await readPrivateKeyFile(path)).equals(bytes)).toBe(true);
  });
  it("refuses empty, oversized, non-file, symlink and missing entries with a fixed error and no path", async () => {
    const root = await fixture();
    await writeFile(join(root, "empty"), "");
    await writeFile(
      join(root, "large"),
      Buffer.alloc(MAX_PRIVATE_KEY_BYTES + 1),
    );
    await symlink(join(root, "large"), join(root, "link"));
    for (const path of [
      root,
      join(root, "empty"),
      join(root, "large"),
      join(root, "link"),
      join(root, "missing"),
    ])
      await expect(readPrivateKeyFile(path)).rejects.toThrow(/^KEY_INVALID$/u);
  });
});
