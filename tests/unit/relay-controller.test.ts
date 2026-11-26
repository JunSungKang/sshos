import { randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { RelayController } from "../../src/main/transfers/relay";
import { RelayStaging } from "../../src/platform/local-files/relay-staging";
import { ReceiptRepository } from "../../src/main/persistence/receipts";
import type { RelayPreview, RelayReceipt } from "../../src/shared/relay";
import type {
  TransferReceipt,
  TransferPhase,
} from "../../src/shared/transfers";
import type {
  StagedTransfer,
  TransferRuntime,
} from "../../src/shared/transfer-protocol";
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const r of roots.splice(0))
    await rm(r, { recursive: true, force: true });
});
const bytes = Buffer.from([0, 255, 1, 2, 3]),
  digest = createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  await mkdir(resolve(".local/tmp"), { recursive: true });
  const dir = await mkdtemp(resolve(".local/tmp/relay-test-"));
  roots.push(dir);
  const stage = new RelayStaging(dir),
    repo = await ReceiptRepository.open(dir),
    epoch = randomUUID();
  const a = randomUUID(),
    b = randomUUID(),
    ea = randomUUID(),
    ta = randomUUID(),
    tb = randomUUID();
  const sessions = [
    { serverId: a, generation: 1, sessionToken: ta },
    { serverId: b, generation: 1, sessionToken: tb },
  ].map((s) => ({
    ...s,
    status: "connected",
    os: "supported",
    sftp: "available",
  }));
  const cap = (t: string) => {
    const s = sessions.find(
      (s) => s.sessionToken === t && s.status === "connected",
    );
    if (!s) throw Error("SESSION_UNAVAILABLE");
    return { serverId: s.serverId, generation: s.generation };
  };
  const connections = {
    sessionCapability: cap,
    sessionIdentity: (id: string) => ({
      endpointSnapshot: {
        name: id,
        host: id,
        port: 22,
        endpoint: id + ":22",
        username: "user",
      },
      hostKeyFingerprint: "sha256:" + id,
    }),
    views: () => sessions,
  };
  const files = {
    resolveEntry: (t: string) => {
      if (t !== ea) throw Error("TOKEN_EXPIRED");
      return {
        browser: { sessionToken: ta },
        path: "/src",
        rawName: "CON:one",
        type: "file",
      };
    },
  };
  const stat = { size: bytes.length, mtime: "1000", identity: "" },
    requests: string[] = [];
  let blocked: string | null = null;
  const gateway = {
    epoch,
    request: vi.fn(async (q: { action: string; serverId: string }) => {
      requests.push(q.action);
      if (q.action === "transfer:inspect") return stat;
      if (q.action === "relay:inspectDestination") {
        if (blocked) throw Error(blocked);
        return { capacity: "unknown", availableBytes: null };
      }
    }),
  };
  const specs: StagedTransfer[] = [],
    active = new Set<string>();
  let observe:
    | ((row: TransferReceipt, rt: TransferRuntime) => void)
    | undefined;
  const transfers = {
    onRelaySettled: (cb: typeof observe) => {
      observe = cb;
    },
    registerRelay: async (spec: StagedTransfer) => {
      specs.push(spec);
      active.add(spec.row.taskId);
      await repo.save(spec.row);
    },
    acknowledge: vi.fn(async () => {}),
    overlays: () => [],
    isActive: (id: string) => active.has(id),
    taskState: (id: string) => ({
      active: active.has(id),
      cancelable: active.has(id),
      cleanupPending: false,
      bytesPerSecond: null,
    }),
    handle: async (_a: string, id: string) => {
      active.delete(id);
    },
  };
  const deps = {
    files,
    connections,
    gateway,
    transfers,
    staging: stage,
    repository: () => repo,
    healthy: () => true,
  };
  const controller = new RelayController(deps as never);
  const input = {
    entryToken: ea,
    destinationSessionToken: tb,
    directory: "/out",
  };
  const preview = async (options = input) =>
    (await controller.handle("relay:preview", options)) as RelayPreview;
  const start = async () => {
    const p = await preview();
    expect(p.errorCode).toBeNull();
    return (await controller.handle(
      "relay:start",
      p.confirmationToken,
    )) as string;
  };
  async function finish(
    index: number,
    phase: TransferPhase = "completed",
    overrides: Partial<TransferReceipt> = {},
  ) {
    const initial = specs[index]!.row;
    let identity: string | undefined;
    if (initial.direction === "download" && phase === "completed") {
      await writeFile(initial.destination, bytes);
      const p = repo.get(initial.relayParentId!) as RelayReceipt;
      identity = (await stage.verify(p.stageArea!)).identity;
    }
    const row: TransferReceipt = {
      ...initial,
      phase,
      stage: phase,
      lastConfirmedPhase:
        phase === "completed"
          ? overrides.cleanupState === "needed" ||
            overrides.cleanupState === "unknown"
            ? "destination_confirmed"
            : "temp_removed"
          : phase,
      dispatchAllowed: phase === "completed",
      streamSha256: phase === "completed" ? digest : null,
      transferredBytes: phase === "completed" ? bytes.length : 0,
      verifiedBytes: phase === "completed" ? bytes.length : 0,
      destinationCreated: phase === "completed",
      tempCreated: phase === "completed",
      cleanupState: phase === "completed" ? "confirmed" : "none",
      ...(identity ? { localTempIdentity: identity } : {}),
      ...overrides,
    };
    if (row.localTempIdentity === undefined) delete row.localTempIdentity;
    await repo.save(row);
    active.delete(row.taskId);
    observe!(initial, {
      ...row,
      bytesPerSecond: null,
      recordError: false,
      active: false,
      slotOccupied: false,
      cleanupPending: false,
    });
    await controller.settled();
  }
  const parent = (id: string) => repo.get(id) as RelayReceipt;
  return {
    controller,
    parent,
    start,
    finish,
    specs,
    preview,
    requests,
    sessions,
    repo,
    stage,
    dir,
    transfers,
    tb,
    ta,
    input,
    stat,
    active,
    emit(child: TransferReceipt, runtime: Partial<TransferRuntime> = {}) {
      observe!(child, {
        ...child,
        phase: child.phase,
        recordError: false,
        active: false,
        slotOccupied: false,
        cleanupPending: false,
        bytesPerSecond: null,
        ...runtime,
      });
    },
    deps,
    block: (code: string | null) => {
      blocked = code;
    },
  };
}
it("fixes both sessions at confirmation, hands off after A closure and verified bytes, and cleans the private stage", async () => {
  const f = await fixture();
  const p = await f.preview();
  expect(f.specs).toHaveLength(0);
  expect(p.remoteAvailableBytes).toBeNull();
  const id = (await f.controller.handle(
    "relay:start",
    p.confirmationToken,
  )) as string;
  await expect(
    f.controller.handle("relay:start", p.confirmationToken),
  ).rejects.toThrow("TOKEN_EXPIRED");
  expect(f.specs).toHaveLength(1);
  const a = f.specs[0]!.row;
  expect(a.destination.endsWith("/payload")).toBe(true);
  expect(a.source).toBe("/src/CON:one");
  await f.controller.dispatchCheck(a);
  f.sessions[0]!.status = "disconnected";
  await f.finish(0);
  expect(f.specs).toHaveLength(2);
  expect(f.specs[1]).toMatchObject({
    relay: { parentId: id, expectedSha256: digest },
    row: { destination: "/out/CON:one", direction: "upload" },
  });
  await expect(f.repo.forget(a.taskId)).rejects.toThrow("REQUEST_BUSY");
  await f.finish(1);
  expect(f.controller.list()).toMatchObject([
    {
      id,
      phase: "completed",
      publication: "confirmed",
      localCleanup: "confirmed",
    },
  ]);
  expect(f.parent(id).stageArea).toBeNull();
  expect(f.requests.filter((a) => a === "transfer:releaseRelay")).toHaveLength(
    1,
  );
});
it("preserves a verified stage on a B failure and retries only after confirming a new preview without A", async () => {
  const f = await fixture(),
    id = await f.start();
  f.block("REMOTE_DISK_FULL");
  await f.finish(0);
  expect(f.controller.list()[0]).toMatchObject({
    phase: "failed",
    retryable: true,
  });
  expect(f.specs).toHaveLength(1);
  f.sessions[0]!.status = "disconnected";
  f.block(null);
  const p = (await f.controller.handle("relay:retryPreview", {
    parentId: id,
    destinationSessionToken: f.tb,
    directory: "/new",
    name: "copy",
  })) as RelayPreview;
  expect(p.errorCode).toBeNull();
  expect(p.disk).toBeNull();
  await f.controller.handle("relay:start", p.confirmationToken);
  expect(f.specs[1]!.row.destination).toBe("/new/copy");
  await f.finish(1, "result_unknown", {
    errorCode: "RESULT_UNKNOWN",
    dispatchAllowed: true,
    cleanupState: "unknown",
  });
  expect(f.controller.list()[0]).toMatchObject({
    retryable: false,
    acknowledgeable: true,
    publication: "unknown",
    discardable: true,
  });
  await f.controller.handle("relay:acknowledge", id);
  await f.controller.handle("relay:discard", id);
  expect(f.controller.hasWork()).toBe(false);
});
it("blocks early destination conflicts and leaves a failed or unverifiable A copy off B", async () => {
  const f = await fixture();
  f.block("NAME_CONFLICT");
  expect(await f.preview()).toMatchObject({
    errorCode: "NAME_CONFLICT",
    confirmationToken: null,
  });
  expect(f.specs).toHaveLength(0);
  f.block(null);
  const id = await f.start();
  await f.finish(0, "failed", { errorCode: "SOURCE_CHANGED" });
  expect(f.specs).toHaveLength(1);
  expect(f.parent(id)).toMatchObject({
    phase: "failed",
    publication: "none",
    stageArea: null,
  });
});
it("preserves one job when dispatch needs more space and never replays on reopen", async () => {
  const f = await fixture(),
    id = await f.start();
  await f.finish(0, "failed", { errorCode: "LOCAL_DISK_FULL" });
  expect(f.controller.list()[0]).toMatchObject({
    phase: "waiting_for_space",
    retryable: true,
  });
  const p = (await f.controller.handle("relay:retryPreview", {
    parentId: id,
    destinationSessionToken: f.tb,
    directory: "/out",
  })) as RelayPreview;
  expect(await f.controller.handle("relay:start", p.confirmationToken)).toBe(
    id,
  );
  expect(f.specs).toHaveLength(2);
  expect(f.parent(id).legIds).toHaveLength(2);
  await f.finish(1);
  const total = f.specs.length;
  const reopened = await ReceiptRepository.open(f.dir);
  const fresh = new RelayController({
    ...f.deps,
    repository: () => reopened,
  } as never);
  await fresh.restore();
  expect(f.specs).toHaveLength(total);
  expect(fresh.list()[0]?.retryable).toBe(false);
});

it("binds capabilities, file type, server eligibility and host fingerprint at both validation points", async () => {
  const f = await fixture();
  await expect(
    f.preview({ ...f.input, destinationSessionToken: f.ta }),
  ).rejects.toThrow("INPUT_INVALID");
  for (const [key, value, expected] of [
    ["os", "unknown", "OS_UNKNOWN"],
    ["os", "unsupported", "OS_UNSUPPORTED"],
    ["sftp", "unavailable", "SFTP_UNAVAILABLE"],
  ]) {
    const session = f.sessions[1] as Record<string, string>;
    const original = session[key!];
    session[key!] = value!;
    await expect(f.preview()).rejects.toThrow(expected);
    session[key!] = original!;
  }
  const file = vi.spyOn(f.deps.files, "resolveEntry");
  file.mockReturnValueOnce({
    browser: { sessionToken: f.ta },
    path: "/src",
    rawName: "sub",
    type: "directory",
  });
  await expect(f.preview()).rejects.toThrow("PATH_UNSUPPORTED");
  await expect(
    f.controller.handle("relay:retryPreview", {
      parentId: randomUUID(),
      destinationSessionToken: f.tb,
      directory: "/d",
    }),
  ).rejects.toThrow("TOKEN_EXPIRED");
  const p = await f.preview(),
    old = f.deps.connections.sessionIdentity;
  const identity = vi
    .spyOn(f.deps.connections, "sessionIdentity")
    .mockImplementation((id) => ({
      ...old(id),
      hostKeyFingerprint: "changed",
    }));
  await expect(
    f.controller.handle("relay:start", p.confirmationToken),
  ).rejects.toThrow("TOKEN_EXPIRED");
  identity.mockRestore();
  const alias = vi
    .spyOn(f.deps.connections, "sessionIdentity")
    .mockImplementation(() => old(f.sessions[0]!.serverId));
  await expect(f.preview({ ...f.input, directory: "/src" })).rejects.toThrow(
    "NAME_CONFLICT",
  );
  alias.mockRestore();
  const q = await f.preview();
  f.stat.size++;
  await expect(
    f.controller.handle("relay:start", q.confirmationToken),
  ).rejects.toThrow("SOURCE_CHANGED");
  expect(f.specs).toHaveLength(0);
});
it("expires, releases and invalidates previews without starting transfers; caps pending and in-progress checks", async () => {
  const f = await fixture();
  for (let i = 0; i < 6; i++)
    expect((await f.preview()).confirmationToken).toBeTruthy();
  await expect(f.preview()).rejects.toThrow("REQUEST_BUSY");
  const time = vi
    .spyOn(performance, "now")
    .mockReturnValue(performance.now() + 120000);
  const p = await f.preview();
  f.controller.invalidateRenderer();
  await expect(
    f.controller.handle("relay:start", p.confirmationToken),
  ).rejects.toThrow("TOKEN_EXPIRED");
  time.mockRestore();
  const q = await f.preview();
  await f.controller.handle("relay:releasePreview", q.confirmationToken);
  await expect(
    f.controller.handle("relay:start", q.confirmationToken),
  ).rejects.toThrow("TOKEN_EXPIRED");
  let resolveProbe!: () => void;
  const gate = new Promise<void>((r) => {
    resolveProbe = r;
  });
  const probe = f.stage.preview.bind(f.stage);
  vi.spyOn(f.stage, "preview").mockImplementation(async (size) => {
    await gate;
    return probe(size);
  });
  const one = f.preview(),
    two = f.preview();
  await expect(f.preview()).rejects.toThrow("REQUEST_BUSY");
  resolveProbe();
  await Promise.all([one, two]);
  expect(await f.controller.handle("relay:list")).toEqual([]);
  await expect(f.controller.handle("relay:list", "bad")).rejects.toThrow(
    "INPUT_INVALID",
  );
  await expect(
    f.controller.handle("relay:other", randomUUID()),
  ).rejects.toThrow("INPUT_INVALID");
  await expect(
    f.controller.handle("relay:inspect", randomUUID()),
  ).rejects.toThrow("TOKEN_EXPIRED");
});
it("reports known B bytes, explicit readonly, local deficit, and unknown capacity separately", async () => {
  const f = await fixture();
  const request = f.deps.gateway.request,
    base = request.getMockImplementation()!;
  for (const [available, error, code] of [
    ["2", undefined, "REMOTE_DISK_FULL"],
    ["0", "PERMISSION_DENIED", "PERMISSION_DENIED"],
    ["340282366920938463463374607431768211455", undefined, null],
  ]) {
    request.mockImplementation(async (q) =>
      q.action === "relay:inspectDestination"
        ? { capacity: "known", availableBytes: available, errorCode: error }
        : base(q),
    );
    expect(await f.preview()).toMatchObject({
      remoteAvailableBytes: available,
      errorCode: code,
    });
  }
  const amount = await f.stage.preview(bytes.length);
  vi.spyOn(f.stage, "preview")
    .mockResolvedValueOnce({ ...amount, shortfallBytes: 1 })
    .mockRejectedValueOnce(Error("LOCAL_SPACE_UNKNOWN"));
  expect(await f.preview()).toMatchObject({
    errorCode: "LOCAL_DISK_FULL",
    disk: { shortfallBytes: 1 },
  });
  expect(await f.preview()).toMatchObject({
    errorCode: "LOCAL_SPACE_UNKNOWN",
    disk: null,
  });
});
it("compensates for a lost hold acknowledgement and an incomplete compensation before the next admission", async () => {
  const f = await fixture();
  const request = f.deps.gateway.request,
    base = request.getMockImplementation()!;
  let failures = 2;
  const calls: string[] = [];
  request.mockImplementation(async (q) => {
    calls.push(q.action);
    if (
      failures > 0 &&
      ["transfer:holdRelay", "transfer:releaseRelay"].includes(q.action)
    ) {
      failures--;
      throw Error("IO_TIMEOUT");
    }
    return base(q);
  });
  await expect(f.start()).rejects.toThrow("IO_TIMEOUT");
  expect(f.specs).toHaveLength(0);
  await f.start();
  expect(calls.filter((x) => x === "transfer:releaseRelay")).toHaveLength(2);
});
it("allows capacity rechecks only on the bound A task; checks both sessions again before the first byte", async () => {
  const f = await fixture(),
    id = await f.start(),
    child = f.specs[0]!.row;
  await expect(
    f.controller.dispatchCheck({ ...child, taskId: randomUUID() }),
  ).rejects.toThrow("TOKEN_EXPIRED");
  vi.spyOn(f.stage, "recheck").mockImplementationOnce(async () => {
    f.sessions[1]!.status = "disconnected";
  });
  await expect(f.controller.dispatchCheck(child)).rejects.toThrow(
    "SESSION_UNAVAILABLE",
  );
  f.sessions[1]!.status = "connected";
  vi.spyOn(f.stage, "recheck").mockImplementationOnce(async () => {
    await f.repo.save({ ...f.parent(id), phase: "cancelled" });
  });
  await expect(f.controller.dispatchCheck(child)).rejects.toThrow(
    "REQUEST_CANCELLED",
  );
});
it("recovers a local stage creation refusal without dispatching and compensates when parent persistence refuses admission", async () => {
  const f = await fixture();
  vi.spyOn(f.stage, "create").mockRejectedValueOnce(Error("LOCAL_DISK_FULL"));
  const id = await f.start();
  expect(f.controller.list()[0]).toMatchObject({
    id,
    phase: "waiting_for_space",
    retryable: true,
  });
  expect(f.specs).toHaveLength(0);
  await f.controller.handle("relay:cancel", id);
  expect(f.controller.list()[0]?.phase).toBe("cancelled");
  await expect(f.controller.handle("relay:cancel", id)).rejects.toThrow(
    "REQUEST_BUSY",
  );
  vi.spyOn(f.repo, "save").mockRejectedValueOnce(Error("STORAGE_FAILED"));
  await expect(f.start()).rejects.toThrow("STORAGE_FAILED");
  expect(f.specs).toHaveLength(0);
});
it("labels progress by leg and verification, cancels only the relevant session and preserves closed B handoff on A disconnect", async () => {
  const f = await fixture(),
    id = await f.start(),
    a = f.specs[0]!.row;
  const overlay = vi.spyOn(f.transfers, "overlays");
  for (const [phase, display] of [
    ["transferring", "receiving"],
    ["verifying", "verifying_local"],
    ["finalizing", "verifying_local"],
  ]) {
    overlay.mockReturnValue([
      { ...a, phase, transferredBytes: 4, verifiedBytes: 3 },
    ] as never);
    expect(f.controller.list()[0]).toMatchObject({
      phase: display,
      bytes: display === "receiving" ? 4 : 3,
    });
  }
  overlay.mockReturnValue([]);
  await f.finish(0);
  const b = f.specs[1]!.row;
  for (const [phase, display] of [
    ["queued", "waiting_to_send"],
    ["transferring", "sending"],
    ["verifying", "verifying_remote"],
    ["finalizing", "publishing"],
  ]) {
    overlay.mockReturnValue([
      { ...b, phase, transferredBytes: 4, verifiedBytes: 1 },
    ] as never);
    expect(f.controller.list()[0]?.phase).toBe(display);
  }
  expect(f.controller.hasFinalizing(f.sessions[1]!.serverId)).toBe(true);
  expect(f.controller.hasFinalizing(randomUUID())).toBe(false);
  const cancel = vi.spyOn(f.transfers, "handle");
  await f.controller.cancelForShutdown(a.serverId);
  expect(cancel).not.toHaveBeenCalled();
  overlay.mockReturnValue([]);
  await f.controller.cancelForShutdown(b.serverId);
  expect(cancel).toHaveBeenCalledWith("transfer:cancel", b.taskId);
  await f.finish(1, "cancelled", { errorCode: "REQUEST_CANCELLED" });
  expect(f.parent(id)).toMatchObject({ phase: "cancelled", stageArea: null });
});
it("requires manual review after uncertain B and reports observed absence, existence or unmappable paths without recopying", async () => {
  const f = await fixture(),
    id = await f.start();
  await f.finish(0);
  await f.finish(1, "result_unknown", {
    dispatchAllowed: true,
    cleanupState: "unknown",
  });
  for (const observation of [null, f.stat]) {
    f.deps.gateway.request.mockResolvedValueOnce(observation as never);
    expect(await f.controller.handle("relay:inspect", id)).toEqual({
      present: !!observation,
      size: observation?.size ?? null,
    });
  }
  f.deps.gateway.request
    .mockRejectedValueOnce(Error("PATH_UNSUPPORTED"))
    .mockRejectedValueOnce(Error("PERMISSION_DENIED"));
  expect(await f.controller.handle("relay:inspect", id)).toEqual({
    present: null,
    size: null,
  });
  await expect(f.controller.handle("relay:inspect", id)).rejects.toThrow(
    "PERMISSION_DENIED",
  );
  await expect(
    f.controller.handle("relay:retryPreview", {
      parentId: id,
      destinationSessionToken: f.tb,
      directory: "/out",
    }),
  ).rejects.toThrow("REQUEST_BUSY");
  expect(f.specs).toHaveLength(2);
});
it("distinguishes B completion from failed PC cleanup, refuses stale quit consent, permits idempotent discard", async () => {
  const f = await fixture(),
    id = await f.start();
  await expect(f.controller.handle("relay:discard", id)).rejects.toThrow(
    "REQUEST_BUSY",
  );
  await expect(f.controller.handle("relay:acknowledge", id)).rejects.toThrow(
    "REQUEST_BUSY",
  );
  await f.finish(0);
  vi.spyOn(f.stage, "discard").mockRejectedValueOnce(
    Error("PERMISSION_DENIED"),
  );
  await f.finish(1);
  expect(f.controller.list()[0]).toMatchObject({
    publication: "confirmed",
    localCleanup: "unknown",
    discardable: true,
    localStageBytes: bytes.length,
  });
  await expect(f.controller.discardForQuit(id, () => false)).rejects.toThrow(
    "TOKEN_EXPIRED",
  );
  await f.controller.discardForQuit(id, () => true);
  await f.controller.handle("relay:discard", id);
  expect(f.controller.list()[0]?.discardable).toBe(false);
});
it("rejects mismatched B digest, unproven A identity or storage evidence, ignores stale child events and halts on engine exit", async () => {
  const f = await fixture(),
    id = await f.start(),
    a = f.specs[0]!.row;
  f.emit({ ...a, taskId: randomUUID() });
  await f.controller.settled();
  expect(f.specs).toHaveLength(1);
  await f.finish(0);
  await f.finish(1, "completed", { streamSha256: "f".repeat(64) });
  expect(f.parent(id)).toMatchObject({
    phase: "result_unknown",
    publication: "unknown",
    errorCode: "VERIFY_MISMATCH",
  });
  const g = await fixture(),
    gId = await g.start();
  await g.finish(0, "completed", { localTempIdentity: undefined });
  expect(g.parent(gId)).toMatchObject({
    phase: "failed",
    errorCode: "VERIFY_MISMATCH",
    stageStat: null,
  });
  expect(g.specs).toHaveLength(1);
  const h = await fixture(),
    hId = await h.start();
  h.emit(h.specs[0]!.row, { recordError: true });
  await h.controller.settled();
  expect(h.controller.list()[0]?.errorCode).toBe("STORAGE_FAILED");
  await h.controller.engineStopped();
  expect(h.parent(hId)).toMatchObject({
    phase: "interrupted",
    publication: "none",
  });
});
it("keeps A hardlink cleanup separate, refuses changed retry targets and stage identities", async () => {
  const f = await fixture(),
    id = await f.start();
  f.block("PERMISSION_DENIED");
  await f.finish(0, "completed", { cleanupState: "needed" });
  const parent = f.parent(id);
  expect(parent.stageStat).not.toBeNull();
  expect(f.transfers.acknowledge).toHaveBeenCalled();
  f.block(null);
  const original = f.deps.connections.sessionIdentity;
  const ids = vi
    .spyOn(f.deps.connections, "sessionIdentity")
    .mockImplementation((id) => ({
      ...original(id),
      hostKeyFingerprint: "other",
    }));
  await expect(
    f.controller.handle("relay:retryPreview", {
      parentId: id,
      destinationSessionToken: f.tb,
      directory: "/d",
    }),
  ).rejects.toThrow("TOKEN_EXPIRED");
  ids.mockRestore();
  vi.spyOn(f.stage, "verify").mockResolvedValueOnce({
    ...parent.stageStat!,
    identity: "different",
  });
  const q = (await f.controller.handle("relay:retryPreview", {
    parentId: id,
    destinationSessionToken: f.tb,
    directory: "/d",
  })) as RelayPreview;
  expect(q.errorCode).toBe("SOURCE_CHANGED");
  expect(f.specs).toHaveLength(1);
});

it("recovers ownership after a storage fault between local stage creation and acknowledgement, without dispatch", async () => {
  const f = await fixture();
  const save = f.repo.save.bind(f.repo);
  vi.spyOn(f.repo, "save").mockImplementation(async (row) => {
    if (row.kind === "server_relay" && row.stageArea) {
      f.repo.markFault();
      throw Error("STORAGE_FAILED");
    }
    return save(row);
  });
  const preview = await f.preview();
  await expect(
    f.controller.handle("relay:start", preview.confirmationToken),
  ).rejects.toThrow("STORAGE_FAILED");
  expect(f.specs).toHaveLength(0);
  const reopened = await ReceiptRepository.open(f.dir);
  f.deps.repository = () => reopened;
  await f.controller.restore(true);
  expect(f.controller.list()[0]).toMatchObject({
    phase: "interrupted",
    discardable: true,
    retryable: false,
    localCleanup: "needed",
  });
  const parent = f.controller.list()[0]!;
  expect(parent.localStagePath).toBeTruthy();
  await f.controller.handle("relay:discard", parent.id);
  expect(f.specs).toHaveLength(0);
  expect(f.controller.hasWork()).toBe(false);
});
it("requires durable publication/checkpoints and ordered runtime release independently", async () => {
  const f = await fixture(),
    id = await f.start(),
    child = f.specs[0]!.row;
  f.emit(child, { active: true, slotOccupied: true });
  await f.controller.settled();
  expect(f.specs).toHaveLength(1);
  await f.finish(0, "completed", { dispatchAllowed: false });
  expect(f.parent(id)).toMatchObject({
    phase: "result_unknown",
    publication: "none",
  });
  expect(f.specs).toHaveLength(1);
  await f.controller.handle("relay:acknowledge", id);
  await f.controller.handle("relay:discard", id);
  expect(f.controller.hasWork()).toBe(false);
});
