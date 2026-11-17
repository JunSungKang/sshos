import {
  BaseAgent,
  utils,
  type ParsedKey,
  type IdentityCallback,
  type SignCallback,
  type SigningRequestOptions,
} from "ssh2";
import {
  constants,
  createPublicKey,
  sign,
  timingSafeEqual,
  type KeyObject,
} from "node:crypto";

/** An in-process signer, with no agent socket or forwarding support. */
export class SingleKeyAgent extends BaseAgent<ParsedKey> {
  private privateKey: KeyObject | null;
  private readonly identity: ParsedKey;
  private readonly publicBlob: Buffer;

  constructor(privateKey: KeyObject, publicSSH: string) {
    super();
    const identity = utils.parseKey(publicSSH);
    if (
      identity instanceof Error ||
      Array.isArray(identity) ||
      identity.isPrivateKey()
    )
      throw new Error("KEY_INVALID");
    const type = privateKey.asymmetricKeyType;
    if (privateKey.type !== "private" || (type !== "rsa" && type !== "ed25519"))
      throw new Error("KEY_INVALID");
    if (
      type === "rsa" &&
      (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    )
      throw new Error("KEY_INVALID");
    if (
      (type === "rsa" && identity.type !== "ssh-rsa") ||
      (type === "ed25519" && identity.type !== "ssh-ed25519")
    )
      throw new Error("KEY_INVALID");
    const actual = createPublicKey(privateKey).export({
      type: "spki",
      format: "der",
    });
    const advertised = createPublicKey(identity.getPublicPEM()).export({
      type: "spki",
      format: "der",
    });
    if (
      actual.length !== advertised.length ||
      !timingSafeEqual(actual, advertised)
    )
      throw new Error("KEY_INVALID");
    this.privateKey = privateKey;
    this.identity = identity;
    this.publicBlob = Buffer.from(identity.getPublicSSH());
  }

  getIdentities(callback: IdentityCallback<ParsedKey>): void {
    if (this.privateKey === null) {
      callback(new Error("KEY_UNAVAILABLE"));
      return;
    }
    // Reparse a public-only identity so callers cannot mutate our selected key.
    const identity = utils.parseKey(
      `${this.identity.type} ${this.publicBlob.toString("base64")}`,
    );
    if (identity instanceof Error || Array.isArray(identity)) {
      callback(new Error("KEY_INVALID"));
      return;
    }
    callback(null, [identity]);
  }

  sign(
    pubKey: ParsedKey,
    data: Buffer,
    options: SigningRequestOptions,
    callback?: SignCallback,
  ): void;
  sign(pubKey: ParsedKey, data: Buffer, callback: SignCallback): void;
  sign(
    pubKey: ParsedKey,
    data: Buffer,
    optionsOrCallback: SigningRequestOptions | SignCallback,
    callback?: SignCallback,
  ): void {
    const supplied =
      typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    if (!supplied) return;
    let called = false;
    const done: SignCallback = (error, signature) => {
      if (!called) {
        called = true;
        supplied(error, signature);
      }
    };
    const options =
      typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
    try {
      const key = this.privateKey;
      const requested = pubKey.getPublicSSH();
      if (
        key === null ||
        !Buffer.isBuffer(data) ||
        requested.length !== this.publicBlob.length ||
        !timingSafeEqual(requested, this.publicBlob)
      ) {
        done(new Error("SIGNING_DENIED"));
        return;
      }
      if (key.asymmetricKeyType === "rsa") {
        if (options.hash !== "sha256" && options.hash !== "sha512") {
          done(new Error("SIGNING_DENIED"));
          return;
        }
        sign(
          options.hash,
          data,
          { key, padding: constants.RSA_PKCS1_PADDING },
          (error, signature) => {
            if (this.privateKey !== key) {
              done(new Error("KEY_UNAVAILABLE"));
              return;
            }
            done(error, signature);
          },
        );
      } else {
        if (options.hash !== undefined) {
          done(new Error("SIGNING_DENIED"));
          return;
        }
        sign(null, data, key, (error, signature) => {
          if (this.privateKey !== key) {
            done(new Error("KEY_UNAVAILABLE"));
            return;
          }
          done(error, signature);
        });
      }
    } catch {
      done(new Error("SIGNING_DENIED"));
    }
  }

  dispose(): void {
    this.privateKey = null;
  }
}
