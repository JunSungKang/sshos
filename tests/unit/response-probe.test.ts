import { afterEach, describe, it, expect, vi } from "vitest";
import { ResponseProbe } from "../../src/main/connections/probes";
import type { EngineGateway } from "../../src/main/engine-gateway";
import type { SessionView } from "../../src/shared/session-contracts";
import type { EngineCommand } from "../../src/shared/engine-protocol";
afterEach(() => vi.useRealTimers());
function fixture() {
  let now = 0,
    focused = true;
  const serverId = crypto.randomUUID(),
    epoch = crypto.randomUUID(),
    rows: SessionView[] = [
      {
        serverId,
        generation: 1,
        status: "connected",
        os: "unsupported",
        osConfirmed: false,
        sftp: "unavailable",
        initialPath: null,
        errorCode: null,
        serverName: "fixture",
        host: "example.invalid",
        port: 22,
        username: "fixture",
        sessionToken: null,
      },
    ];
  const requests: EngineCommand[] = [],
    answers: {
      request: Extract<EngineCommand, { action: "probe:run" }>;
      resolve: (raw: unknown) => void;
    }[] = [];
  const gateway = {
    epoch,
    request: vi.fn((request: EngineCommand) => {
      requests.push(request);
      if (request.action === "probe:run")
        return new Promise((done) => answers.push({ request, resolve: done }));
      return Promise.resolve();
    }),
  } as unknown as EngineGateway;
  const probe = new ResponseProbe(
    gateway,
    () => rows,
    () => focused,
    () => true,
    () => now,
  );
  const sample = (index = 0, overrides: Record<string, unknown> = {}) => {
    const { request, resolve } = answers[index]!;
    resolve({
      serverId: request.serverId,
      sessionGeneration: request.generation,
      backendEpoch: epoch,
      probeEpoch: request.probeEpoch,
      probeId: request.probeId,
      transferActive: true,
      status: "sample",
      elapsedMs: 84,
      measuredAt: new Date().toISOString(),
      ...overrides,
    });
  };
  return {
    probe,
    rows,
    answers,
    requests,
    sample,
    serverId,
    time: (value: number) => {
      now = value;
    },
    focus: (value: boolean) => {
      focused = value;
      probe.invalidate();
    },
  };
}
const tick = async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve();
};
describe("main active-server probe display and freshness", () => {
  it("measures authenticated control independently of OS/SFTP and retains only correctly bound sample metadata", async () => {
    const f = fixture();
    try {
      f.probe.select(f.serverId);
      expect(f.probe.view().status).toBe("measuring");
      f.time(100);
      f.sample();
      await tick();
      expect(f.probe.view()).toMatchObject({
        status: "sample",
        sample: { elapsedMs: 84, transferActive: true },
      });
      f.time(5099);
      f.probe.refresh();
      expect(f.answers).toHaveLength(1);
      f.time(5100);
      f.probe.refresh();
      expect(f.answers).toHaveLength(2);
    } finally {
      f.probe.dispose();
    }
  });
  it("removes numbers on blur and ignores a reply from the old focus epoch", async () => {
    const f = fixture();
    try {
      f.probe.select(f.serverId);
      f.focus(false);
      expect(f.probe.view()).toMatchObject({ status: "paused", sample: null });
      f.sample();
      await tick();
      expect(f.probe.view().sample).toBeNull();
      f.focus(true);
      expect(f.answers).toHaveLength(2);
      f.sample(1);
      await tick();
      expect(f.probe.view().status).toBe("sample");
      expect(f.requests.some((row) => row.action === "probe:invalidate")).toBe(
        true,
      );
    } finally {
      f.probe.dispose();
    }
  });
  it("drops stale generation replies and never reassigns a sample to a newly connected generation", async () => {
    const f = fixture();
    try {
      f.probe.select(f.serverId);
      f.rows[0]!.generation = 2;
      f.probe.refresh();
      f.sample();
      await tick();
      expect(f.probe.view()).toMatchObject({
        generation: 2,
        status: "measuring",
        sample: null,
      });
      f.sample(1);
      await tick();
      expect(f.probe.view()).toMatchObject({ generation: 2, status: "sample" });
      f.rows[0]!.status = "disconnected";
      expect(f.probe.view()).toMatchObject({
        status: "disconnected",
        sample: null,
      });
    } finally {
      f.probe.dispose();
    }
  });
  it("displays delayed after5s without freeing a pending request and rejects a late sample rather than labeling it fresh", async () => {
    const f = fixture();
    try {
      f.probe.select(f.serverId);
      f.time(5001);
      expect(f.probe.view()).toMatchObject({ status: "delayed", sample: null });
      f.time(20000);
      f.probe.refresh();
      expect(f.answers).toHaveLength(1);
      f.sample();
      await tick();
      expect(f.probe.view()).toMatchObject({ status: "delayed", sample: null });
    } finally {
      f.probe.dispose();
    }
  });
  it("rejects unknown server selection and never puts a failed probe into connection-lost state", async () => {
    const f = fixture();
    try {
      expect(() => f.probe.select(crypto.randomUUID())).toThrow(
        "SESSION_UNAVAILABLE",
      );
      f.probe.select(f.serverId);
      f.answers[0]!.resolve({ invalid: true });
      await tick();
      expect(f.probe.view()).toMatchObject({
        status: "unavailable",
        sample: null,
      });
      f.time(20000);
      f.probe.refresh();
      expect(f.answers).toHaveLength(1);
      expect(f.rows[0]!.status).toBe("connected");
    } finally {
      f.probe.dispose();
    }
  });
});

it("rejects every mismatched sample identity field without affecting the connected session", async () => {
  for (const field of [
    "serverId",
    "sessionGeneration",
    "backendEpoch",
    "probeEpoch",
    "probeId",
    "transferActive",
  ]) {
    const f = fixture();
    try {
      f.probe.select(f.serverId);
      f.sample(0, {
        [field]:
          field === "sessionGeneration"
            ? 99
            : field === "transferActive"
              ? false
              : crypto.randomUUID(),
      });
      await tick();
      expect(f.probe.view()).toMatchObject({
        serverId: f.serverId,
        status: "unavailable",
        sample: null,
      });
      expect(f.rows[0]!.status).toBe("connected");
    } finally {
      f.probe.dispose();
    }
  }
});
it("removes a cached numeric sample after15s even when no intermediate scheduler tick occurred", async () => {
  const f = fixture();
  try {
    f.probe.select(f.serverId);
    f.time(100);
    f.sample();
    await tick();
    expect(f.probe.view().status).toBe("sample");
    f.time(15001);
    expect(f.probe.view()).toMatchObject({ status: "measuring", sample: null });
  } finally {
    f.probe.dispose();
  }
});
