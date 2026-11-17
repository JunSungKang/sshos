import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { localPath } from "./environment.mjs";
import { startSSHFixture } from "./fixtures/ssh-server.mjs";
const require = createRequire(import.meta.url),
  { Client } = require("ssh2"),
  { FileBrowser } = require("../dist/worker/remote-files/browser.js");
const base = localPath(`fixtures/metadata-benchmark-${randomUUID()}`),
  results = [];
let fixture, client;
try {
  await fs.mkdir(join(base, "home/fixture"), { recursive: true });
  for (let i = 0; i < 10000; i += 100)
    await Promise.all(
      Array.from({ length: Math.min(100, 10000 - i) }, (_, j) =>
        fs.writeFile(
          join(
            base,
            "home/fixture",
            `file-${String(i + j).padStart(5, "0")}.txt`,
          ),
          "test",
        ),
      ),
    );
  for (const count of [100, 1000, 10000]) {
    const path = `/home/count-${count}`;
    await fs.mkdir(join(base, path), { recursive: true });
    const names = await fs.readdir(join(base, "home/fixture"));
    for (let i = 0; i < count; i += 100)
      await Promise.all(
        names
          .slice(i, Math.min(count, i + 100))
          .map((name) =>
            fs.link(join(base, "home/fixture", name), join(base, path, name)),
          ),
      );
    for (const delayMs of [0, 50, 150]) {
      fixture = await startSSHFixture(base, { metadataDelayMs: delayMs });
      client = new Client();
      await new Promise((done, reject) => {
        client.once("ready", done).once("error", reject);
        client.connect({
          host: "127.0.0.1",
          port: fixture.port,
          username: "fixture",
          password: "test-only",
          hostVerifier: () => true,
        });
      });
      const sftp = await new Promise((done, reject) =>
        client.sftp((error, value) => (error ? reject(error) : done(value))),
      );
      const legacyStart = performance.now();
      const legacy = await new Promise((done, reject) =>
        sftp.readdir(path, (error, value) =>
          error ? reject(error) : done(value),
        ),
      );
      const legacyMs = performance.now() - legacyStart;
      assert.equal(legacy.length, count);
      const access = {
          client,
          check() {},
          quarantine() {
            client.destroy();
          },
        },
        browser = new FileBrowser(() => access),
        start = performance.now();
      const page = await browser.list("benchmark", 1, "browser", path);
      const commandMs = performance.now() - start;
      if (page.total !== legacy.length || page.total !== count)
        throw Error("Benchmark outputs differ");
      const observed = [];
      let current = page;
      while (true) {
        observed.push(...current.entries);
        if (current.nextOffset === null) break;
        current = browser.page(
          "benchmark",
          1,
          "browser",
          current.nextOffset,
          page.snapshotId,
        );
      }
      const expected = legacy
        .map((entry) => ({
          name: entry.filename,
          size: entry.attrs.size,
          mtime: entry.attrs.mtime,
          mode: entry.attrs.mode & 0o7777,
          uid: entry.attrs.uid,
          gid: entry.attrs.gid,
        }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      assert.deepEqual(
        observed.map((entry) => ({
          name: entry.name,
          size: entry.size,
          mtime: entry.mtime,
          mode: entry.mode,
          uid: entry.uid,
          gid: entry.gid,
        })),
        expected,
      );
      results.push({
        entries: count,
        serverResponseDelayMs: delayMs,
        sftpEnumerationMs: legacyMs,
        commandEnumerationMs: commandMs,
        sftpRequests: fixture.metrics.readDirRequests,
        commandRequests: fixture.metrics.metadataCommands.length,
        returnedEntries: page.total,
      });
      sftp.end();
      client.end();
      await fixture.close();
      fixture = null;
      client = null;
    }
  }
  const report = {
    status: "pass",
    scope:
      "One local ssh2 adapter run per case; same names and basic attributes; persistent authenticated socket. SFTP high-level readdir uses batched READDIR with attributes; command path uses the production FileBrowser and framed adapter. Delay is imposed before server responses, not calibrated network RTT. Timings include adapter fs/encoding and localhost SSH overhead; no actual GNU command process, renderer paint, target CPU or peak-memory measurement.",
    results,
    limitations: [
      "No speed guarantee for real Ubuntu/OpenSSH.",
      "No cold-cache/repetition/p95 claim.",
      "All directory metadata is collected before the first application page; reported durations are metadata enumeration, not UI first-paint times.",
    ],
  };
  await fs.writeFile(
    join(localPath("performance"), "metadata-comparison.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  client?.destroy();
  await fixture?.close();
  await fs.rm(base, { recursive: true, force: true });
}
