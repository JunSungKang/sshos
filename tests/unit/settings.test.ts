import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { StateRepository } from "../../src/main/persistence/state-repository";
import { SettingsController } from "../../src/main/settings/settings";
import { canonicalJSON } from "../../src/main/persistence/store";
const owned: string[] = [];
afterEach(async () => {
  for (const path of owned.splice(0)) await rm(path, { recursive: true });
});
async function fixture() {
  await mkdir(resolve(".local/tmp"), { recursive: true });
  const root = await mkdtemp(resolve(".local/tmp/settings-"));
  owned.push(root);
  const repo = await StateRepository.open(resolve(root, "data")),
    a = await repo.create({
      name: "A",
      host: "example.com",
      port: 22,
      username: "first",
      authentication: "password",
    }),
    b = await repo.create({
      name: "B",
      host: "example.com",
      port: 22,
      username: "second",
      authentication: "password",
    }),
    secret = crypto.randomUUID();
  await repo.trust(
    "example.com:22",
    Buffer.from("public-blob"),
    "SHA256:fixture",
  );
  await repo.store.update((state) => ({
    ...state!,
    profiles: state!.profiles.map((row) =>
      row.id === a.id ? { ...row, secretId: secret } : row,
    ),
    encryptedSecrets: [
      {
        id: secret,
        profileId: a.id,
        endpoint: "example.com:22",
        username: "first",
        ciphertext: "redacted-ciphertext",
      },
    ],
  }));
  let approved = true,
    busy = false,
    healthy = true;
  const confirm = vi.fn(async () => approved),
    quiesce = vi.fn(async () => {}),
    controller = new SettingsController(
      () => repo,
      () => healthy,
      confirm,
      quiesce,
      () => busy,
    );
  return {
    repo,
    a,
    b,
    controller,
    confirm,
    quiesce,
    cancel: () => {
      approved = false;
    },
    busy: () => {
      busy = true;
    },
    fault: () => {
      healthy = false;
    },
  };
}
describe("saved trust and secret removal", () => {
  it("exposes fingerprints and ownership without public blobs/ciphertext/secret IDs", async () => {
    const f = await fixture(),
      view = f.controller.get();
    expect(view.hostTrust[0]).toEqual({
      endpoint: "example.com:22",
      fingerprint: "SHA256:fixture",
      trusted: true,
      approvedAt: expect.any(String),
    });
    expect(view.savedSecrets[0]).toMatchObject({
      profileId: f.a.id,
      name: "A",
    });
    expect(JSON.stringify(view)).not.toMatch(
      /public-blob|redacted-ciphertext|secretId/u,
    );
  });
  it("waits for explicit consent and every same-endpoint profile before atomically deleting trust", async () => {
    const f = await fixture();
    f.cancel();
    await f.controller.handle("settings:removeTrust", "example.com:22");
    expect(f.quiesce).not.toHaveBeenCalled();
    expect(f.repo.snapshot().hostTrust).toHaveLength(1);
    const g = await fixture();
    g.quiesce.mockImplementation(async () => {
      expect(g.controller.writing).toBe(true);
      expect(g.repo.snapshot().hostTrust).toHaveLength(1);
      await expect(
        g.controller.handle("settings:removeSecret", g.a.id),
      ).rejects.toThrow("REQUEST_BUSY");
    });
    await g.controller.handle("settings:removeTrust", "example.com:22");
    expect(g.quiesce).toHaveBeenCalledExactlyOnceWith([g.a.id, g.b.id]);
    expect(g.repo.snapshot().hostTrust).toHaveLength(0);
    expect(g.repo.snapshot().encryptedSecrets).toHaveLength(1);
    expect(g.controller.writing).toBe(false);
  });
  it("preserves trust if work remains, confirmation target changed or quiescence fails", async () => {
    const f = await fixture();
    f.busy();
    await expect(
      f.controller.handle("settings:removeTrust", "example.com:22"),
    ).rejects.toThrow("PROFILE_BUSY");
    expect(f.repo.snapshot().hostTrust).toHaveLength(1);
    expect(f.repo.store.faulted).toBe(false);
    const g = await fixture();
    g.quiesce.mockImplementation(async () => {
      await g.repo.trust(
        "example.com:22",
        Buffer.from("changed"),
        "SHA256:changed",
      );
    });
    await expect(
      g.controller.handle("settings:removeTrust", "example.com:22"),
    ).rejects.toThrow("TOKEN_EXPIRED");
    expect(g.repo.snapshot().hostTrust[0]?.fingerprint).toBe("SHA256:changed");
    const h = await fixture();
    h.quiesce.mockRejectedValue(new Error("IO_TIMEOUT"));
    await expect(
      h.controller.handle("settings:removeTrust", "example.com:22"),
    ).rejects.toThrow("IO_TIMEOUT");
    expect(h.repo.snapshot().hostTrust).toHaveLength(1);
  });
  it("removes a secret and its profile reference in one writer update after disconnect; keeps the profile/trust", async () => {
    const f = await fixture();
    await f.controller.handle("settings:removeSecret", f.a.id);
    expect(f.quiesce).toHaveBeenCalledExactlyOnceWith([f.a.id]);
    expect(f.repo.snapshot().encryptedSecrets).toEqual([]);
    expect(
      f.repo.snapshot().profiles.find((row) => row.id === f.a.id)?.secretId,
    ).toBeUndefined();
    expect(f.repo.snapshot().hostTrust).toHaveLength(1);
    expect(f.controller.get().savedSecrets).toEqual([]);
  });
  it("refuses unknown settings fields and storage faults without emitting any plaintext fallback", async () => {
    const f = await fixture();
    await expect(
      f.controller.handle("settings:update", {
        language: "ko",
        saveSecrets: false,
        path: "/tmp/escape",
      }),
    ).rejects.toThrow();
    expect(f.repo.snapshot().settings).toEqual({
      language: "ko",
      saveSecrets: false,
      showHiddenFiles: false,
      theme: "chocolate",
    });
    f.fault();
    await expect(
      f.controller.handle("settings:removeSecret", f.a.id),
    ).rejects.toThrow("STORAGE_FAILED");
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.controller.writing).toBe(false);
  });
});

it("persists only validated settings, exposes readonly state during writes, and rejects unknown handlers", async () => {
  const f = await fixture();
  await f.controller.handle("settings:update", {
    language: "ko",
    saveSecrets: true,
  });
  expect(
    (
      (await f.controller.handle("settings:get", undefined)) as {
        saveSecrets: boolean;
      }
    ).saveSecrets,
  ).toBe(true);
  await expect(f.controller.handle("settings:get", {})).rejects.toThrow(
    "INPUT_INVALID",
  );
  await expect(
    f.controller.handle("settings:unknown", undefined),
  ).rejects.toThrow("INPUT_INVALID");
  await expect(
    f.controller.handle("settings:removeTrust", "missing"),
  ).rejects.toThrow("INPUT_INVALID");
  await expect(
    f.controller.handle("settings:removeSecret", crypto.randomUUID()),
  ).rejects.toThrow("PROFILE_NOT_FOUND");
  await expect(
    f.controller.handle("settings:removeSecret", f.b.id),
  ).rejects.toThrow("PROFILE_NOT_FOUND");
  expect(f.controller.writing).toBe(false);
});
it("preserves encrypted secret on cancellation, active work, confirmation failure or newly failed storage", async () => {
  const f = await fixture();
  f.cancel();
  await f.controller.handle("settings:removeSecret", f.a.id);
  expect(f.repo.snapshot().encryptedSecrets).toHaveLength(1);
  expect(f.quiesce).not.toHaveBeenCalled();
  const g = await fixture();
  g.busy();
  await expect(
    g.controller.handle("settings:removeSecret", g.a.id),
  ).rejects.toThrow("PROFILE_BUSY");
  expect(g.repo.snapshot().encryptedSecrets).toHaveLength(1);
  const h = await fixture();
  h.confirm.mockRejectedValue(new Error("REQUEST_CANCELLED"));
  await expect(
    h.controller.handle("settings:removeSecret", h.a.id),
  ).rejects.toThrow("REQUEST_CANCELLED");
  expect(h.controller.writing).toBe(false);
  const j = await fixture();
  j.confirm.mockImplementation(async () => {
    j.fault();
    return true;
  });
  await expect(
    j.controller.handle("settings:removeSecret", j.a.id),
  ).rejects.toThrow("STORAGE_FAILED");
  expect(j.quiesce).not.toHaveBeenCalled();
});
it("fails closed when state is absent or faulted and allows subsequent reads without exposing secrets", async () => {
  const empty = new SettingsController(
    () => null,
    () => true,
    async () => true,
    async () => {},
    () => false,
  );
  expect(() => empty.get()).toThrow("STORAGE_FAILED");
  await expect(
    empty.handle("settings:update", { language: "ko", saveSecrets: false }),
  ).rejects.toThrow("STORAGE_FAILED");
  const f = await fixture();
  f.fault();
  expect(f.controller.get().savedSecrets).toHaveLength(1);
  await expect(
    f.controller.handle("settings:update", {
      language: "ko",
      saveSecrets: false,
    }),
  ).rejects.toThrow("STORAGE_FAILED");
});

it("persists the hidden-file preference only after validated writes and preserves it through unrelated settings updates", async () => {
  const f = await fixture();
  expect(f.controller.get().showHiddenFiles).toBe(false);
  await expect(
    f.controller.handle("settings:setHidden", "true"),
  ).rejects.toThrow();
  await f.controller.handle("settings:setHidden", true);
  await f.controller.handle("settings:update", {
    language: "ko",
    saveSecrets: true,
  });
  expect(f.controller.get().showHiddenFiles).toBe(true);
  const reopened = await StateRepository.open(dirname(f.repo.store.backup));
  expect(reopened.snapshot().settings.showHiddenFiles).toBe(true);
  f.fault();
  await expect(
    f.controller.handle("settings:setHidden", false),
  ).rejects.toThrow("STORAGE_FAILED");
  expect(f.controller.get().showHiddenFiles).toBe(true);
});

it("persists a validated theme through JSON reopen without changing trust, profiles or other preferences", async () => {
  const f = await fixture(),
    before = f.repo.snapshot();
  await f.controller.handle("settings:setTheme", "windows11");
  await f.controller.handle("settings:setHidden", true);
  await f.controller.handle("settings:update", {
    language: "ko",
    saveSecrets: true,
  });
  const reopened = await StateRepository.open(dirname(f.repo.store.backup));
  expect(reopened.snapshot().settings).toEqual({
    language: "ko",
    saveSecrets: true,
    showHiddenFiles: true,
    theme: "windows11",
  });
  expect(reopened.snapshot().hostTrust).toEqual(before.hostTrust);
  expect(reopened.snapshot().profiles).toEqual(before.profiles);
  expect(reopened.snapshot().encryptedSecrets).toEqual(before.encryptedSecrets);
  expect(f.controller.get().theme).toBe("windows11");
});
it("rejects arbitrary theme values and failed writes without acknowledging or changing appearance state", async () => {
  const f = await fixture(),
    before = f.repo.snapshot();
  for (const value of [
    "unknown",
    { theme: "atom" },
    null,
    "https://example.com/theme.css",
  ])
    await expect(
      f.controller.handle("settings:setTheme", value),
    ).rejects.toThrow();
  expect(f.repo.snapshot()).toEqual(before);
  const spy = vi
    .spyOn(f.repo.store, "update")
    .mockRejectedValueOnce(new Error("STORAGE_FAILED"));
  await expect(
    f.controller.handle("settings:setTheme", "atom"),
  ).rejects.toThrow("STORAGE_FAILED");
  expect(f.controller.writing).toBe(false);
  expect(f.controller.get().theme).toBe("chocolate");
  spy.mockRestore();
  f.fault();
  await expect(
    f.controller.handle("settings:setTheme", "atom"),
  ).rejects.toThrow("STORAGE_FAILED");
});
it("loads an authentic checksummed legacy JSON envelope without a theme and saves its first theme choice", async () => {
  const f = await fixture(),
    path = f.repo.store.backup.slice(0, -4),
    envelope = JSON.parse(await readFile(path, "utf8"));
  delete envelope.payload.settings.theme;
  envelope.payloadSha256 = createHash("sha256")
    .update(canonicalJSON(envelope.payload))
    .digest("hex");
  await writeFile(path, JSON.stringify(envelope));
  const repo = await StateRepository.open(dirname(path));
  expect(repo.recovered).toBe(false);
  expect(repo.snapshot().settings.theme).toBe("chocolate");
  const controller = new SettingsController(
    () => repo,
    () => true,
    async () => true,
    async () => {},
    () => false,
  );
  await controller.handle("settings:setTheme", "ubuntu");
  expect(
    (await StateRepository.open(dirname(path))).snapshot().settings.theme,
  ).toBe("ubuntu");
});
