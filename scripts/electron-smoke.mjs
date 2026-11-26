import { _electron as electron, expect } from "@playwright/test";
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  root,
  localPath,
  runtimeEnvironment,
  closeTestApplication,
} from "./environment.mjs";
const env = runtimeEnvironment("smoke");
Object.assign(process.env, env);
const { default: executablePath } = await import("electron");
const application = await electron.launch({
  executablePath,
  args: [`--user-data-dir=${env.SSHOS_RUNTIME_ROOT}`, root],
  cwd: root,
  env,
  timeout: 15000,
});
application.process().stderr?.on("data", (data) => process.stderr.write(data));
try {
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  await page
    .getByTestId("engine-state")
    .filter({ hasText: "연결 엔진 준비됨" })
    .waitFor();
  const snapshot = await page.evaluate(() =>
    window.sshOS.lifecycle.getSnapshot(),
  );
  assert.equal(snapshot.engine, "ready");
  assert.equal(snapshot.connectedServers, 0);
  const isolation = await page.evaluate(() => ({
    require: typeof window.require,
    process: typeof window.process,
    keys: Object.keys(window.sshOS),
  }));
  assert.equal(isolation.require, "undefined");
  assert.equal(isolation.process, "undefined");
  assert.deepEqual([...isolation.keys].sort(), [
    "desktop",
    "execution",
    "file",
    "lifecycle",
    "profile",
    "relay",
    "session",
    "settings",
    "task",
    "terminal",
    "transfer",
    "trust",
    "viewer",
    "web",
  ]);
  assert.deepEqual(
    await page.evaluate(() => Object.keys(window.sshOS.web).sort()),
    ["configure", "get", "open", "present", "reload"],
  );
  assert.deepEqual(
    await page.evaluate(() => Object.keys(window.sshOS.relay).sort()),
    [
      "acknowledge",
      "cancel",
      "discard",
      "folders",
      "inspect",
      "list",
      "preview",
      "releasePreview",
      "retryPreview",
      "start",
    ],
  );
  const relayAccess = await page.evaluate(async () => {
    const token = crypto.randomUUID();
    const results = await Promise.allSettled([
      window.sshOS.relay.folders(token, "/"),
      window.sshOS.relay.preview({
        entryToken: token,
        destinationSessionToken: token,
        directory: "/",
      }),
      window.sshOS.relay.start(token),
      window.sshOS.relay.inspect(token),
      window.sshOS.relay.discard(token),
    ]);
    return {
      statuses: results.map((result) => result.status),
      jobs: await window.sshOS.relay.list(),
    };
  });
  assert.deepEqual(relayAccess, {
    statuses: Array(5).fill("rejected"),
    jobs: [],
  });
  for (const action of ["open", "get", "present", "configure"])
    assert.equal(
      await page.evaluate(async (action) => {
        try {
          const id = crypto.randomUUID();
          if (action === "open") await window.sshOS.web.open(id);
          else if (action === "get") await window.sshOS.web.get(id);
          else if (action === "present")
            await window.sshOS.web.present({
              id,
              visible: true,
              x: 0,
              y: 0,
              width: 100,
              height: 100,
            });
          else
            await window.sshOS.web.configure({
              id,
              root: "/",
              javascript: true,
            });
          return false;
        } catch {
          return true;
        }
      }, action),
      true,
    );
  const savedId = await page.evaluate(async () => {
    const created = await window.sshOS.profile.create({
      name: "로컬 저장 검사",
      host: "example.invalid",
      port: 22,
      username: "fixture",
      authentication: "password",
    });
    const profiles = await window.sshOS.profile.list();
    if (!profiles.some((row) => row.id === created.id))
      throw new Error("Profile not saved");
    return created.id;
  });
  await page.reload();
  assert.equal(
    await page.evaluate(
      async (id) =>
        (await window.sshOS.profile.list()).some((row) => row.id === id),
      savedId,
    ),
    true,
  );
  await page.evaluate((id) => window.sshOS.profile.delete(id), savedId);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settingsWindow = page.getByRole("region", {
    name: "설정",
    exact: true,
  });
  await settingsWindow.waitFor();
  const bounds = await settingsWindow.boundingBox();
  assert.ok(bounds && bounds.x >= 184 && bounds.y >= 48);
  await expect(
    page.getByRole("button", { name: "Desktop", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Console", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "설정 닫기", exact: true }).click();
  await expect(settingsWindow).toBeHidden();
  const settings = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  assert.equal(settings.nodeIntegration, false);
  assert.equal(settings.contextIsolation, true);
  assert.equal(settings.sandbox, true);
  assert.equal(settings.webSecurity, true);
  // macOS omits spellcheck from getLastWebPreferences; inspect the live Session.
  assert.deepEqual(
    await application.evaluate(({ app, session }) => ({
      spellchecker: session.defaultSession.isSpellCheckerEnabled(),
      backgroundDisabled: app.commandLine.hasSwitch(
        "disable-background-networking",
      ),
      componentUpdatesDisabled: app.commandLine.hasSwitch(
        "disable-component-update",
      ),
    })),
    {
      spellchecker: false,
      backgroundDisabled: true,
      componentUpdatesDisabled: true,
    },
  );
  const paths = await application.evaluate(({ app }) => ({
    userData: app.getPath("userData"),
    sessionData: app.getPath("sessionData"),
    crashes: app.getPath("crashDumps"),
    logs: app.getPath("logs"),
  }));
  assert.equal(paths.sessionData, join(paths.userData, "runtime"));
  assert.equal(paths.crashes, join(paths.userData, "crashes"));
  assert.equal(paths.logs, join(paths.userData, "logs"));
  const denied = await page.evaluate(async () => {
    try {
      await fetch("https://example.com");
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(denied, true);
  // DevTools evaluation can bypass the unsafe-eval CSP restriction. Inject an
  // actual page script to test inline blocking, then test eval in bundled code.
  const inlineBlocked = await page.evaluate(async () => {
    const script = document.createElement("script");
    script.textContent = "window.inlineSentinel = true";
    document.body.append(script);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return window.inlineSentinel !== true;
  });
  assert.equal(inlineBlocked, true);
  await page.screenshot({ path: `${localPath("evidence")}/d01-desktop.png` });
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].loadURL("app://ui/tests/xterm.html"),
  );
  await page.getByTestId("xterm-ready").waitFor();
  assert.equal(await page.locator(".xterm-screen").count(), 1);
  assert.equal(
    await page.getByTestId("xterm-ready").getAttribute("data-eval-blocked"),
    "true",
  );
  assert.equal(
    await page.getByTestId("xterm-ready").getAttribute("data-security"),
    "osc-rep-paste-pass",
  );
  const report = {
    status: "pass",
    platform: process.platform,
    architecture: process.arch,
    versions: snapshot.versions,
    assertions: [
      "main/preload/renderer/utilityProcess handshake",
      "sandbox, contextIsolation and Node isolation",
      "userData runtime/crash/log paths configured before Session use",
      "live Session spellchecker disabled and background networking/component update switches set by application without test-only flags",
      "profile persistence across UI reload",
      "shared mode controls and Settings overlay retain protected shell bounds",
      "renderer external fetch and eval denied",
      "xterm DOM renderer and addon-fit under production CSP",
      "public parser blocks OSC title/link/clipboard, rejects oversized REP and permits REP500",
      "paste capture preserves exact CRLF/LF and prevents xterm automatic input",
    ],
    limitation:
      "Development executable on current machine only; no packet capture, signing or Windows/Ubuntu result.",
  };
  writeFileSync(
    `${localPath("evidence")}/d01-smoke.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await closeTestApplication(application);
}
