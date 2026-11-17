import { z } from "zod";
import { settingsViewSchema, type SettingsView } from "../../shared/settings";
import { themeIdSchema } from "../../shared/themes";
import {
  endpointFor,
  type StateRepository,
} from "../persistence/state-repository";
type Confirmation = {
  kind: "trust" | "secret";
  endpoint: string;
  fingerprint?: string;
  name?: string;
  username?: string;
};
/** The operation lock also gates connect, trust approval and profile edits in main. */
export class SettingsController {
  private locked = false;
  constructor(
    private readonly state: () => StateRepository | null,
    private readonly healthy: () => boolean,
    private readonly confirm: (target: Confirmation) => Promise<boolean>,
    private readonly quiesce: (ids: string[]) => Promise<void>,
    private readonly busy: (id: string) => boolean,
  ) {}
  get writing(): boolean {
    return this.locked;
  }
  private repository(): StateRepository {
    const repo = this.state();
    if (!repo || repo.store.faulted || !this.healthy())
      throw new Error("STORAGE_FAILED");
    return repo;
  }
  get(): SettingsView {
    const repo = this.state();
    if (!repo) throw new Error("STORAGE_FAILED");
    const state = repo.snapshot();
    return settingsViewSchema.parse({
      ...state.settings,
      hostTrust: state.hostTrust.map(({ publicKey: _key, ...row }) => row),
      savedSecrets: state.profiles
        .filter((row) => row.secretId !== undefined)
        .map((row) => ({
          profileId: row.id,
          name: row.name,
          endpoint: endpointFor(row),
          username: row.username,
          authentication: row.authentication,
        })),
    });
  }
  async handle(action: string, payload: unknown): Promise<unknown> {
    if (action === "settings:get") {
      if (payload !== undefined) throw new Error("INPUT_INVALID");
      return this.get();
    }
    if (this.locked) throw new Error("REQUEST_BUSY");
    const repo = this.repository();
    this.locked = true;
    try {
      if (action === "settings:setHidden") {
        const value = z.boolean().parse(payload);
        await repo.store.update((state) => {
          this.repository();
          if (!state) throw new Error("STORAGE_FAILED");
          return {
            ...state,
            settings: { ...state.settings, showHiddenFiles: value },
          };
        });
        return;
      }
      if (action === "settings:setTheme") {
        const theme = themeIdSchema.parse(payload);
        await repo.store.update((state) => {
          this.repository();
          if (!state) throw new Error("STORAGE_FAILED");
          return { ...state, settings: { ...state.settings, theme } };
        });
        return;
      }
      if (action === "settings:update") {
        const settings = z
          .object({ language: z.literal("ko"), saveSecrets: z.boolean() })
          .strict()
          .parse(payload);
        await repo.store.update((state) => {
          this.repository();
          if (!state) throw new Error("STORAGE_FAILED");
          return { ...state, settings: { ...state.settings, ...settings } };
        });
        return;
      }
      if (action === "settings:removeTrust") {
        const endpoint = z.string().min(1).max(300).parse(payload),
          old = repo
            .snapshot()
            .hostTrust.find((row) => row.endpoint === endpoint);
        if (!old) throw new Error("INPUT_INVALID");
        if (
          !(await this.confirm({
            kind: "trust",
            endpoint,
            fingerprint: old.fingerprint,
          }))
        )
          return;
        this.repository();
        const ids = repo
          .snapshot()
          .profiles.filter((row) => endpointFor(row) === endpoint)
          .map((row) => row.id);
        await this.quiesce(ids);
        await repo.store.update((state) => {
          this.repository();
          if (!state) throw new Error("STORAGE_FAILED");
          if (
            state.profiles.some(
              (row) => endpointFor(row) === endpoint && this.busy(row.id),
            )
          )
            throw new Error("PROFILE_BUSY");
          const current = state.hostTrust.find(
            (row) => row.endpoint === endpoint,
          );
          if (
            current?.publicKey !== old.publicKey ||
            current?.approvedAt !== old.approvedAt
          )
            throw new Error("TOKEN_EXPIRED");
          return {
            ...state,
            hostTrust: state.hostTrust.filter(
              (row) => row.endpoint !== endpoint,
            ),
          };
        });
        return;
      }
      if (action === "settings:removeSecret") {
        const id = z.uuid().parse(payload),
          profile = repo.snapshot().profiles.find((row) => row.id === id);
        if (!profile || !profile.secretId) throw new Error("PROFILE_NOT_FOUND");
        if (
          !(await this.confirm({
            kind: "secret",
            endpoint: endpointFor(profile),
            name: profile.name,
            username: profile.username,
          }))
        )
          return;
        this.repository();
        await this.quiesce([id]);
        await repo.store.update((state) => {
          this.repository();
          if (!state) throw new Error("STORAGE_FAILED");
          if (this.busy(id)) throw new Error("PROFILE_BUSY");
          return {
            ...state,
            profiles: state.profiles.map((row) => {
              if (row.id !== id) return row;
              const { secretId: _secret, ...rest } = row;
              return rest;
            }),
            encryptedSecrets: state.encryptedSecrets.filter(
              (row) => row.profileId !== id,
            ),
          };
        });
        return;
      }
      throw new Error("INPUT_INVALID");
    } finally {
      this.locked = false;
    }
  }
}
