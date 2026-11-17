import { errorCodeOf } from "../../shared/errors";
import type { AuxiliaryLease } from "../connections/auxiliary-sockets";
import { TransferIOFailure } from "./runner";
import {
  transferFailure,
  type MutationACK,
} from "../../shared/file-policies/transfer-failure";
export {
  transferFailure,
  type MutationACK,
} from "../../shared/file-policies/transfer-failure";
/** Abort one transfer socket, retain native operations until their actual settlement. */
export class TransferScope {
  private lease: AuxiliaryLease | null = null;
  private reason: Error | null = null;
  private readonly cancellations = new Set<(error: Error) => void>();
  private readonly nativePending = new Set<Promise<unknown>>();
  private readonly onAbort: () => void;
  constructor(
    private readonly signal: AbortSignal,
    private readonly checkControl: () => void,
    private readonly late: (stage: MutationACK) => void,
  ) {
    this.onAbort = () =>
      this.stop(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("CONNECTION_LOST"),
      );
    signal.addEventListener("abort", this.onAbort, { once: true });
    if (signal.aborted) this.onAbort();
  }
  check(): void {
    if (this.reason) throw this.reason;
    if (this.signal.aborted) throw this.signal.reason;
    this.checkControl();
  }
  attach(lease: AuxiliaryLease): void {
    if (this.lease) throw new Error("INPUT_INVALID");
    this.lease = lease;
    if (this.reason) lease.close();
    void lease.closed.then(() => this.stop(new Error("CONNECTION_LOST")));
  }
  stop(error: Error): void {
    if (!this.reason) this.reason = error;
    this.lease?.close();
    for (const cancel of [...this.cancellations]) cancel(this.reason);
  }
  private watch<T>(
    start: (done: (error: unknown, value?: T) => void) => void,
    mutation: MutationACK | null,
    timeout: number | null,
    native: boolean,
  ): Promise<T> {
    try {
      this.check();
    } catch (error) {
      return Promise.reject(transferFailure(error));
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false,
        cancelled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (error: TransferIOFailure | null, value?: T) => {
        if (settled) return;
        settled = true;
        this.cancellations.delete(cancel);
        if (timer) clearTimeout(timer);
        if (error) reject(error);
        else resolve(value as T);
      };
      const cancel = (error: Error) => {
        cancelled = true;
        finish(
          new TransferIOFailure(
            errorCodeOf(error) === "INTERNAL_ERROR"
              ? "CONNECTION_LOST"
              : errorCodeOf(error),
            mutation !== null,
          ),
        );
      };
      this.cancellations.add(cancel);
      if (timeout !== null)
        timer = setTimeout(() => this.stop(new Error("IO_TIMEOUT")), timeout);
      const done = (error: unknown, value?: T) => {
        if (settled) {
          if (!error && cancelled && mutation) this.late(mutation);
          return;
        }
        try {
          this.check();
        } catch (failure) {
          cancel(
            failure instanceof Error ? failure : new Error("CONNECTION_LOST"),
          );
          if (!error && mutation) this.late(mutation);
          return;
        }
        finish(error ? transferFailure(error, mutation, native) : null, value);
      };
      try {
        start(done);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Server does not support this extended request"
        )
          finish(new TransferIOFailure("HARDLINK_UNSUPPORTED"));
        else finish(transferFailure(error, mutation, native));
      }
    });
  }
  remote<T>(
    start: (done: (error: Error | undefined | null, value: T) => void) => void,
    mutation: MutationACK | null = null,
    timeout: number | null = 15000,
  ): Promise<T> {
    return this.watch<T>(
      (done) => start((error, value) => done(error, value)),
      mutation,
      timeout,
      false,
    );
  }
  wait<T>(promise: Promise<T>): Promise<T> {
    return this.watch<T>(
      (done) => {
        void promise.then(
          (value) => done(null, value),
          (error) => done(error),
        );
      },
      null,
      null,
      false,
    );
  }
  native<T>(
    action: () => Promise<T>,
    mutation: MutationACK | null = null,
  ): Promise<T> {
    return this.watch<T>(
      (done) => {
        const promise = action();
        this.nativePending.add(promise);
        void promise.then(
          (value) => {
            this.nativePending.delete(promise);
            done(null, value);
          },
          (error) => {
            this.nativePending.delete(promise);
            done(error);
          },
        );
      },
      mutation,
      null,
      true,
    );
  }
  async shutdown(): Promise<void> {
    this.signal.removeEventListener("abort", this.onAbort);
    this.stop(new Error("CONNECTION_LOST"));
    if (this.lease) await this.lease.closed;
    while (this.nativePending.size)
      await Promise.allSettled([...this.nativePending]);
  }
}
