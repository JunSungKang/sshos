import type { Algorithms } from 'ssh2';

/** Exact v6 allowlist; do not inherit ssh2's SHA-1-compatible defaults. */
export const algorithms: Algorithms = {
  kex: ['curve25519-sha256', 'curve25519-sha256@libssh.org', 'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521', 'diffie-hellman-group16-sha512'],
  serverHostKey: ['ssh-ed25519', 'rsa-sha2-512', 'rsa-sha2-256', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'],
  cipher: ['aes256-gcm@openssh.com', 'aes128-gcm@openssh.com', 'aes256-ctr', 'aes128-ctr'],
  hmac: ['hmac-sha2-512-etm@openssh.com', 'hmac-sha2-256-etm@openssh.com', 'hmac-sha2-512', 'hmac-sha2-256'],
  compress: ['none']
};
