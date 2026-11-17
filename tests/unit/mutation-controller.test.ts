import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { MutationController } from "../../src/main/file-operations/mutations";
import { ReceiptRepository } from "../../src/main/persistence/receipts";
import type { FileController } from "../../src/main/file-operations/files";
import type { ConnectionController } from "../../src/main/connections/connections";
import type { EngineGateway } from "../../src/main/engine-gateway";
import type { MutationPreview } from "../../src/shared/mutations";
import { transferReceipt } from "../fixtures/transfers";
import { executionReceipt } from "../fixtures/executions";
const owned: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const path of owned.splice(0)) await rm(path, { recursive: true });
});
async function fixture(failPhase?: string) {
  const base = resolve(".local/tmp");
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(resolve(base, "controller-"));
  owned.push(directory);
  const repo = await ReceiptRepository.open(directory);
  const serverId = crypto.randomUUID(),
    sessionToken = crypto.randomUUID(),
    targetToken = crypto.randomUUID();
  const trace: string[] = [];
  const files = {
    resolveDirectory: (token: string) => {
      if (token !== targetToken) throw new Error("TOKEN_EXPIRED");
      return {
        path: "/home",
        browser: { serverId, generation: 2, sessionToken },
      };
    },
    resolveEntry: (token: string) => {
      if (token !== targetToken) throw new Error("TOKEN_EXPIRED");
      return {
        path: "/home",
        rawName: "old",
        type: "file",
        browser: { serverId, generation: 2, sessionToken },
      };
    },
  } as unknown as FileController;
  const identity = {
    generation: 2,
    endpointSnapshot: {
      name: "fixture",
      host: "example.invalid",
      port: 22,
      username: "fixture",
      endpoint: "example.invalid:22",
    },
    hostKeyFingerprint: "SHA256:fixture",
  };
  const connections = {
    sessionCapability: (token: string) => {
      if (token !== sessionToken) throw new Error("TOKEN_EXPIRED");
      return { serverId, generation: 2 };
    },
    views: () => [
      {
        serverId,
        generation: 2,
        sftp: "available",
        os: "supported",
        osConfirmed: false,
      },
    ],
    sessionIdentity: () => identity,
  } as unknown as ConnectionController;
  const originalSave = repo.save.bind(repo);
  vi.spyOn(repo, "save").mockImplementation(async (row) => {
    trace.push("save:" + row.phase);
    if (row.phase === failPhase) throw new Error("STORAGE_FAILED");
    await originalSave(row);
  });
  const gateway = {
    epoch: crypto.randomUUID(),
    request: async (request: {
      action: string;
      serverId: string;
      generation: number;
    }) => {
      expect(request.serverId).toBe(serverId);
      expect(request.generation).toBe(2);
      trace.push(request.action);
      if (request.action === "mutation:inspect") return null;
      if (request.action === "mutation:prepare") {
        expect(repo.snapshots()[0]?.phase).toBe("prepared");
        return true;
      }
      if (request.action === "mutation:step") {
        expect(repo.snapshots()[0]?.phase).toBe("dispatched");
        return {
          phase: "completed",
          destinationCreated: true,
          sourceRemovalConfirmed: false,
          lastConfirmedPhase: "mkdir_ack",
          errorCode: null,
        };
      }
      return undefined;
    },
  } as unknown as EngineGateway;
  const controller = new MutationController(
    files,
    connections,
    gateway,
    () => repo,
    () => true,
  );
  return { controller, repo, targetToken, trace, gateway, files, connections };
}
it("persists both rename acknowledgements in order before source removal and waits for cleanup", async () => {
  const f = await fixture(),
    original = f.gateway.request.bind(f.gateway);
  f.gateway.request = async (request) =>
    request.action === "mutation:step"
      ? request.stage === "first"
        ? {
            phase: "first_ack",
            destinationCreated: true,
            sourceRemovalConfirmed: false,
            lastConfirmedPhase: "link_ack",
            errorCode: null,
          }
        : {
            phase: "completed",
            destinationCreated: true,
            sourceRemovalConfirmed: true,
            lastConfirmedPhase: "source_removed",
            errorCode: null,
          }
      : original(request);
  const preview = (await f.controller.handle("file:previewMutation", {
    operation: "rename",
    targetToken: f.targetToken,
    name: "new",
  })) as MutationPreview;
  expect(preview).toMatchObject({
    source: "/home/old",
    destination: "/home/new",
  });
  const id = (await f.controller.handle(
    "file:startMutation",
    preview.confirmationToken,
  )) as string;
  await f.controller.settled();
  expect(f.repo.get(id)).toMatchObject({
    phase: "completed",
    destinationCreated: true,
    sourceRemovalConfirmed: true,
    lastConfirmedPhase: "source_removed",
  });
});
it("treats an impossible second rename first_ack as unknown and never retries the operation", async () => {
  const f = await fixture(),
    original = f.gateway.request.bind(f.gateway);
  let steps = 0;
  f.gateway.request = async (request) => {
    if (request.action === "mutation:step") {
      steps++;
      return {
        phase: "first_ack",
        destinationCreated: true,
        sourceRemovalConfirmed: false,
        lastConfirmedPhase: "link_ack",
        errorCode: null,
      };
    }
    return original(request);
  };
  const preview = (await f.controller.handle("file:previewMutation", {
      operation: "rename",
      targetToken: f.targetToken,
      name: "new",
    })) as MutationPreview,
    id = (await f.controller.handle(
      "file:startMutation",
      preview.confirmationToken,
    )) as string;
  await f.controller.settled();
  expect(f.repo.get(id)).toMatchObject({
    phase: "result_unknown",
    destinationCreated: true,
    errorCode: "RESULT_UNKNOWN",
  });
  expect(steps).toBe(2);
});
it("waits for a busy path lock without dispatching and abandons cleanly if session authority is revoked", async () => {
  const f = await fixture(),
    original = f.gateway.request.bind(f.gateway);
  let prepares = 0;
  f.gateway.request = async (request) => {
    if (request.action === "mutation:prepare") {
      prepares++;
      return false;
    }
    return original(request);
  };
  const preview = (await f.controller.handle("file:previewMutation", {
      operation: "mkdir",
      targetToken: f.targetToken,
      name: "new",
    })) as MutationPreview,
    id = (await f.controller.handle(
      "file:startMutation",
      preview.confirmationToken,
    )) as string;
  await vi.waitFor(() => expect(prepares).toBe(1));
  vi.spyOn(f.connections, "sessionCapability").mockImplementation(() => {
    throw new Error("CONNECTION_LOST");
  });
  await f.controller.settled();
  expect(f.repo.get(id)).toMatchObject({
    phase: "failed",
    errorCode: "CONNECTION_LOST",
  });
  expect(f.trace).not.toContain("mutation:step");
});
it("refuses invalid names, session mismatch, readonly OS and unavailable command metadata before inspection", async () => {
  const f = await fixture();
  for (const name of ["", "../escape"])
    await expect(
      f.controller.handle("file:previewMutation", {
        operation: "mkdir",
        targetToken: f.targetToken,
        name,
      }),
    ).rejects.toThrow("PATH_UNSUPPORTED");
  const browser = f.files.resolveDirectory(f.targetToken).browser,
    cap = vi
      .spyOn(f.connections, "sessionCapability")
      .mockReturnValue({ serverId: crypto.randomUUID(), generation: 2 });
  await expect(
    f.controller.handle("file:previewMutation", {
      operation: "mkdir",
      targetToken: f.targetToken,
      name: "new",
    }),
  ).rejects.toThrow("TOKEN_EXPIRED");
  cap.mockRestore();
  const views = vi.spyOn(f.connections, "views");
  for (const [os, sftp, code] of [
    ["unknown", "available", "OS_UNKNOWN"],
    ["unsupported", "available", "OS_UNSUPPORTED"],
    ["supported", "unavailable", "COMMAND_UNAVAILABLE"],
  ] as const) {
    views.mockReturnValue([
      {
        serverId: browser.serverId,
        generation: 2,
        os,
        osConfirmed: false,
        sftp,
        metadata: sftp,
      },
    ] as never);
    await expect(
      f.controller.handle("file:previewMutation", {
        operation: "mkdir",
        targetToken: f.targetToken,
        name: "new",
      }),
    ).rejects.toThrow(code);
  }
  expect(f.trace).toEqual([]);
});
it("persists intent before every mutation dispatch and consumes confirmation once", async () => {
  const f = await fixture();
  const preview = (await f.controller.handle("file:previewMutation", {
    operation: "mkdir",
    targetToken: f.targetToken,
    name: "new",
  })) as MutationPreview;
  expect(f.trace).toEqual(["mutation:inspect"]);
  const id = await f.controller.handle(
    "file:startMutation",
    preview.confirmationToken,
  );
  await f.controller.settled();
  expect(f.trace.indexOf("save:dispatched")).toBeLessThan(
    f.trace.indexOf("mutation:step"),
  );
  expect(f.repo.snapshots()[0]?.phase).toBe("completed");
  expect(f.repo.snapshots()[0]?.taskId).toBe(id);
  await expect(
    f.controller.handle("file:startMutation", preview.confirmationToken),
  ).rejects.toThrow("TOKEN_EXPIRED");
});
it("bounds outstanding mutation previews and reclaims expired authorities", async () => {
  const f = await fixture(),
    clock = vi.spyOn(performance, "now").mockReturnValue(0);
  for (let i = 0; i < 20; i++)
    await f.controller.handle("file:previewMutation", {
      operation: "mkdir",
      targetToken: f.targetToken,
      name: "new" + i,
    });
  await expect(
    f.controller.handle("file:previewMutation", {
      operation: "mkdir",
      targetToken: f.targetToken,
      name: "overflow",
    }),
  ).rejects.toThrow("REQUEST_BUSY");
  clock.mockReturnValue(60001);
  await expect(
    f.controller.handle("file:previewMutation", {
      operation: "delete",
      targetToken: f.targetToken,
    }),
  ).resolves.toMatchObject({ source: "/home/old", destination: null });
});
it("does not start a mutation whose prepared intent cannot be stored", async () => {
  const f = await fixture("prepared"),
    preview = (await f.controller.handle("file:previewMutation", {
      operation: "mkdir",
      targetToken: f.targetToken,
      name: "new",
    })) as MutationPreview;
  await expect(
    f.controller.handle("file:startMutation", preview.confirmationToken),
  ).rejects.toThrow("STORAGE_FAILED");
  expect(f.controller.hasRunning).toBe(false);
  expect(f.trace).not.toContain("mutation:prepare");
});
it("requires current task identity and explicit confirmation for forget/acknowledge", async () => {
  const f = await fixture(),
    preview = (await f.controller.handle("file:previewMutation", {
      operation: "mkdir",
      targetToken: f.targetToken,
      name: "new",
    })) as MutationPreview,
    id = (await f.controller.handle(
      "file:startMutation",
      preview.confirmationToken,
    )) as string;
  await f.controller.settled();
  await expect(f.controller.handle("task:inspect", id)).resolves.toMatchObject({
    phase: "completed",
  });
  await expect(
    f.controller.handle("task:previewRecordAction", {
      id,
      action: "acknowledge",
    }),
  ).rejects.toThrow("INPUT_INVALID");
  const confirmation = (await f.controller.handle("task:previewRecordAction", {
    id,
    action: "forget",
  })) as { confirmationToken: string };
  await f.controller.handle(
    "task:applyRecordAction",
    confirmation.confirmationToken,
  );
  expect(f.repo.get(id)).toBeUndefined();
  await expect(
    f.controller.handle(
      "task:applyRecordAction",
      confirmation.confirmationToken,
    ),
  ).rejects.toThrow("TOKEN_EXPIRED");
  await expect(f.controller.handle("task:inspect", id)).rejects.toThrow(
    "INPUT_INVALID",
  );
  await expect(
    f.controller.handle("task:previewRecordAction", { id, action: "forget" }),
  ).rejects.toThrow("INPUT_INVALID");
  await expect(f.controller.handle("unknown", undefined)).rejects.toThrow(
    "INPUT_INVALID",
  );
});
it("acknowledges an unknown mutation without replay and releases only its restriction", async () => {
  const f = await fixture(),
    original = f.gateway.request.bind(f.gateway);
  f.gateway.request = async (request) => {
    if (request.action === "mutation:step") {
      f.trace.push(request.action);
      return {
        phase: "result_unknown",
        destinationCreated: false,
        sourceRemovalConfirmed: false,
        lastConfirmedPhase: "prepared",
        errorCode: "RESULT_UNKNOWN",
      };
    }
    return original(request);
  };
  const preview = (await f.controller.handle("file:previewMutation", {
      operation: "mkdir",
      targetToken: f.targetToken,
      name: "new",
    })) as MutationPreview,
    id = (await f.controller.handle(
      "file:startMutation",
      preview.confirmationToken,
    )) as string;
  await f.controller.settled();
  await expect(
    f.controller.handle("task:previewRecordAction", { id, action: "forget" }),
  ).rejects.toThrow("INPUT_INVALID");
  const confirmation = (await f.controller.handle("task:previewRecordAction", {
    id,
    action: "acknowledge",
  })) as { confirmationToken: string };
  await f.controller.handle(
    "task:applyRecordAction",
    confirmation.confirmationToken,
  );
  expect(f.repo.get(id)?.acknowledgedAt).not.toBeNull();
  expect(f.trace.filter((row) => row === "mutation:step")).toHaveLength(1);
  expect(f.trace.filter((row) => row === "mutation:finish")).toHaveLength(2);
});
it("rejects expired or changed record confirmations and caps live confirmations", async () => {
  const f = await fixture(),
    clock = vi.spyOn(performance, "now").mockReturnValue(0),
    preview = (await f.controller.handle("file:previewMutation", {
      operation: "mkdir",
      targetToken: f.targetToken,
      name: "new",
    })) as MutationPreview,
    id = (await f.controller.handle(
      "file:startMutation",
      preview.confirmationToken,
    )) as string;
  await f.controller.settled();
  const create = () =>
      f.controller.handle("task:previewRecordAction", {
        id,
        action: "forget",
      }) as Promise<{ confirmationToken: string }>,
    first = await create();
  clock.mockReturnValue(60001);
  await expect(
    f.controller.handle("task:applyRecordAction", first.confirmationToken),
  ).rejects.toThrow("TOKEN_EXPIRED");
  for (let i = 0; i < 20; i++) await create();
  await expect(create()).rejects.toThrow("REQUEST_BUSY");
  clock.mockReturnValue(120002);
  const latest = await create();
  await f.repo.save({
    ...f.repo.get(id)!,
    updatedAt: new Date(Date.now() + 1000).toISOString(),
  });
  await expect(
    f.controller.handle("task:applyRecordAction", latest.confirmationToken),
  ).rejects.toThrow("TOKEN_EXPIRED");
  expect(f.repo.get(id)).toBeDefined();
});
it("redacts native transfer paths in list/detail and delegates closure for other receipt kinds", async () => {
  const f = await fixture(),
    transfer = transferReceipt("download"),
    execution = {
      ...executionReceipt(),
      phase: "exited" as const,
      exitObserved: true,
      exitCode: 0,
      channelClosed: true,
    };
  await f.repo.save(transfer);
  await f.repo.save(execution);
  const close = vi.fn(async () => {}),
    controller = new MutationController(
      f.files,
      f.connections,
      f.gateway,
      () => f.repo,
      () => true,
      () => false,
      close,
    );
  const detail = (await controller.handle(
    "task:inspect",
    transfer.taskId,
  )) as typeof transfer;
  expect(detail.localParent).toBe("로컬 선택 폴더");
  expect(detail.destination).toMatch(/^로컬 · /);
  expect(detail.tempPath).toMatch(/^로컬 · /);
  const page = (await controller.handle("task:list", 0)) as { rows: any[] };
  expect(page.rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "file_transfer", operation: "download" }),
      expect.objectContaining({ kind: "gui_exec", operation: "exec" }),
    ]),
  );
  const action = (await controller.handle("task:previewRecordAction", {
    id: execution.taskId,
    action: "forget",
  })) as { confirmationToken: string };
  await controller.handle("task:applyRecordAction", action.confirmationToken);
  expect(close).toHaveBeenCalledWith(execution);
  expect(f.repo.get(execution.taskId)).toBeUndefined();
});
it("lists damaged records and forgets only after one-use confirmation", async () => {
  const f = await fixture(),
    id = crypto.randomUUID();
  vi.spyOn(f.repo, "damagedIds").mockReturnValue([id]);
  const forget = vi.spyOn(f.repo, "forget").mockResolvedValue();
  expect(await f.controller.handle("task:list", 0)).toMatchObject({
    rows: [],
    damagedIds: [id],
    nextOffset: null,
  });
  await expect(
    f.controller.handle("task:previewRecordAction", {
      id,
      action: "acknowledge",
    }),
  ).rejects.toThrow("INPUT_INVALID");
  const preview = (await f.controller.handle("task:previewRecordAction", {
    id,
    action: "forget",
  })) as { confirmationToken: string };
  expect(preview).toMatchObject({
    phase: "damaged",
    source: null,
    destination: null,
  });
  await f.controller.handle(
    "task:applyRecordAction",
    preview.confirmationToken,
  );
  expect(forget).toHaveBeenCalledWith(id);
});
it("never dispatches when saving intent fails", async () => {
  const f = await fixture("dispatched");
  const preview = (await f.controller.handle("file:previewMutation", {
    operation: "mkdir",
    targetToken: f.targetToken,
    name: "new",
  })) as MutationPreview;
  await f.controller.handle("file:startMutation", preview.confirmationToken);
  await f.controller.settled();
  expect(f.trace).not.toContain("mutation:step");
  expect(f.controller.snapshots()[0]?.phase).toBe("failed");
});
it("preserves observed destination creation when receipt save fails after ACK", async () => {
  const f = await fixture("completed");
  const preview = (await f.controller.handle("file:previewMutation", {
    operation: "mkdir",
    targetToken: f.targetToken,
    name: "new",
  })) as MutationPreview;
  await f.controller.handle("file:startMutation", preview.confirmationToken);
  await f.controller.settled();
  const row = f.controller.snapshots()[0];
  expect(row?.phase).toBe("result_unknown");
  expect(row?.destinationCreated).toBe(true);
  expect(row?.errorCode).toBe("STORAGE_FAILED");
});
it("rejects expired confirmation without any change request", async () => {
  const f = await fixture();
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  const preview = (await f.controller.handle("file:previewMutation", {
    operation: "mkdir",
    targetToken: f.targetToken,
    name: "new",
  })) as MutationPreview;
  clock.mockReturnValue(60001);
  await expect(
    f.controller.handle("file:startMutation", preview.confirmationToken),
  ).rejects.toThrow("TOKEN_EXPIRED");
  expect(f.trace).toEqual(["mutation:inspect"]);
});
it("keeps task pages below the IPC byte limit even with maximum-length paths", async () => {
  const f = await fixture();
  const path =
    "/" + Array.from({ length: 15 }, () => "a".repeat(255)).join("/") + "/end";
  const now = new Date().toISOString();
  const rows = Array.from({ length: 100 }, () => ({
    taskId: crypto.randomUUID(),
    kind: "file_mutation",
    operation: "rename",
    phase: "completed",
    endpointSnapshot: { name: "fixture" },
    source: path,
    destination: path + "2",
    errorCode: null,
    acknowledgedAt: null,
    updatedAt: now,
    createdAt: now,
  }));
  vi.spyOn(f.repo, "snapshots").mockReturnValue(
    rows as unknown as ReturnType<ReceiptRepository["snapshots"]>,
  );
  const page = (await f.controller.handle("task:list", 0)) as {
    rows: unknown[];
    nextOffset: number | null;
  };
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(
    256 * 1024,
  );
  expect(page.rows.length).toBeLessThan(100);
  expect(page.nextOffset).toBe(page.rows.length);
});

it("persists late ACK metadata on only the original unknown receipt, deduplicates and never resurrects forgotten work", async () => {
  const f = await fixture(),
    preview = (await f.controller.handle("file:previewMutation", {
      operation: "mkdir",
      targetToken: f.targetToken,
      name: "late",
    })) as MutationPreview;
  let requests = 0;
  const original = f.gateway.request.bind(f.gateway);
  f.gateway.request = async (request) => {
    if (request.action === "mutation:step") {
      requests++;
      return {
        phase: "result_unknown",
        destinationCreated: false,
        sourceRemovalConfirmed: false,
        lastConfirmedPhase: "prepared",
        errorCode: "RESULT_UNKNOWN",
      };
    }
    return original(request);
  };
  const id = (await f.controller.handle(
    "file:startMutation",
    preview.confirmationToken,
  )) as string;
  await f.controller.settled();
  const before = f.repo.get(id)!;
  expect(before.kind).toBe("file_mutation");
  const value = {
    backendEpoch: before.backendEpoch,
    serverId: before.serverId,
    generation: before.generation,
    taskId: id,
    operation: "mkdir" as const,
    source: null,
    destination: before.destination,
    observation: { stage: "mkdir_ack" as const, at: new Date().toISOString() },
  };
  for (const wrong of [
    { ...value, backendEpoch: crypto.randomUUID() },
    { ...value, generation: 99 },
    { ...value, serverId: crypto.randomUUID() },
    { ...value, destination: "/other" },
    { ...value, observation: { ...value.observation, stage: "delete_ack" } },
  ])
    f.controller.observe(wrong as never);
  await f.controller.settled();
  expect(f.repo.get(id)).toEqual(before);
  f.controller.observe(value);
  f.controller.observe(value);
  expect(f.controller.isActive(id)).toBe(true);
  await f.controller.settled();
  expect(f.repo.get(id)).toMatchObject({
    phase: "result_unknown",
    destinationCreated: true,
    lateObservations: [value.observation],
  });
  expect(requests).toBe(1);
  await f.repo.acknowledge(id);
  await f.repo.forget(id);
  f.controller.observe(value);
  await f.controller.settled();
  expect(f.repo.get(id)).toBeUndefined();
});

it("retains observed ACK metadata and blocks record closure while its writer is pending or failed", async () => {
  const f = await fixture(),
    preview = (await f.controller.handle("file:previewMutation", {
      operation: "mkdir",
      targetToken: f.targetToken,
      name: "late",
    })) as MutationPreview;
  const original = f.gateway.request.bind(f.gateway);
  f.gateway.request = async (request) =>
    request.action === "mutation:step"
      ? {
          phase: "result_unknown",
          destinationCreated: false,
          sourceRemovalConfirmed: false,
          lastConfirmedPhase: "prepared",
          errorCode: "RESULT_UNKNOWN",
        }
      : original(request);
  const id = (await f.controller.handle(
    "file:startMutation",
    preview.confirmationToken,
  )) as string;
  await f.controller.settled();
  const row = f.repo.get(id)!;
  let fail!: () => void;
  vi.mocked(f.repo.save).mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = () => reject(new Error("STORAGE_FAILED"));
      }),
  );
  f.controller.observe({
    backendEpoch: row.backendEpoch,
    serverId: row.serverId,
    generation: row.generation,
    taskId: id,
    operation: "mkdir",
    source: null,
    destination: row.destination,
    observation: { stage: "mkdir_ack", at: new Date().toISOString() },
  });
  for (let i = 0; i < 10 && !fail; i++) await Promise.resolve();
  await expect(
    f.controller.handle("task:previewRecordAction", {
      id,
      action: "acknowledge",
    }),
  ).rejects.toThrow("INPUT_INVALID");
  fail();
  await f.controller.settled();
  expect(
    f.controller.snapshots().find((value) => value.taskId === id),
  ).toMatchObject({
    phase: "result_unknown",
    destinationCreated: true,
    recordError: true,
    lateObservations: [{ stage: "mkdir_ack", at: expect.any(String) }],
  });
  expect(f.repo.get(id)).toMatchObject({ destinationCreated: false });
  await f.controller.reconcileStorage(f.repo);
  expect(f.repo.get(id)).toMatchObject({
    phase: "result_unknown",
    destinationCreated: true,
    lateObservations: [{ stage: "mkdir_ack", at: expect.any(String) }],
  });
  expect(
    f.controller.snapshots().find((value) => value.taskId === id),
  ).not.toHaveProperty("recordError");
});

it("never reconciles observed mutation facts into a missing or different receipt identity", async () => {
  const f = await fixture("completed"),
    preview = (await f.controller.handle("file:previewMutation", {
      operation: "mkdir",
      targetToken: f.targetToken,
      name: "original",
    })) as MutationPreview;
  const id = (await f.controller.handle(
    "file:startMutation",
    preview.confirmationToken,
  )) as string;
  await f.controller.settled();
  const original = f.repo.get(id)!;
  const read = vi.spyOn(f.repo, "get").mockReturnValue(undefined);
  await expect(f.controller.reconcileStorage(f.repo)).rejects.toThrow(
    "STORAGE_FAILED",
  );
  read.mockReturnValue({ ...original, destination: "/different" });
  await expect(f.controller.reconcileStorage(f.repo)).rejects.toThrow(
    "STORAGE_FAILED",
  );
  read.mockRestore();
  expect(f.repo.get(id)?.destination).toBe(original.destination);
  expect(
    f.controller.snapshots().find((row) => row.taskId === id),
  ).toMatchObject({ recordError: true, destinationCreated: true });
});
