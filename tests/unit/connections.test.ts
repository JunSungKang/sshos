import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ConnectionController } from "../../src/main/connections/connections";
import { StateRepository } from "../../src/main/persistence/state-repository";
import type { EngineGateway } from "../../src/main/engine-gateway";
import type { SecretVault } from "../../src/main/persistence/secrets";
import type { SessionSnapshot } from "../../src/shared/session-contracts";
const owned: string[] = [];
const controllers: ConnectionController[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const controller of controllers.splice(0)) controller.engineStopped();
  for (const root of owned.splice(0)) await rm(root, { recursive: true });
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function fixture(unknown = false) {
  await mkdir(resolve(".local/tmp"), { recursive: true });
  const root = await mkdtemp(resolve(".local/tmp/connections-"));
  owned.push(root);
  const repo = await StateRepository.open(resolve(root, "data"));
  const profile = await repo.create({
    name: "fixture",
    host: "example.invalid",
    port: 22,
    username: "fixture",
    authentication: "password",
  });
  if (!unknown)
    await repo.trust(
      "example.invalid:22",
      Buffer.from("fixture-public-blob"),
      "SHA256:fixture",
    );
  const encrypted = deferred<string>();
  let encryptionStarted = false,
    healthy = true;
  let connects = 0;
  let controller!: ConnectionController;
  const gateway = {
    request: async (request: {
      action: string;
      serverId: string;
      generation: number;
      payload?: { trustedHostKey: string | null };
    }) => {
      if (request.action === "session:disconnect") return;
      connects++;
      if (request.payload?.trustedHostKey === null)
        return {
          status: "awaiting_host_trust",
          publicKey: Buffer.from("fixture-public-blob").toString("base64"),
          fingerprint: "SHA256:fixture",
        };
      const snapshot: SessionSnapshot = {
        serverId: request.serverId,
        generation: request.generation,
        status: "connected",
        os: "supported",
        osConfirmed: false,
        sftp: "available",
        initialPath: "/home/fixture",
        errorCode: null,
      };
      controller.observe(snapshot);
      return { status: "connected", snapshot };
    },
  } as unknown as EngineGateway;
  const vault = {
    encrypt: async () => {
      encryptionStarted = true;
      return encrypted.promise;
    },
  } as unknown as SecretVault;
  controller = new ConnectionController(
    () => repo,
    gateway,
    vault,
    () => healthy,
  );
  controllers.push(controller);
  return {
    root,
    repo,
    profile,
    controller,
    encrypted,
    vault,
    gateway,
    setHealthy: (value: boolean) => {
      healthy = value;
    },
    get started() {
      return encryptionStarted;
    },
    get connects() {
      return connects;
    },
  };
}
describe("connection readiness and credential lifetime", () => {
  it("rejects stale disconnect generations, validates named list requests and preserves a current session", async () => {
    const f = await fixture();
    expect(f.controller.beginDisconnect(crypto.randomUUID())).toBeNull();
    await f.controller.connect(f.profile.id, {
      password: "fixture",
      saveSecret: false,
    });
    const current = f.controller.views()[0]!;
    expect(
      f.controller.beginDisconnect(f.profile.id, current.generation + 1),
    ).toBeNull();
    await f.controller.disconnect(f.profile.id, current.generation + 1);
    expect(f.controller.views()[0]?.status).toBe("connected");
    await expect(f.controller.handle("session:list", {})).rejects.toThrow(
      "INPUT_INVALID",
    );
    await expect(f.controller.handle("unknown", undefined)).rejects.toThrow(
      "INPUT_INVALID",
    );
    await expect(
      f.controller.handle("session:list", undefined),
    ).resolves.toMatchObject({ challenges: [] });
    await f.controller.handle("session:confirmOS", {
      id: f.profile.id,
      generation: current.generation,
    });
  });
  it("drops profileless session views and refuses storage-dependent work without a repository", async () => {
    const f = await fixture();
    await f.controller.connect(f.profile.id, {
      password: "fixture",
      saveSecret: false,
    });
    const current = f.controller.views()[0]!,
      identity = f.controller.sessionIdentity(f.profile.id, current.generation);
    await f.controller.disconnect(f.profile.id);
    await f.repo.remove(f.profile.id, () => false);
    expect(f.controller.views()).toEqual([]);
    await expect(
      f.controller.connect(f.profile.id, { saveSecret: false }),
    ).rejects.toThrow("PROFILE_NOT_FOUND");
    expect(identity.endpointSnapshot.name).toBe("fixture");
    const unavailable = new ConnectionController(
      () => null,
      f.gateway,
      f.vault,
    );
    expect(unavailable.views()).toEqual([]);
    await expect(
      unavailable.connect(crypto.randomUUID(), { saveSecret: false }),
    ).rejects.toThrow("STORAGE_FAILED");
  });
  it("issues a resource capability only after inspection and requested secret storage finish", async () => {
    const f = await fixture();
    const pending = f.controller.connect(f.profile.id, {
      password: "fixture-only",
      saveSecret: true,
    });
    for (let i = 0; i < 20 && !f.started; i++) await Promise.resolve();
    expect(f.started).toBe(true);
    expect(f.controller.views()[0]?.sessionToken).toBeNull();
    expect(f.controller.isBusy(f.profile.id)).toBe(true);
    f.encrypted.resolve(
      Buffer.from("opaque-fixture-cipher").toString("base64"),
    );
    await pending;
    const token = f.controller.views()[0]?.sessionToken;
    expect(token).toBeTypeOf("string");
    expect(f.controller.sessionCapability(token!)).toEqual({
      serverId: f.profile.id,
      generation: 1,
    });
  });
  it("does not save a late secret or restore a capability after disconnect during encryption", async () => {
    const f = await fixture();
    const pending = f.controller.connect(f.profile.id, {
      password: "fixture-only",
      saveSecret: true,
    });
    const rejected = expect(pending).rejects.toThrow("CONNECTION_LOST");
    for (let i = 0; i < 20 && !f.started; i++) await Promise.resolve();
    await f.controller.disconnect(f.profile.id);
    await expect(
      f.controller.connect(f.profile.id, {
        password: "fixture-only",
        saveSecret: false,
      }),
    ).rejects.toThrow("SESSION_BUSY");
    f.controller.observe({
      serverId: f.profile.id,
      generation: 1,
      status: "connected",
      os: "supported",
      osConfirmed: false,
      sftp: "available",
      initialPath: "/home/fixture",
      errorCode: null,
    });
    expect(f.controller.views()[0]?.sessionToken).toBeNull();
    f.encrypted.resolve("opaque-fixture-cipher");
    await rejected;
    expect(f.repo.snapshot().encryptedSecrets).toHaveLength(0);
    expect(f.controller.views()[0]?.sessionToken).toBeNull();
    expect(f.connects).toBe(1);
  });
  it("blocks trust-writing connection operations while the receipt writer is faulted", async () => {
    const f = await fixture();
    f.setHealthy(false);
    await expect(
      f.controller.connect(f.profile.id, {
        password: "fixture-only",
        saveSecret: false,
      }),
    ).rejects.toThrow("STORAGE_FAILED");
    expect(f.connects).toBe(0);
  });
  it("does not start fresh authentication after disconnect during durable host trust approval", async () => {
    const f = await fixture(true);
    await f.controller.connect(f.profile.id, {
      password: "fixture-only",
      saveSecret: false,
    });
    const challenge = f.controller.challenges()[0]!;
    const gate = deferred<void>();
    let saving = false;
    const original = f.repo.trust.bind(f.repo);
    vi.spyOn(f.repo, "trust").mockImplementation(async (...args) => {
      saving = true;
      await gate.promise;
      await original(...args);
    });
    const approval = f.controller.approve(challenge.challengeId);
    const rejected = expect(approval).rejects.toThrow("CONNECTION_LOST");
    for (let i = 0; i < 20 && !saving; i++) await Promise.resolve();
    await f.controller.disconnect(f.profile.id);
    await expect(
      f.controller.connect(f.profile.id, {
        password: "fixture-only",
        saveSecret: false,
      }),
    ).rejects.toThrow("SESSION_BUSY");
    gate.resolve();
    await rejected;
    expect(f.connects).toBe(1);
    expect(f.controller.views()[0]?.sessionToken).toBeNull();
  });
});

it("rejects stale secret rotation and authentication after engine loss while allowing an explicitly newer generation", async () => {
  const f = await fixture(),
    secretId = crypto.randomUUID(),
    original = Buffer.from("old fixture ciphertext").toString("base64"),
    newer = Buffer.from("new fixture ciphertext").toString("base64"),
    gate = deferred<void>();
  let decrypting = false;
  await f.repo.store.update((state) => ({
    ...state!,
    profiles: state!.profiles.map((row) => ({ ...row, secretId })),
    encryptedSecrets: [
      {
        id: secretId,
        profileId: f.profile.id,
        endpoint: "example.invalid:22",
        username: "fixture",
        ciphertext: original,
      },
    ],
  }));
  f.vault.decrypt = async (_ciphertext, persist) => {
    decrypting = true;
    await gate.promise;
    await persist(Buffer.from("stale replacement").toString("base64"));
    return "old fixture password";
  };
  const pending = f.controller.connect(f.profile.id, { saveSecret: false }),
    failure = expect(pending).rejects.toThrow("CONNECTION_LOST");
  await vi.waitFor(() => expect(decrypting).toBe(true));
  f.controller.engineStopped();
  await f.controller.connect(f.profile.id, {
    password: "new fixture password",
    saveSecret: false,
  });
  await f.repo.store.update((state) => ({
    ...state!,
    encryptedSecrets: state!.encryptedSecrets.map((row) => ({
      ...row,
      ciphertext: newer,
    })),
  }));
  gate.resolve();
  await failure;
  expect(f.repo.snapshot().encryptedSecrets[0]?.ciphertext).toBe(newer);
  expect(f.connects).toBe(1);
  expect(f.controller.views()[0]).toMatchObject({
    status: "connected",
    generation: 2,
  });
});

it("does not fail or disconnect a newer connection when old host approval finishes after engine loss", async () => {
  const f = await fixture(true);
  await f.controller.connect(f.profile.id, {
    password: "fixture-only",
    saveSecret: false,
  });
  const challenge = f.controller.challenges()[0]!,
    gate = deferred<void>(),
    original = f.repo.trust.bind(f.repo);
  let written = false;
  vi.spyOn(f.repo, "trust").mockImplementation(async (...args) => {
    await original(...args);
    written = true;
    await gate.promise;
  });
  const requests = vi.spyOn(f.gateway, "request"),
    approval = f.controller.approve(challenge.challengeId),
    failure = expect(approval).rejects.toThrow("CONNECTION_LOST");
  await vi.waitFor(() => expect(written).toBe(true));
  f.controller.engineStopped();
  await f.controller.connect(f.profile.id, {
    password: "new fixture",
    saveSecret: false,
  });
  gate.resolve();
  await failure;
  expect(f.controller.views()[0]).toMatchObject({
    status: "connected",
    generation: 2,
  });
  expect(f.controller.views()[0]?.sessionToken).not.toBeNull();
  expect(
    requests.mock.calls.some(
      ([request]) =>
        request.action === "session:disconnect" && request.generation === 2,
    ),
  ).toBe(false);
});

it("does not overwrite or close a new generation when an older disconnect ACK or deadline arrives late", async () => {
  const f = await fixture();
  await f.controller.connect(f.profile.id, {
    password: "fixture",
    saveSecret: false,
  });
  const gate = deferred<void>(),
    original = f.gateway.request.bind(f.gateway),
    spy = vi.spyOn(f.gateway, "request").mockImplementation(async (request) => {
      if (request.action === "session:disconnect") {
        await gate.promise;
        return;
      }
      return original(request);
    });
  const closing = f.controller.disconnect(f.profile.id, 1);
  f.controller.observe({
    serverId: f.profile.id,
    generation: 1,
    status: "disconnected",
    os: "supported",
    osConfirmed: false,
    sftp: "available",
    initialPath: "/home",
    errorCode: null,
  });
  await f.controller.connect(f.profile.id, {
    password: "new fixture",
    saveSecret: false,
  });
  gate.resolve();
  await closing;
  expect(f.controller.views()[0]).toMatchObject({
    status: "connected",
    generation: 2,
  });
  const count = spy.mock.calls.length;
  await f.controller.disconnect(f.profile.id, 1);
  expect(spy.mock.calls).toHaveLength(count);
  expect(f.controller.views()[0]?.sessionToken).not.toBeNull();
});

it("runs the strict named session handlers and preserves immutable generation and endpoint identity", async () => {
  const f = await fixture();
  await f.controller.handle("session:connect", {
    id: f.profile.id,
    credentials: { password: "fixture", saveSecret: false },
  });
  const view = f.controller.views()[0]!;
  expect(
    f.controller.sessionIdentity(view.serverId, view.generation),
  ).toMatchObject({
    endpointSnapshot: { endpoint: "example.invalid:22", name: "fixture" },
  });
  await f.repo.update(
    f.profile.id,
    {
      name: "renamed",
      host: f.profile.host,
      port: f.profile.port,
      username: f.profile.username,
      authentication: f.profile.authentication,
    },
    () => false,
  );
  expect(
    f.controller.sessionIdentity(view.serverId, view.generation)
      .endpointSnapshot.name,
  ).toBe("renamed");
  f.controller.observe({ ...view, generation: 999, status: "disconnected" });
  expect(f.controller.sessionCapability(view.sessionToken!)).toEqual({
    serverId: view.serverId,
    generation: view.generation,
  });
  await f.controller.handle("session:confirmOS", {
    id: view.serverId,
    generation: view.generation,
  });
  expect(await f.controller.handle("session:list", undefined)).toHaveProperty(
    "sessions",
  );
  await expect(f.controller.handle("session:list", {})).rejects.toThrow(
    "INPUT_INVALID",
  );
  await expect(f.controller.handle("invalid", undefined)).rejects.toThrow(
    "INPUT_INVALID",
  );
  await f.controller.handle("session:disconnect", f.profile.id);
  expect(() => f.controller.sessionCapability(view.sessionToken!)).toThrow(
    "SESSION_UNAVAILABLE",
  );
  expect(() =>
    f.controller.sessionIdentity(view.serverId, view.generation),
  ).toThrow("SESSION_UNAVAILABLE");
  await f.controller.disconnect(crypto.randomUUID());
});

it("uses a saved bound secret, persists a rotation before authentication and refuses missing secret ownership", async () => {
  const f = await fixture(),
    secretId = crypto.randomUUID();
  await f.repo.store.update((state) => ({
    ...state!,
    profiles: state!.profiles.map((row) => ({ ...row, secretId })),
    encryptedSecrets: [
      {
        id: secretId,
        profileId: f.profile.id,
        endpoint: "example.invalid:22",
        username: "fixture",
        ciphertext: "old",
      },
    ],
  }));
  f.vault.decrypt = vi.fn(async (_cipher, persist) => {
    await persist("rotated");
    expect(f.repo.snapshot().encryptedSecrets[0]!.ciphertext).toBe("rotated");
    return "fixture";
  });
  await f.controller.connect(f.profile.id, { saveSecret: false });
  expect(f.vault.decrypt).toHaveBeenCalledTimes(1);
  await f.controller.disconnect(f.profile.id);
  await f.repo.store.update((state) => ({ ...state!, encryptedSecrets: [] }));
  const before = f.connects;
  await expect(
    f.controller.connect(f.profile.id, { saveSecret: false }),
  ).rejects.toThrow("SECRET_UNAVAILABLE");
  expect(f.connects).toBe(before);
});

it("reads a main-owned key file once and clears forwarded key/passphrase/password references after completion", async () => {
  const f = await fixture(),
    path = resolve(f.root, "key");
  await writeFile(
    path,
    "-----BEGIN PRIVATE KEY-----\nfixture-main-boundary-only\n-----END PRIVATE KEY-----",
  );
  const { id: _id, ...profile } = f.profile;
  await f.repo.update(
    f.profile.id,
    { ...profile, authentication: "key", keyPath: path },
    () => false,
  );
  let forwarded: any;
  const request = f.gateway.request.bind(f.gateway);
  f.gateway.request = async (raw) => {
    if (raw.action === "session:connect") {
      forwarded = raw.payload;
      expect(forwarded.keyBytes.length).toBeGreaterThan(0);
      expect(forwarded.passphrase).toBe("volatile");
    }
    return request(raw);
  };
  await f.controller.connect(f.profile.id, {
    passphrase: "volatile",
    saveSecret: false,
  });
  expect(forwarded.keyBytes).toBeUndefined();
  expect(forwarded.passphrase).toBeUndefined();
  expect(JSON.stringify(f.repo.snapshot())).not.toContain("volatile");
  await f.controller.disconnect(f.profile.id);
  await f.repo.update(
    f.profile.id,
    { ...profile, authentication: "key", keyPath: resolve(f.root, "missing") },
    () => false,
  );
  await expect(
    f.controller.connect(f.profile.id, { saveSecret: false }),
  ).rejects.toThrow("KEY_INVALID");
});

it("refuses concurrent sessions, profile absence and storage failure before authentication", async () => {
  const f = await fixture();
  await expect(
    f.controller.connect(crypto.randomUUID(), { saveSecret: false }),
  ).rejects.toThrow("PROFILE_NOT_FOUND");
  await f.controller.connect(f.profile.id, {
    password: "fixture",
    saveSecret: false,
  });
  await expect(
    f.controller.connect(f.profile.id, {
      password: "fixture",
      saveSecret: false,
    }),
  ).rejects.toThrow("SESSION_BUSY");
  for (let i = 0; i < 2; i++) {
    const profile = await f.repo.create({
      name: "extra",
      host: "other.invalid",
      port: 22,
      username: "fixture",
      authentication: "password",
    });
    await f.controller.connect(profile.id, {
      password: "fixture",
      saveSecret: false,
    });
  }
  const fourth = await f.repo.create({
    name: "fourth",
    host: "other.invalid",
    port: 22,
    username: "fixture",
    authentication: "password",
  });
  await expect(
    f.controller.connect(fourth.id, { password: "fixture", saveSecret: false }),
  ).rejects.toThrow("SESSION_LIMIT");
  for (const row of f.controller.views())
    await f.controller.disconnect(row.serverId);
  f.setHealthy(false);
  await expect(
    f.controller.connect(f.profile.id, {
      password: "fixture",
      saveSecret: false,
    }),
  ).rejects.toThrow("STORAGE_FAILED");
});

it("expires/rejects trust challenges without forwarding authentication or changing a newer generation", async () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(0),
    f = await fixture(true);
  await f.controller.connect(f.profile.id, {
    password: "fixture",
    saveSecret: false,
  });
  const challenge = f.controller.challenges()[0]!;
  clock.mockReturnValue(120001);
  await expect(
    f.controller.handle("trust:approve", challenge.challengeId),
  ).rejects.toThrow("HOST_TRUST_REQUIRED");
  expect(f.controller.challenges()).toEqual([]);
  expect(f.connects).toBe(1);
  await f.controller.handle("trust:reject", crypto.randomUUID());
  clock.mockReturnValue(0);
  await f.controller.connect(f.profile.id, {
    password: "fixture",
    saveSecret: false,
  });
  const next = f.controller.challenges()[0]!;
  await f.controller.handle("trust:approve", next.challengeId);
  expect(f.controller.views()[0]?.status).toBe("connected");
  expect(f.repo.snapshot().hostTrust).toHaveLength(1);
  f.controller.engineStopped();
  expect(f.controller.challenges()).toEqual([]);
});
