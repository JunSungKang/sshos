import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  root,
  localPath,
  runtimeEnvironment,
  closeTestApplication,
} from "./environment.mjs";
import { startSSHFixture } from "./fixtures/ssh-server.mjs";
const base = localPath(`fixtures/remote-desktop-${randomUUID()}`),
  env = runtimeEnvironment(`remote-desktop-${randomUUID()}`);
Object.assign(process.env, env);
const { default: executablePath } = await import("electron");
let application, fixture;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5mQAAAAASUVORK5CYII=",
  "base64",
);
try {
  await fs.mkdir(join(base, "etc"), { recursive: true });
  await fs.writeFile(
    join(base, "etc/os-release"),
    "ID=ubuntu\nVERSION_ID=24.04\n",
  );
  await fs.mkdir(join(base, "home/fixture/site/assets"), { recursive: true });
  await fs.mkdir(join(base, "home/fixture/tree/child"), { recursive: true });
  await fs.writeFile(join(base, "home/fixture/tree/child/file.txt"), "nested");
  await fs.writeFile(join(base, "home/fixture/note.txt"), "plain text");
  await fs.writeFile(join(base, "home/fixture/shared.png"), png);
  await fs.writeFile(join(base, "home/fixture/site/assets/picture.png"), png);
  await fs.writeFile(
    join(base, "home/fixture/site/assets/style.css"),
    "h1{color:rgb(12,34,56)}",
  );
  await fs.writeFile(
    join(base, "home/fixture/site/assets/main.js"),
    'document.querySelector("#script").textContent="script ran";document.querySelector("#authority").textContent=typeof window.sshOS+":"+typeof require;fetch("https://example.invalid/forbidden").then(()=>document.body.dataset.network="allowed").catch(()=>document.body.dataset.network="blocked");',
  );
  await fs.writeFile(
    join(base, "home/fixture/site/index.html"),
    '<html><head><link rel="stylesheet" href="assets/style.css"></head><body><h1>Remote document</h1><p id="script">script off</p><p id="authority"></p><img id="local" src="assets/picture.png"><img id="outside" src="../shared.png"><script src="assets/main.js"></script></body></html>',
  );
  fixture = await startSSHFixture(base, {
    shell: ({ accept }) => {
      const stream = accept();
      stream.write("fixture console\r\n$ ");
      stream.on("data", (bytes) => stream.write(bytes));
    },
  });
  application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${env.SSHOS_RUNTIME_ROOT}`, root],
    cwd: root,
    env,
    timeout: 20000,
  });
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1600,1000));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page
    .getByTestId("engine-state")
    .filter({ hasText: "연결 엔진 준비됨" })
    .waitFor();
  await page.evaluate(async (port) => {
    const profile = await window.sshOS.profile.create({
      name: "Remote Desktop",
      host: "127.0.0.1",
      port,
      username: "fixture",
      authentication: "password",
    });
    await window.sshOS.session.connect(profile.id, {
      password: "test-only",
      saveSecret: false,
    });
  }, fixture.port);
  await page.getByRole("button", { name: "지문을 확인하고 연결" }).click();
  const home = page.locator(".desktop-home:visible");
  await expect(
    home.locator(".desktop-entry").filter({ hasText: "note.txt" }),
  ).toBeVisible();
  const item = (name) =>
    home.locator(".desktop-entry").filter({ hasText: name });
  await item("note.txt").click({ button: "right" });
  let menu = page.getByRole("menu", { name: "파일 작업" });
  for (const text of ["열기", "삭제", "이름 바꾸기", "속성 보기"])
    await expect(
      menu.getByRole("menuitem", { name: text, exact: true }),
    ).toBeVisible();
  await menu.getByRole("menuitem", { name: "속성 보기" }).click();
  let dialog = page.getByRole("dialog", { name: "속성 보기" });
  await expect(
    dialog.getByText("/home/fixture/note.txt", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("소유자 UID", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await item("tree").click({ button: "right" });
  await page.getByRole("menuitem", { name: "이름 바꾸기" }).click();
  dialog = page.getByRole("dialog", { name: "이름 변경 확인" });
  await dialog.getByLabel("새 이름").fill("renamed tree");
  await dialog.getByRole("button", { name: "서버와 경로 미리 보기" }).click();
  await dialog.getByRole("button", { name: "확인하고 작업 시작" }).click();
  await expect(item("renamed tree")).toBeVisible();
  assert.equal(
    await fs.readFile(
      join(base, "home/fixture/renamed tree/child/file.txt"),
      "utf8",
    ),
    "nested",
  );
  await item("renamed tree").click({ button: "right" });
  await page.getByRole("menuitem", { name: "삭제", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "삭제 확인" });
  await dialog.getByRole("button", { name: "서버와 경로 미리 보기" }).click();
  await expect(dialog).toContainText("모든 파일·폴더");
  await dialog.getByRole("button", { name: "확인하고 작업 시작" }).click();
  await expect(item("renamed tree")).toHaveCount(0);
  await assert.rejects(fs.stat(join(base, "home/fixture/renamed tree")));
  assert.equal(
    fixture.metrics.commands.filter((c) => c.startsWith("/usr/bin/rm ")).length,
    1,
  );
  await item("site").dblclick();
  const explorer = page.getByRole("region", {
    name: "파일 · Remote Desktop",
    exact: true,
  });
  await explorer
    .getByRole("listitem")
    .filter({ hasText: "index.html" })
    .dblclick();
  const pane = page.locator(".web-preview-pane");
  await expect(pane.getByText("index.html", { exact: true })).toBeVisible();
  const inspect = (expression) =>
    application
      .evaluate(async ({ webContents }, expression) => {
        const target = webContents
          .getAllWebContents()
          .find((c) => c.getURL().startsWith("sshos-web:"));
        if (!target) return null;
        const attached = target.debugger.isAttached();
        if (!attached) target.debugger.attach("1.3");
        try {
          const result = await target.debugger.sendCommand("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true,
          });
          if (result.exceptionDetails)
            throw Error(result.exceptionDetails.text);
          return result.result.value;
        } finally {
          if (!attached) target.debugger.detach();
        }
      }, expression)
      .catch(() => null);
  await expect
    .poll(() => inspect('document.querySelector("h1")?.textContent'))
    .toBe("Remote document");
  await expect
    .poll(() => inspect('document.querySelector("#local").naturalWidth'))
    .toBe(1);
  assert.equal(
    await inspect('document.querySelector("#script").textContent'),
    "script off",
  );
  assert.equal(
    await inspect('getComputedStyle(document.querySelector("h1")).color'),
    "rgb(12, 34, 56)",
  );
  assert.equal(
    await inspect('document.querySelector("#outside").naturalWidth'),
    0,
  );
  await pane
    .getByRole("checkbox", { name: "이 창에서 JavaScript 허용" })
    .click();
  await expect(
    pane.getByRole("checkbox", { name: "이 창에서 JavaScript 허용" }),
  ).toBeChecked();
  await expect
    .poll(() => inspect('document.querySelector("#script")?.textContent'))
    .toBe("script ran");
  assert.equal(
    await inspect('document.querySelector("#authority").textContent'),
    "undefined:undefined",
  );
  await expect
    .poll(() => inspect("document.body.dataset.network"))
    .toBe("blocked");
  await pane.getByLabel("웹 리소스 루트").fill("/home/fixture");
  await pane.getByRole("button", { name: "루트 적용", exact: true }).click();
  await expect
    .poll(() => inspect('document.querySelector("#outside")?.naturalWidth'))
    .toBe(1);
  const visible = () =>
    application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]
        .contentView.children.filter(
          (v) => v.constructor.name === "WebContentsView",
        )
        .map((v) => ({ visible: v.getVisible(), bounds: v.getBounds() })),
    );
  await expect
    .poll(async () => (await visible()).filter((v) => v.visible).length)
    .toBe(1);
  const bounds = (await visible()).find((v) => v.visible).bounds;
  assert.ok(bounds.x >= 184 && bounds.y >= 48 && bounds.width > 200);
  await page.screenshot({
    path: join(localPath("evidence"), "remote-desktop-web.png"),
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect
    .poll(async () => (await visible()).some((v) => v.visible))
    .toBe(false);
  await page.getByRole("button", { name: "설정 닫기", exact: true }).click();
  await expect
    .poll(async () => (await visible()).some((v) => v.visible))
    .toBe(true);
  await page.mouse.click(bounds.x + 20, bounds.y + 20);
  await page.waitForTimeout(150);
  assert.equal(
    (await visible()).some((v) => v.visible),
    true,
  );
  await page
    .getByRole("button", {
      name: "웹 미리보기 · Remote Desktop 최대화 또는 복원",
      exact: true,
    })
    .click();
  await expect
    .poll(
      async () => (await visible()).find((v) => v.visible)?.bounds.width ?? 0,
    )
    .toBeGreaterThan(bounds.width);
  await page
    .getByRole("button", {
      name: "웹 미리보기 · Remote Desktop 최대화 또는 복원",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Console", exact: true }).click();
  await expect
    .poll(async () => (await visible()).some((v) => v.visible))
    .toBe(false);
  await expect(
    page
      .locator(".console-workspace:visible")
      .getByText("입력 가능", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Desktop", exact: true }).click();
  await expect
    .poll(async () => (await visible()).some((v) => v.visible))
    .toBe(true);
  assert.equal(fixture.metrics.readDirs, 0);
  assert.ok(
    fixture.metrics.openedPaths.includes("/home/fixture/site/assets/style.css"),
  );
  await page
    .getByRole("button", {
      name: "웹 미리보기 · Remote Desktop 닫기",
      exact: true,
    })
    .click();
  await expect
    .poll(() =>
      application.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .some((c) => c.getURL().startsWith("sshos-web:")),
      ),
    )
    .toBe(false);
  const report = {
    status: "pass",
    assertions: [
      "Desktop right-click Open/Delete/Rename/Properties menu",
      "live SSH properties",
      "nonempty folder rename with child preservation",
      "one recursive server delete command",
      "zero SFTP READDIR",
      "isolated Chromium HTML with relative CSS and image resources over SFTP",
      "scripts default off and explicitly enabled per preview",
      "no preload/require/SSH authority",
      "external network blocked",
      "explicit root expansion",
      "native preview bounds and Settings overlay visibility",
      "closing preview disposes its webContents",
    ],
    limitation:
      "Actual Electron on current macOS host with ssh2 command adapter; no real Ubuntu/GNU CLI/native-target acceptance claim",
  };
  await fs.writeFile(
    join(localPath("evidence"), "remote-desktop-web.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  if (application) await closeTestApplication(application);
  await fixture?.close();
  await fs.rm(base, { recursive: true, force: true });
  await fs.rm(env.SSHOS_RUNTIME_ROOT, { recursive: true, force: true });
}
