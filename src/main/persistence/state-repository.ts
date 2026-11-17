import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { randomUUID } from "node:crypto";
import {
  initialState,
  profileInputSchema,
  stateSchema,
  type AppState,
  type Profile,
  type ProfileInput,
} from "../../shared/models";
import { AtomicJSONStore } from "./store";

export function normalizeHost(input: string): string {
  if (!input || /[\s/\\@?#\u0000-\u001f\u007f]/u.test(input))
    throw new Error("INPUT_INVALID");
  const bracketed = input.startsWith("[") && input.endsWith("]");
  const host = bracketed ? input.slice(1, -1) : input;
  const ip = isIP(host);
  if (bracketed && ip !== 6) throw new Error("INPUT_INVALID");
  if (ip === 4) return host;
  if (ip === 6) {
    try {
      return new URL(`http://[${host}]/`).hostname.slice(1, -1);
    } catch {
      throw new Error("INPUT_INVALID");
    }
  }
  const ascii = domainToASCII(host.replace(/\.$/, "")).toLowerCase();
  // URL/IDNA conversion accepts legacy octal/hex/short IPv4 forms; SSH does not.
  if (isIP(ascii) !== 0) throw new Error("INPUT_INVALID");
  if (
    !ascii ||
    Buffer.byteLength(ascii) > 253 ||
    !ascii
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw new Error("INPUT_INVALID");
  return ascii;
}
export const endpointFor = (profile: Pick<Profile, "host" | "port">) =>
  `${profile.host.includes(":") ? `[${profile.host}]` : profile.host}:${profile.port}`;

export class StateRepository {
  private constructor(
    readonly store: AtomicJSONStore<AppState>,
    readonly recovered: boolean,
  ) {}
  static async open(
    dataRoot: string,
    onDirectorySyncUnavailable?: () => void,
  ): Promise<StateRepository> {
    let created = false;
    try {
      await mkdir(dataRoot, { mode: 0o700 });
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST")
        throw new Error("STORAGE_FAILED");
    }
    const store = new AtomicJSONStore(
      join(dataRoot, "state.json"),
      stateSchema,
      1024 * 1024,
      onDirectorySyncUnavailable,
    );
    if (created) {
      await store.initialize(initialState());
      return new StateRepository(store, false);
    }
    // A pre-existing directory without a valid state is not silently reset.
    if ((await readdir(dataRoot)).length === 0)
      throw new Error("STORAGE_FAILED");
    const loaded = await store.load();
    if (loaded.recovered) {
      const state = loaded.value;
      state.hostTrust = state.hostTrust.map((row) => ({
        ...row,
        trusted: false,
      }));
      await store.save(state);
    }
    return new StateRepository(store, loaded.recovered);
  }
  snapshot(): AppState {
    return this.store.snapshot();
  }
  async retryStorage(): Promise<void> {
    const loaded = await this.store.recover();
    if (loaded.recovered) {
      const state = loaded.value;
      state.hostTrust = state.hostTrust.map((row) => ({
        ...row,
        trusted: false,
      }));
      await this.store.save(state);
    }
  }
  async create(input: ProfileInput): Promise<Profile> {
    const parsed = profileInputSchema.parse(input);
    const validated = profileInputSchema.parse(
      Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => value !== undefined),
      ),
    );
    const profile: Profile = {
      ...validated,
      host: normalizeHost(validated.host),
      id: randomUUID(),
    };
    await this.store.update((state) => {
      if (!state || state.profiles.length >= 10)
        throw new Error("PROFILE_LIMIT");
      return { ...state, profiles: [...state.profiles, profile] };
    });
    return structuredClone(profile);
  }
  async update(
    id: string,
    input: ProfileInput,
    isBusy: (id: string) => boolean,
  ): Promise<Profile> {
    const parsed = profileInputSchema.parse(input);
    const validated = profileInputSchema.parse(
      Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => value !== undefined),
      ),
    );
    const normalized = { ...validated, host: normalizeHost(validated.host) };
    const old = this.snapshot().profiles.find((p) => p.id === id);
    if (!old) throw new Error("PROFILE_NOT_FOUND");
    const identityChanged = (profile: Profile) =>
      profile.host !== normalized.host ||
      profile.port !== normalized.port ||
      profile.username !== normalized.username;
    const authenticationChanged = (profile: Profile) =>
      profile.authentication !== normalized.authentication ||
      profile.keyPath !== normalized.keyPath;
    const check = (profile: Profile) => {
      if (
        isBusy(id) &&
        (identityChanged(profile) || authenticationChanged(profile))
      )
        throw new Error("PROFILE_BUSY");
    };
    check(old);
    let result!: Profile;
    await this.store.update((state) => {
      if (!state) throw new Error("STORAGE_FAILED");
      const current = state.profiles.find((profile) => profile.id === id);
      if (!current) throw new Error("PROFILE_NOT_FOUND");
      check(current);
      if (identityChanged(current)) {
        if (state.profiles.length >= 10) throw new Error("PROFILE_LIMIT");
        const { secretId: _secret, ...cloned } = normalized;
        result = { ...cloned, id: randomUUID() };
        return { ...state, profiles: [...state.profiles, result] };
      }
      const authChanged = authenticationChanged(current);
      result = { ...normalized, id };
      if (!authChanged && current.secretId && result.secretId === undefined)
        result.secretId = current.secretId;
      return {
        ...state,
        profiles: state.profiles.map((p) => (p.id === id ? result : p)),
        encryptedSecrets: authChanged
          ? state.encryptedSecrets.filter((secret) => secret.profileId !== id)
          : state.encryptedSecrets,
      };
    });
    return structuredClone(result);
  }
  async remove(id: string, isBusy: (id: string) => boolean): Promise<void> {
    if (isBusy(id)) throw new Error("PROFILE_BUSY");
    await this.store.update((state) => {
      if (!state) throw new Error("STORAGE_FAILED");
      if (isBusy(id)) throw new Error("PROFILE_BUSY");
      return {
        ...state,
        profiles: state.profiles.filter((p) => p.id !== id),
        encryptedSecrets: state.encryptedSecrets.filter(
          (secret) => secret.profileId !== id,
        ),
      };
    });
  }
  async trust(
    endpoint: string,
    publicKey: Buffer,
    fingerprint: string,
  ): Promise<void> {
    await this.store.update((state) => {
      if (!state) throw new Error("STORAGE_FAILED");
      const record = {
        endpoint,
        publicKey: publicKey.toString("base64"),
        fingerprint,
        trusted: true,
        approvedAt: new Date().toISOString(),
      };
      return {
        ...state,
        hostTrust: [
          ...state.hostTrust.filter((t) => t.endpoint !== endpoint),
          record,
        ],
      };
    });
  }
  async removeTrust(endpoint: string, allDisconnected: boolean): Promise<void> {
    if (!allDisconnected) throw new Error("PROFILE_BUSY");
    await this.store.update((state) => {
      if (!state) throw new Error("STORAGE_FAILED");
      return {
        ...state,
        hostTrust: state.hostTrust.filter((t) => t.endpoint !== endpoint),
      };
    });
  }
}
