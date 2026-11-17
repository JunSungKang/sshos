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
import { fixtureKey } from "./fixtures/keys.mjs";

const base = localPath(`fixtures/connect-cards-${randomUUID()}`);
const env = runtimeEnvironment(`connect-cards-${randomUUID()}`);
const pictures = localPath("evidence/connect-card-workspaces");
Object.assign(process.env, env);
const { default: executablePath } = await import("electron");
let application, fixture;
const inputs = [];
const layouts = [];
try {
  await fs.mkdir(join(base, "etc"), { recursive: true });
  await fs.mkdir(join(base, "home/fixture"), { recursive: true });
  await fs.writeFile(
    join(base, "etc/os-release"),
    "ID=ubuntu\nVERSION_ID=24.04\n",
  );
  await fs.writeFile(
    join(base, "home/fixture/readme.txt"),
    "Owned GUI fixture",
  );
  const keyPath = join(base, "fixture-id_ed25519");
  await fs.writeFile(keyPath, fixtureKey().private, { mode: 0o600 });
  fixture = await startSSHFixture(base, {
    exec: ({ command, accept, reject }) => {
      if (command !== "/bin/true") return reject();
      const channel = accept();
      channel.exit(0);
      channel.end();
    },
    shell: ({ accept }) => {
      const channel = accept();
      channel.write("workspace fixture\r\n$ ");
      channel.on("data", (bytes) => {
        inputs.push(Buffer.from(bytes));
        channel.write(bytes);
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
  await page.setViewportSize({ width: 1120, height: 760 });
  await page
    .getByTestId("engine-state")
    .filter({ hasText: "연결 엔진 준비됨" })
    .waitFor();
  const library = page.getByRole("region", {
    name: "연결 관리자",
    exact: true,
  });
  const popup = () => page.locator("dialog.profile-editor[open]");
  const profiles = () => page.evaluate(() => window.sshOS.profile.list());
  const add = () =>
    page.getByRole("button", { name: "서버 추가", exact: true });
  const card = (id) =>
    library.locator(`.profile-card[data-profile-id="${id}"]`);
  const workspaces = page.getByRole("region", {
    name: "서버 작업 공간",
    exact: true,
  });
  const select = (id) =>
    workspaces.locator(`button[data-server-id="${id}"]`).click();
  async function fill(name) {
    await popup().getByLabel("서버 이름", { exact: true }).fill(name);
    await popup().getByLabel("호스트", { exact: true }).fill("127.0.0.1");
    await popup()
      .getByLabel("포트", { exact: true })
      .fill(String(fixture.port));
    await popup().getByLabel("사용자명", { exact: true }).fill("fixture");
  }
  assert.equal(await library.locator("form").count(), 0);
  assert.equal(await page.locator("header select").count(), 0);
  await expect(add()).toBeInViewport({ ratio: 1 });
  await add().click();
  await expect(popup()).toBeVisible();
  await expect(popup().getByLabel("서버 이름", { exact: true })).toBeFocused();
  await fill("취소할 서버");
  await page.keyboard.press("Escape");
  await expect(popup()).toHaveCount(0);
  await expect(library).toBeVisible();
  await expect(add()).toBeFocused();
  assert.equal((await profiles()).length, 0);

  await add().click();
  await fill("개발 서버");
  // Exercise the actual main writer ACK barrier, not a mocked preload save.
  await application.evaluate(({ app }) => {
    const io = process.getBuiltinModule("node:fs/promises"),
      path = process.getBuiltinModule("node:path"),
      native = io.rename;
    app.__holdConnectSave = true;
    app.__releaseConnectSave = null;
    const state = path.join(app.getPath("userData"), "data/state.json");
    io.rename = async (source, destination) => {
      if (destination === state && app.__holdConnectSave)
        await new Promise((resolve) => {
          app.__releaseConnectSave = resolve;
        });
      return native(source, destination);
    };
  });
  await popup().getByRole("button", { name: "서버 등록", exact: true }).click();
  await expect
    .poll(() =>
      application.evaluate(({ app }) => Boolean(app.__releaseConnectSave)),
    )
    .toBe(true);
  await expect(
    popup().getByRole("button", { name: "저장 중…", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(popup()).toBeVisible();
  assert.equal((await profiles()).length, 0);
  await application.evaluate(({ app }) => {
    app.__holdConnectSave = false;
    app.__releaseConnectSave();
  });
  await expect(popup()).toHaveCount(0);
  await expect(library.locator(".profile-card")).toHaveCount(1);
  const firstId = (await profiles())[0].id;
  assert.equal(fixture.metrics.authenticationRequests, 0);
  assert.equal(
    (await page.evaluate(() => window.sshOS.session.list())).sessions.length,
    0,
  );

  await add().click();
  await fill("키 서버");
  await popup().getByLabel("인증 방식", { exact: true }).selectOption("key");
  await popup().getByRole("button", { name: "서버 등록", exact: true }).click();
  await expect(popup().locator(".error-panel")).toBeVisible();
  await expect(popup().getByLabel("서버 이름", { exact: true })).toHaveValue(
    "키 서버",
  );
  assert.equal((await profiles()).length, 1);
  await application.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selected],
    });
  }, keyPath);
  await popup()
    .getByRole("button", { name: "개인키 선택", exact: true })
    .click();
  await expect(popup()).toContainText("fixture-id_ed25519");
  await popup().getByRole("button", { name: "서버 등록", exact: true }).click();
  await expect(popup()).toHaveCount(0);
  await expect(library.locator(".profile-card")).toHaveCount(2);
  const keyId = (await profiles()).find((row) => row.name === "키 서버").id;
  await card(keyId).getByRole("button", { name: "수정", exact: true }).click();
  await expect(popup().getByLabel("인증 방식", { exact: true })).toHaveValue(
    "key",
  );
  await popup().getByLabel("서버 이름", { exact: true }).fill("키 서버 수정");
  await popup().getByRole("button", { name: "설정 저장", exact: true }).click();
  await expect(popup()).toHaveCount(0);
  assert.equal(
    (await profiles()).find((row) => row.id === keyId).keyFilename,
    "fixture-id_ed25519",
  );
  await add().click();
  await fill("운영 서버");
  await popup().getByRole("button", { name: "서버 등록", exact: true }).click();
  await expect(popup()).toHaveCount(0);
  const secondId = (await profiles()).find(
    (row) => row.name === "운영 서버",
  ).id;

  const extraIds = await page.evaluate(async () => {
    const ids = [];
    for (let index = 0; index < 7; index++) {
      const row = await window.sshOS.profile.create({
        name: index === 0 ? "장".repeat(64) : `테스트 서버 ${index + 1}`,
        host:
          index === 0
            ? [
                "a".repeat(63),
                "b".repeat(63),
                "c".repeat(63),
                "d".repeat(61),
              ].join(".")
            : "example.invalid",
        port: 22,
        username: index === 0 ? "u".repeat(256) : "fixture",
        authentication: "password",
      });
      ids.push(row.id);
    }
    return ids;
  });
  await library
    .getByRole("button", { name: "목록 새로고침", exact: true })
    .click();
  await expect(library.locator(".profile-card")).toHaveCount(10);
  await expect(add()).toBeDisabled();
  for (const [width, columns] of [
    [1120, 3],
    [1600, 4],
    [1920, 5],
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        library
          .locator(".profile-card-grid")
          .evaluate(
            (node) =>
              getComputedStyle(node).gridTemplateColumns.split(" ").length,
          ),
      )
      .toBe(columns);
    const geometry = await library
      .locator(".profile-card")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            right: rect.right,
            width: rect.width,
            client: node.clientWidth,
            scroll: node.scrollWidth,
          };
        }),
      );
    assert.equal(
      geometry.filter((row) => Math.abs(row.y - geometry[0].y) < 1).length,
      columns,
    );
    assert.ok(
      geometry.every(
        (row) => row.scroll <= row.client + 1 && row.right <= width + 1,
      ),
    );
    assert.ok(geometry[1].x - geometry[0].right >= 19);
    await page.screenshot({ path: join(pictures, `connect-${width}.png`) });
    layouts.push({ width, columns, gapAtLeast: 19, longTextContained: true });
  }
  await card(extraIds.at(-1)).scrollIntoViewIfNeeded();
  await expect(card(extraIds.at(-1))).toBeInViewport({ ratio: 1 });
  page.once("dialog", (dialog) => dialog.dismiss());
  await card(extraIds.at(-1))
    .getByRole("button", { name: "삭제", exact: true })
    .click();
  assert.equal((await profiles()).length, 10);
  page.once("dialog", (dialog) => dialog.accept());
  await card(extraIds.at(-1))
    .getByRole("button", { name: "삭제", exact: true })
    .click();
  await expect(library.locator(".profile-card")).toHaveCount(9);
  await expect(add()).toBeEnabled();

  async function connect(id) {
    await card(id).getByRole("button", { name: "연결", exact: true }).click();
    const credentials = page.locator("dialog[open]").filter({
      has: page.getByRole("heading", {
        name: id === firstId ? "개발 서버 연결" : "운영 서버 연결",
        exact: true,
      }),
    });
    await credentials.getByLabel("비밀번호", { exact: true }).fill("test-only");
    await credentials
      .getByRole("button", { name: "연결", exact: true })
      .click();
    if (id === firstId) {
      assert.equal(fixture.metrics.authenticationRequests, 0);
      await page
        .getByRole("button", { name: "지문을 확인하고 연결", exact: true })
        .click();
    }
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (await window.sshOS.session.list()).sessions.some(
              (row) => row.serverId === id && row.status === "connected",
            ),
          id,
        ),
      )
      .toBe(true);
    await expect(workspaces).toHaveAttribute("data-selected-server", id);
  }
  await connect(firstId);
  await page.getByRole("button", { name: "Console", exact: true }).click();
  await expect(
    page
      .locator(".console-workspace:visible")
      .getByText("입력 가능", { exact: true }),
  ).toBeVisible();
  const terminalId = await page
    .locator(".console-workspace:visible")
    .getAttribute("data-terminal-window-id");
  await page
    .locator(".console-workspace:visible .xterm-helper-textarea")
    .focus();
  await page.keyboard.type("preserve-this-terminal");
  await expect
    .poll(() => Buffer.concat(inputs).toString())
    .toBe("preserve-this-terminal");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await connect(secondId);
  assert.equal(fixture.metrics.shells, 1);
  const sent = Buffer.concat(inputs).toString();
  for (let i = 0; i < 5; i++) {
    await select(firstId);
    await select(secondId);
  }
  await select(firstId);
  await expect(page.locator(".console-workspace:visible")).toHaveAttribute(
    "data-terminal-window-id",
    terminalId,
  );
  assert.equal(fixture.metrics.shells, 1);
  assert.equal(Buffer.concat(inputs).toString(), sent);
  await expect(page.locator(".workspace-context")).toContainText(
    `fixture@127.0.0.1:${fixture.port}`,
  );
  await page
    .getByRole("button", { name: "서버 선택 해제", exact: true })
    .click();
  await expect(workspaces).toHaveAttribute("data-selected-server", "");
  assert.equal(
    (await page.evaluate(() => window.sshOS.session.list())).sessions.filter(
      (row) => row.status === "connected",
    ).length,
    2,
  );
  await select(firstId);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await card(firstId)
    .getByRole("button", { name: "수정", exact: true })
    .click();
  await expect(popup().getByLabel("호스트", { exact: true })).toBeDisabled();
  await expect(popup().getByLabel("포트", { exact: true })).toBeDisabled();
  await expect(popup().getByLabel("인증 방식", { exact: true })).toBeDisabled();
  await expect(popup().getByLabel("서버 이름", { exact: true })).toBeEnabled();
  await page.screenshot({ path: join(pictures, "profile-editor.png") });
  await popup().getByRole("button", { name: "취소", exact: true }).click();
  await card(firstId)
    .getByRole("button", { name: "작업 공간 열기", exact: true })
    .click();
  await expect(library).toBeHidden();
  await expect(page.locator(".console-workspace:visible")).toHaveAttribute(
    "data-terminal-window-id",
    terminalId,
  );
  await page.screenshot({ path: join(pictures, "workspace-console.png") });
  await page.getByRole("button", { name: "Desktop", exact: true }).click();
  await page.screenshot({ path: join(pictures, "workspace-desktop.png") });
  assert.equal(fixture.metrics.shells, 1);
  assert.equal(Buffer.concat(inputs).toString(), sent);
  const report = {
    status: "pass",
    layouts,
    assertions: [
      "saved-profile cards and popup-only forms",
      "modal Escape/focus restoration and no-save cancellation",
      "real persistence ACK blocks close and duplicate submission",
      "failed key save preserves draft and valid native-selected key survives edit",
      "ten-profile limit and confirmed/cancelled deletion",
      "long names/endpoints contained and last row reachable",
      "explicit SSH trust and credentials unchanged",
      "sidebar selection and clear retain two connections and one PTY without input injection",
      "active identity fields locked",
      "card opens existing workspace and mode is retained",
    ],
    limitation:
      "Current-host Electron and owned loopback SSH; native file picker replaced in test main. No supported-native-target or real Ubuntu acceptance claim.",
  };
  await fs.writeFile(
    join(pictures, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} catch (error) {
  if (application) {
    const page = await application.firstWindow();
    await page
      .screenshot({ path: join(pictures, "failure.png") })
      .catch(() => {});
    console.error((await page.locator("body").innerText()).slice(-6000));
  }
  throw error;
} finally {
  if (application) {
    await application
      .evaluate(({ app }) => {
        app.__holdConnectSave = false;
        app.__releaseConnectSave?.();
      })
      .catch(() => {});
    await closeTestApplication(application);
  }
  if (fixture) await fixture.close();
  await fs.rm(base, { recursive: true, force: true });
  await fs.rm(env.SSHOS_RUNTIME_ROOT, { recursive: true, force: true });
}
