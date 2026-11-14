/** Injectable OS interface; tests never create or modify a system Keychain. */
export interface OSCrypt {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}
export class SecretVault {
  constructor(private readonly crypt: OSCrypt) {}
  async encrypt(value: string): Promise<string> {
    try {
      if (!await this.crypt.isAsyncEncryptionAvailable()) throw new Error('Unavailable');
      return (await this.crypt.encryptStringAsync(value)).toString('base64');
    } catch { throw new Error('SECRET_UNAVAILABLE'); }
  }
  async decrypt(ciphertext: string, persistReplacement: (value: string) => Promise<void>): Promise<string> {
    let decrypted: { result: string; shouldReEncrypt: boolean };
    try {
      if (!await this.crypt.isAsyncEncryptionAvailable()) throw new Error('Unavailable');
      const bytes = Buffer.from(ciphertext, 'base64');
      if (bytes.length === 0 || bytes.toString('base64') !== ciphertext) throw new Error('Invalid ciphertext');
      decrypted = await this.crypt.decryptStringAsync(bytes);
      if (typeof decrypted.result !== 'string' || typeof decrypted.shouldReEncrypt !== 'boolean') throw new Error('Invalid result');
    } catch { throw new Error('SECRET_UNAVAILABLE'); }
    if (decrypted.shouldReEncrypt) {
      const replacement = await this.encrypt(decrypted.result);
      try { await persistReplacement(replacement); } catch { throw new Error('STORAGE_FAILED'); }
    }
    return decrypted.result;
  }
}
