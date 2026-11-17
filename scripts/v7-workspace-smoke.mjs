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
const base = localPath(`fixtures/v7-${randomUUID()}`),
  env = runtimeEnvironment(`v7-${randomUUID()}`);
Object.assign(process.env, env);
const { default: executablePath } = await import("electron");
let application, fixture;
const inputs = [],
  streams = [];
try {
  await fs.mkdir(join(base, "etc"), { recursive: true });
  await fs.writeFile(
    join(base, "etc/os-release"),
    "ID=ubuntu\nVERSION_ID=24.04\n",
  );
  await fs.mkdir(join(base, "home/fixture/projects"), { recursive: true });
  await fs.writeFile(
    join(base, "home/fixture/readme.txt"),
    "Home fixture text",
  );
  await fs.writeFile(join(base, "home/fixture/.secret"), "hidden");
  await fs.writeFile(
    join(base, "home/fixture/projects/nested.txt"),
    "Nested fixture",
  );
  fixture = await startSSHFixture(base, {
    exec: ({ command, accept, reject }) => {
      if (command.includes("getent passwd")) {
        const c = accept();
        c.write("1000\nfixture:x:1000:1000::/home/fixture:/bin/bash\n");
        c.exit(0);
        c.end();
      } else if (command === "/bin/true") {
        const c = accept();
        c.exit(0);
        c.end();
      } else reject();
    },
    shell: ({ accept }) => {
      const c = accept();
      streams.push(c);
      c.write("fixture terminal\r\n$ ");
      c.on("data", (bytes) => {
        inputs.push(Buffer.from(bytes));
        c.write(bytes);
      });
    },
  });
  application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${env.SSHOS_RUNTIME_ROOT}`, root],
    cwd: root,
    env,
    timeout: 15000,
  });
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page
    .getByTestId("engine-state")
    .filter({ hasText: "연결 엔진 준비됨" })
    .waitFor();
  const firstProfile = await page.evaluate(async (port) => {
    const profile = await window.sshOS.profile.create({
      name: "v7 fixture",
      host: "127.0.0.1",
      port,
      username: "fixture",
      authentication: "password",
    });
    await window.sshOS.session.connect(profile.id, {
      password: "test-only",
      saveSecret: false,
    });
    return profile.id;
  }, fixture.port);
  await page.getByRole("button", { name: "지문을 확인하고 연결" }).click();
  await expect
    .poll(() =>
      page
        .locator(".brand img")
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
  const home = page.locator(".desktop-home:visible");
  await expect(home.locator(".desktop-entry")).toHaveCount(2);
  await expect(home.getByText("projects", { exact: true })).toBeVisible();
  await expect(home.getByText(".secret", { exact: true })).toHaveCount(0);
  await home
    .locator(".desktop-entry")
    .filter({ hasText: "projects" })
    .dblclick();
  await expect(
    page
      .locator(".internal-window:visible")
      .getByText("nested.txt", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: join(localPath("evidence"), "v7-desktop.png"),
  });
  const palette = await page
    .locator(".desktop")
    .evaluate((node) => ({
      background: getComputedStyle(node).backgroundColor,
      color: getComputedStyle(node).color,
    }));
  assert.deepEqual(palette, {
    background: "rgb(33, 26, 22)",
    color: "rgb(232, 223, 210)",
  });
  const fileWindow = page.getByRole("region", {
    name: "파일 · v7 fixture",
    exact: true,
  });
  await expect(
    fileWindow.getByRole("button", {
      name: "파일 · v7 fixture 최소화",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    fileWindow.getByRole("button", {
      name: "파일 · v7 fixture 최대화 또는 복원",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settingsWindow = page.getByRole("region", {
    name: "설정",
    exact: true,
  });
  for (const name of ["설정 최소화", "설정 최대화 또는 복원"]) {
    const control = settingsWindow.getByRole("button", {
      name,
      exact: true,
      includeHidden: true,
    });
    await expect(control).toHaveCount(1);
    await expect(control).toBeHidden();
  }
  await expect(
    settingsWindow.getByRole("button", { name: "설정 닫기", exact: true }),
  ).toBeVisible();
  const checkbox = page.getByRole("checkbox", { name: "숨김파일 보기" });
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await window.sshOS.settings.get()).showHiddenFiles,
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "설정 닫기", exact: true }).click();
  await expect(home.locator(".desktop-entry")).toHaveCount(3);
  await page.getByRole("button", { name: "Console", exact: true }).click();
  await expect(
    page
      .locator(".console-workspace:visible")
      .getByText("입력 가능", { exact: true }),
  ).toBeVisible();
  await expect.poll(() => fixture.metrics.shells).toBe(1);
  const terminal = page.locator(
    ".console-workspace:visible .xterm-helper-textarea",
  );
  await terminal.focus();
  await page.keyboard.type("vi readme.txt");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => Buffer.concat(inputs).toString())
    .toContain("vi readme.txt");
  const sent = Buffer.concat(inputs).toString();
  for (let i = 0; i < 10; i++) {
    await page.getByRole("button", { name: "Desktop", exact: true }).click();
    await page.getByRole("button", { name: "Console", exact: true }).click();
  }
  assert.equal(fixture.metrics.shells, 1);
  assert.equal(Buffer.concat(inputs).toString(), sent);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: "숨김파일 보기" }).click();
  await expect(
    page.getByRole("checkbox", { name: "숨김파일 보기" }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "설정 닫기", exact: true }).click();
  assert.equal(fixture.metrics.shells, 1);
  await page.screenshot({
    path: join(localPath("evidence"), "v7-console.png"),
  });
  await page.getByRole("button", { name: "Desktop", exact: true }).click();
  await expect(home.locator(".desktop-entry")).toHaveCount(2);
  const status = page.locator(".sidebar-status");
  await expect(status).toContainText("v7 fixture");
  const bounds = await status.boundingBox();
  assert.ok(bounds.x < 184 && bounds.y > 700);
  // A hidden live terminal must answer protocol requests without accepting hidden local keys.
  const replies = () =>
    [
      ...Buffer.concat(inputs)
        .toString()
        .matchAll(/\x1b\[\d+;\d+R/gu),
    ].length;
  async function requestCursor() {
    const before = replies();
    streams[0].write("\x1b[6n");
    await expect.poll(replies).toBe(before + 1);
  }
  await expect(
    page.locator(".console-workspace .xterm-helper-textarea").first(),
  ).toBeDisabled();
  await requestCursor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await requestCursor();
  await page.getByRole("button", { name: "설정 닫기", exact: true }).click();
  await page.getByRole("button", { name: "Console", exact: true }).click();
  await page.getByRole("button", { name: "새 터미널", exact: true }).click();
  await expect.poll(() => streams.length).toBe(2);
  await expect(
    page
      .locator(".console-workspace:visible")
      .getByText("입력 가능", { exact: true }),
  ).toBeVisible();
  await requestCursor();
  await expect(
    page.locator(".console-workspace .xterm-helper-textarea").first(),
  ).toBeDisabled();
  // Window-list activation resolves the mode/panel/server before restoring the window.
  async function showWindows() {
    await page.evaluate(() =>
      window.dispatchEvent(new Event("sshos-open-window-list")),
    );
    return page.getByRole("dialog", { name: "열린 창 목록" });
  }
  await page.getByRole("button", { name: "Desktop", exact: true }).click();
  let list = await showWindows();
  await list
    .locator("li")
    .filter({ hasText: "터미널 1" })
    .getByRole("button", { name: "창으로 이동" })
    .click();
  await expect(
    page.getByRole("button", { name: "Console", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".console-workspace:visible")).toHaveAttribute(
    "aria-label",
    "터미널 1 · v7 fixture",
  );
  list = await showWindows();
  await list
    .locator("li")
    .filter({ hasText: "설정" })
    .getByRole("button", { name: "창으로 이동" })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "숨김파일 보기" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "설정 닫기", exact: true }).click();
  const secondProfile = await page.evaluate(async (port) => {
    const p = await window.sshOS.profile.create({
      name: "other fixture",
      host: "127.0.0.1",
      port,
      username: "fixture",
      authentication: "password",
    });
    await window.sshOS.session.connect(p.id, {
      password: "test-only",
      saveSecret: false,
    });
    return p.id;
  }, fixture.port);
  await expect(
    page.getByRole("region", { name: "서버 작업 공간", exact: true }),
  ).toHaveAttribute("data-selected-server", secondProfile);
  list = await showWindows();
  await list
    .locator("li")
    .filter({ hasText: "파일 · v7 fixture" })
    .getByRole("button", { name: "창으로 이동" })
    .click();
  await expect(
    page.getByRole("region", { name: "서버 작업 공간", exact: true }),
  ).toHaveAttribute("data-selected-server", firstProfile);
  await expect(
    page.getByRole("button", { name: "Desktop", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page
      .locator(".internal-window:visible")
      .getByText("nested.txt", { exact: true }),
  ).toBeVisible();
  // A former sFTP panel becomes a normal closable explorer on Desktop.
  await page.getByRole("button", { name: "sFTP", exact: true }).click();
  await page.getByRole("button", { name: "Desktop", exact: true }).click();
  const explorer = page.getByRole("region", {
    name: "파일 · v7 fixture",
    exact: true,
  });
  const explorerId = await explorer.getAttribute("data-window-id");
  await explorer
    .getByRole("button", { name: "파일 · v7 fixture 닫기", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        async (id) =>
          (await window.sshOS.desktop.getWindowSnapshot()).some(
            (row) => row.windowId === id,
          ),
        explorerId,
      ),
    )
    .toBe(false);
  console.log(
    JSON.stringify({
      status: "pass",
      checks: [
        "actual home icon listing",
        "folder opens correct explorer",
        "hidden preference persists after ACK and updates all views",
        "single PTY across 20 mode transitions",
        "no injected/replayed commands",
        "bottom-left server response status",
        "hidden Desktop/settings/tab terminal protocol replies",
        "window list reveals mode/server/panel",
        "former sFTP explorer closes and releases its resource",
      ],
      limitation:
        "Current host and loopback SSH; target native accessibility, real vi process, full transfer/fault matrix remain separate.",
    }),
  );
} catch (error) {
  if (application) {
    const page = await application.firstWindow();
    console.error((await page.locator("body").innerText()).slice(-5000));
    await page
      .screenshot({ path: join(localPath("evidence"), "v7-failure.png") })
      .catch(() => {});
  }
  throw error;
} finally {
  if (application) await closeTestApplication(application);
  if (fixture) await fixture.close();
  await fs.rm(base, { recursive: true, force: true });
  await fs.rm(env.SSHOS_RUNTIME_ROOT, { recursive: true, force: true });
}
