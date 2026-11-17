import { _electron as electron, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rm,
  readFile,
  writeFile,
  readdir,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { cpus, totalmem, release } from "node:os";
import { execFileSync } from "node:child_process";
import { strict as assert } from "node:assert";
import {
  root,
  localPath,
  runtimeEnvironment,
  closeTestApplication,
} from "./environment.mjs";
const require = createRequire(import.meta.url),
  { ReceiptRepository } = require(
    join(root, "dist/main/persistence/receipts.js"),
  ),
  { TransferController } = require(
    join(root, "dist/main/transfers/transfers.js"),
  );
const destination = localPath(`performance/local-${Date.now()}`),
  owned = [],
  registration = [],
  launch = [],
  ui = [],
  memory = [];
let application;
const nearest = (values, p) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
async function hashes(directory) {
  const result = {};
  for (const row of await readdir(join(root, directory), {
    withFileTypes: true,
  })) {
    const path = `${directory}/${row.name}`;
    if (row.isDirectory()) Object.assign(result, await hashes(path));
    else if (row.isFile())
      result[path] = createHash("sha256")
        .update(await readFile(join(root, path)))
        .digest("hex");
  }
  return result;
}
const sourceHashes = { ...(await hashes("src")), ...(await hashes("scripts")) };
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  sourceDirty =
    execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
    }).trim().length > 0;
try {
  for (let iteration = 0; iteration < 5; iteration++) {
    const directory = await mkdtemp(
      join(localPath("tmp"), "performance-receipts-"),
    );
    owned.push(directory);
    await mkdir(join(directory, "data"));
    const repo = await ReceiptRepository.open(join(directory, "data")),
      epoch = randomUUID(),
      serverId = randomUUID(),
      sessionToken = randomUUID(),
      now = new Date().toISOString();
    const specs = Array.from({ length: 100 }, (_, index) => {
      const taskId = randomUUID();
      return {
        localDirectory: { path: directory, identity: "fixture-only" },
        row: {
          kind: "file_transfer",
          taskId,
          serverId,
          generation: 1,
          backendEpoch: epoch,
          direction: "upload",
          endpointSnapshot: {
            name: "performance fixture",
            host: "example.invalid",
            port: 22,
            username: "fixture",
            endpoint: "example.invalid:22",
          },
          hostKeyFingerprint: "SHA256:fixture",
          source: join(directory, `source-${index}`),
          destination: `/home/fixture/destination-${index}`,
          tempPath: `/home/fixture/.sshos-${taskId}.part`,
          remoteParent: "/home/fixture",
          localParent: directory,
          sourceInitialStat: {
            size: 10 * 1024 * 1024,
            mtime: "1",
            identity: "fixture-source",
          },
          totalBytes: 10 * 1024 * 1024,
          transferredBytes: 0,
          verifiedBytes: 0,
          streamSha256: null,
          phase: "queued",
          stage: "queued",
          cleanupState: "none",
          tempCreated: false,
          destinationCreated: false,
          dispatchAllowed: false,
          lastConfirmedPhase: "queued",
          errorCode: null,
          lateObservations: [],
          recoveryUncertain: false,
          recoveredFromPhase: null,
          acknowledgedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      };
    });
    let commits = 0,
      stages = 0,
      released = 0;
    const batch = {
      serverId,
      generation: 1,
      sessionToken,
      epoch,
      specs,
      selectionTokens: [],
    };
    const gateway = {
      epoch,
      request: async (request) => {
        if (request.action === "transfer:stage") stages++;
        if (request.action === "transfer:commit") {
          assert.equal(repo.snapshots().length, 100);
          commits++;
          return specs.map((row) => row.row.taskId);
        }
        return undefined;
      },
    };
    const controller = new TransferController(
        { consume: () => batch },
        {
          release: () => {
            released++;
          },
        },
        { sessionCapability: () => ({ serverId, generation: 1 }) },
        gateway,
        () => repo,
        () => true,
        async () => {},
      ),
      started = performance.now();
    const ids = await controller.handle("transfer:start", randomUUID());
    await controller.settled();
    await repo.settled();
    const elapsedMs = performance.now() - started;
    assert.equal(ids.length, 100);
    assert.equal(commits, 1);
    assert.equal(stages, 100);
    assert.equal(released, 1);
    assert.equal(controller.shelf().queued, 100);
    assert.equal(
      (await readdir(repo.root)).filter((name) => name.endsWith(".json"))
        .length,
      100,
    );
    registration.push({
      iteration: iteration + 1,
      elapsedMs,
      records: 100,
      staged: stages,
      commits,
      durable: true,
    });
    console.log(
      `Durable100 registration ${iteration + 1}/5: ${elapsedMs.toFixed(1)}ms`,
    );
  }
  for (let iteration = 0; iteration < 5; iteration++) {
    const env = runtimeEnvironment(`performance-${randomUUID()}`);
    owned.push(env.SSHOS_RUNTIME_ROOT);
    Object.assign(process.env, env);
    const { default: executablePath } = await import("electron"),
      started = performance.now();
    application = await electron.launch({
      executablePath,
      args: [`--user-data-dir=${env.SSHOS_RUNTIME_ROOT}`, root],
      cwd: root,
      env,
      timeout: 15000,
    });
    const page = await application.firstWindow();
    await page
      .getByTestId("engine-state")
      .filter({ hasText: "연결 엔진 준비됨" })
      .waitFor();
    await expect(
      page.getByRole("button", { name: "서버 추가", exact: true }),
    ).toBeEnabled();
    launch.push({
      iteration: iteration + 1,
      elapsedMs: performance.now() - started,
      mode: "warm development launch; OS caches not cleared",
    });
    if (iteration === 4) {
      await page.evaluate(() => {
        window.__sshosPerformance = [];
        document.addEventListener(
          "click",
          (event) => {
            if (!event.target.closest?.(".mode-switch button")) return;
            const start = performance.now();
            requestAnimationFrame(() =>
              requestAnimationFrame(() =>
                window.__sshosPerformance.push(performance.now() - start),
              ),
            );
          },
          true,
        );
      });
      for (let index = 0; index < 100; index++) {
        await page
          .getByRole("button", {
            name: index % 2 ? "Desktop" : "Console",
            exact: true,
          })
          .click();
        await expect
          .poll(() => page.evaluate(() => window.__sshosPerformance.length))
          .toBe(index + 1);
      }
      ui.push(...(await page.evaluate(() => window.__sshosPerformance)));
      await page.screenshot({ path: join(destination, "desktop.png") });
      memory.push(
        ...(await application.evaluate(({ app }) =>
          app
            .getAppMetrics()
            .map((row) => ({
              pid: row.pid,
              type: row.type,
              workingSetKiB: row.memory.workingSetSize,
              cpuPercent: row.cpu.percentCPUUsage,
            })),
        )),
      );
    }
    await closeTestApplication(application);
    application = null;
    console.log(`Warm development launch ${iteration + 1}/5 recorded`);
  }
  const current = { ...(await hashes("src")), ...(await hashes("scripts")) };
  assert.equal(
    JSON.stringify(sourceHashes),
    JSON.stringify(current),
    "Source changed during measurement",
  );
  const report = {
    schemaVersion: 1,
    status: "partial",
    localMeasurements: "pass",
    acceptanceStatus: "untested",
    sourceRevision: revision,
    sourceDirty,
    sourceHashes,
    environment: {
      platform: process.platform,
      architecture: process.arch,
      osRelease: release(),
      logicalCPUs: cpus().length,
      cpu: cpus()[0]?.model,
      totalMemoryBytes: totalmem(),
      network:
        "No remote network workload; fake worker for registration; no impairment calibration",
    },
    registration: {
      scope:
        "Real main TransferController +100 exclusive durable atomic JSON records; in-process worker RPC adapter, no SSH transfer or source file IO",
      runs: registration,
      p95Ms: nearest(
        registration.map((row) => row.elapsedMs),
        0.95,
      ),
    },
    warmLaunch: {
      scope:
        "Unpackaged actual Electron warm launch to enabled connection controls; not cold/portable extraction",
      runs: launch,
    },
    uiFeedback: {
      scope:
        "Actual100 trusted clicks; event capture to second renderer animation frame, not OS compositor presentation",
      samplesMs: ui,
      p95Ms: nearest(ui, 0.95),
      maxMs: Math.max(...ui),
    },
    memorySnapshot: {
      scope:
        "One getAppMetrics snapshot only; not a settled300-sample memory acceptance test; shared pages may count more than once",
      processes: memory,
      sumWorkingSetKiB: memory.reduce((sum, row) => sum + row.workingSetKiB, 0),
    },
    untested: [
      "Windows11x64/macOS14arm64/x64 native signed/portable launch and cold caches",
      "100Mbps/RTT40ms/loss0 and5 repetitions on qualifying hardware",
      "60s settle +300 one-second whole-app memory/CPU samples in all specified states",
      "10000-row listing, two1GiB transfers while browsing, full40MP/6-channel/12-window load",
      "100 full connection/transfer/cancel/viewer/PTY cycles and handle/socket/timer stability",
      "Native scale/IME/assistive technology checks",
    ],
    limitation:
      "Local diagnostic measurements cannot satisfy the target performance criteria. Exit2 deliberately preserves the acceptance gap.",
  };
  await writeFile(
    join(destination, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    `Partial performance evidence: ${relative(root, destination)}/report.json`,
  );
  process.exitCode = 2;
} catch (error) {
  await writeFile(join(destination, "failure.txt"), String(error) + "\n");
  throw error;
} finally {
  if (application) await closeTestApplication(application);
  for (const directory of owned)
    await rm(directory, { recursive: true, force: true });
}
