import { _electron as electron, expect } from "@playwright/test";
import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import {
  root,
  localPath,
  runtimeEnvironment,
  closeTestApplication,
} from "./environment.mjs";
import { startSSHFixture } from "./fixtures/ssh-server.mjs";

const fixtureRoot = localPath("fixtures/relay-gui-" + randomUUID());
const env = runtimeEnvironment("relay-gui-" + randomUUID());
Object.assign(process.env, env);
const { default: executablePath } = await import("electron");
const servers = [];
let application;
let refuseReadBack = true;
try {
  const payload = randomBytes(512 * 1024 + 11);
  for (const label of ["A", "B"]) {
    const directory = join(fixtureRoot, label);
    await fs.mkdir(join(directory, "home/fixture/delivery"), {
      recursive: true,
    });
    await fs.mkdir(join(directory, "etc"));
    await fs.writeFile(
      join(directory, "etc/os-release"),
      'ID=ubuntu\nVERSION_ID="24.04"\n',
    );
    servers.push(
      await startSSHFixture(directory, {
        hardlink: true,
        denyRead(path) {
          if (label !== "B" || !refuseReadBack || !path.endsWith(".part"))
            return false;
          refuseReadBack = false;
          return true;
        },
      }),
    );
  }
  const sourcePath = join(fixtureRoot, "A/home/fixture/source.bin");
  const destinationPath = join(fixtureRoot, "B/home/fixture/delivery/copy.bin");
  const occupiedPath = join(
    fixtureRoot,
    "B/home/fixture/delivery/occupied.bin",
  );
  await fs.writeFile(sourcePath, payload);
  await fs.writeFile(occupiedPath, "preserve existing content");
  application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${env.SSHOS_RUNTIME_ROOT}`, root],
    cwd: root,
    env,
    timeout: 20000,
  });
  const page = await application.firstWindow();
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1120, 760),
  );
  page.setDefaultTimeout(20000);
  await page
    .getByTestId("engine-state")
    .filter({ hasText: "연결 엔진 준비됨" })
    .waitFor();
  const ids = [];
  for (const [index, server] of servers.entries()) {
    ids.push(
      await page.evaluate(
        async ({ port, name }) => {
          const profile = await window.sshOS.profile.create({
            name,
            host: "127.0.0.1",
            port,
            username: "fixture",
            authentication: "password",
          });
          await window.sshOS.session.connect(profile.id, {
            password: "test-only",
            saveSecret: false,
          });
          const challenge = (await window.sshOS.session.list()).challenges.find(
            (row) => row.serverId === profile.id,
          );
          if (!challenge) throw Error("Fixture host key challenge missing");
          await window.sshOS.trust.approve(challenge.challengeId);
          return profile.id;
        },
        { port: server.port, name: index ? "Relay B" : "Relay A" },
      ),
    );
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (await window.sshOS.session.list()).sessions.find(
              (row) => row.serverId === id,
            )?.sftp,
          ids[index],
        ),
      )
      .toBe("available");
  }
  const sidebar = page.getByRole("region", { name: "서버 작업 공간" });
  const cardA = sidebar.locator(`button[data-server-id="${ids[0]}"]`);
  const cardB = sidebar.locator(`button[data-server-id="${ids[1]}"]`);
  await cardA.click();
  const origin = page.getByRole("listitem").filter({ hasText: "source.bin" });
  const dialog = page.getByRole("dialog", { name: "다른 서버로 복사" });
  await origin.focus();
  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("combobox", { name: "도착 서버", exact: true }),
  ).toHaveValue("");
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await origin.dragTo(page.locator(".sidebar .brand"));
  await expect(
    dialog.getByRole("combobox", { name: "도착 서버", exact: true }),
  ).toHaveValue("");
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await origin.dragTo(cardB);
  await expect(
    dialog
      .getByRole("combobox", { name: "도착 서버", exact: true })
      .locator("option:checked"),
  ).toContainText("Relay B");
  await dialog.getByRole("button", { name: "폴더 찾아보기" }).click();
  await dialog.getByRole("button", { name: "delivery /", exact: true }).click();
  await expect(dialog.getByLabel("도착 폴더 · 절대 경로")).toHaveValue(
    "/home/fixture/delivery",
  );
  await dialog.getByLabel("도착 파일 이름").fill("occupied.bin");
  await dialog
    .getByRole("button", { name: "복사 미리보기", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("같은 이름");
  await expect(
    dialog.getByRole("button", { name: "복사 시작" }),
  ).toBeDisabled();
  await dialog.getByLabel("도착 파일 이름").fill("copy.bin");
  await dialog
    .getByRole("button", { name: "복사 미리보기", exact: true })
    .click();
  await expect(dialog.getByText("PC 최소 필요 공간")).toBeVisible();
  assert.equal(
    await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        bounds.left >= 0 &&
        bounds.right <= window.innerWidth &&
        element.scrollWidth <= element.clientWidth + 1
      );
    }),
    true,
  );
  await expect(
    dialog.getByText("/home/fixture/source.bin", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("/home/fixture/delivery/copy.bin", { exact: true }),
  ).toBeVisible();
  assert.equal(servers[0].metrics.readBytes, 0);
  assert.equal(servers[1].metrics.writes, 0);
  await expect(dialog.getByRole("button", { name: "복사 시작" })).toBeEnabled();
  await dialog.getByRole("button", { name: "복사 시작" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "전체 작업" }).click();
  const record = page.getByRole("article", { name: "서버 간 복사" });
  await expect(record).toHaveCount(1);
  await expect(record.locator(".task-phase")).toHaveText("실패", {
    timeout: 45000,
  });
  await expect(record.getByRole("status")).toContainText("도착 서버");
  await expect(record.getByText(/PC 작업 위치/)).toContainText(
    payload.length.toLocaleString("ko-KR"),
  );
  await expect(
    record.getByRole("button", { name: "PC 임시 파일 정리" }),
  ).toBeVisible();
  await assert.rejects(fs.stat(destinationPath), { code: "ENOENT" });
  const sourceRead = servers[0].metrics.readBytes;
  // Act as the server operator, reviewing the task-owned remnant before acknowledging it.
  const receipt = await page.evaluate(
    async () => (await window.sshOS.relay.list())[0],
  );
  assert.match(
    receipt.remoteTempPath,
    /^\/home\/fixture\/delivery\/\.sshos-[0-9a-f-]{36}\.part$/,
  );
  const remnant = join(fixtureRoot, "B", receipt.remoteTempPath);
  assert.deepEqual(await fs.readFile(remnant), payload);
  await fs.unlink(remnant);
  await record.getByRole("button", { name: "도착 경로 확인" }).click();
  await expect(record.getByText(/확인 시점의 도착 경로/)).toContainText(
    "파일 없음",
  );
  await record.getByRole("button", { name: "확인 후 기록 닫기" }).click();
  await page
    .getByRole("dialog", { name: "복사 작업 확인" })
    .getByRole("button", { name: "확인했음" })
    .click();
  await record.getByRole("button", { name: "다시 보내기 미리보기" }).click();
  await dialog
    .getByRole("button", { name: "복사 미리보기", exact: true })
    .click();
  await expect(
    dialog.getByText("검증한 기존 임시 파일을 사용합니다."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "복사 시작" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(record.locator(".task-phase")).toHaveText("복사 완료", {
    timeout: 45000,
  });
  await record.getByRole("button", { name: "도착 경로 확인" }).click();
  await expect(record.getByRole("status")).toContainText("파일 있음");
  await expect(record).toHaveCount(1);
  assert.equal(servers[0].metrics.readBytes, sourceRead);
  assert.deepEqual(await fs.readFile(sourcePath), payload);
  assert.deepEqual(await fs.readFile(destinationPath), payload);
  assert.equal(
    await fs.readFile(occupiedPath, "utf8"),
    "preserve existing content",
  );
  console.log(
    "Relay GUI passed: keyboard, bow and B-card drops, bounded desktop layout, conflict, preflight, retained-stage B retry, single parent and destination inspection.",
  );
} finally {
  if (application) await closeTestApplication(application);
  for (const server of servers) await server.close();
  await fs.rm(fixtureRoot, { recursive: true, force: true });
  await fs.rm(env.SSHOS_RUNTIME_ROOT, { recursive: true, force: true });
}
