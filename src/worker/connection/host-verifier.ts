import { createHash, timingSafeEqual } from 'node:crypto';

export interface ObservedHostKey { publicKey: Buffer; fingerprint: string }

/** Per-socket verification. A newly observed key never authenticates that socket. */
export class HostKeyVerifier {
  private readonly trusted: Buffer | null;
  private observed: Buffer | null = null;

  constructor(trustedPublicKey: Buffer | null) {
    this.trusted = trustedPublicKey === null ? null : Buffer.from(trustedPublicKey);
  }

  readonly verify = (presented: Buffer): boolean => {
    if (!Buffer.isBuffer(presented) || presented.length === 0) return false;
    if (this.observed === null) this.observed = Buffer.from(presented);
    return this.trusted !== null && this.trusted.length === presented.length && timingSafeEqual(this.trusted, presented);
  };

  observation(): ObservedHostKey | null {
    if (this.observed === null) return null;
    return {
      publicKey: Buffer.from(this.observed),
      fingerprint: `SHA256:${createHash('sha256').update(this.observed).digest('base64').replace(/=+$/, '')}`
    };
  }
}
