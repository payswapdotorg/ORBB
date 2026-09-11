import { describe, expect, it } from "vitest";
import { EnvelopeCryptoError } from "../errors.js";
import { EnvelopeEncryptor, type EncryptedEnvelope } from "./envelope.js";
import { SecretKeyProvider } from "./keyprovider.js";

const SECRET = "synthetic-dev-secret-CCCC-0003";
const OTHER_SECRET = "synthetic-dev-secret-DDDD-0004";

const PLAINTEXT = new Uint8Array([116, 101, 115, 116, 32, 112, 97, 121, 108, 111, 97, 100]); // "test payload"

const CONTEXT = { personId: "prsn_TESTpersonid00001", keySpace: "orbb/databox/evidence-metadata" } as const;

function tamper(bytes: Uint8Array, index: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  copy[index] = copy[index]! ^ 0xff;
  return copy;
}

describe("EnvelopeEncryptor round-trips", () => {
  it("encrypt -> decrypt returns the original plaintext under the same context", async () => {
    const encryptor = new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET }));
    const envelope = await encryptor.encrypt(PLAINTEXT, CONTEXT);
    const decrypted = await encryptor.decrypt(envelope, CONTEXT);
    expect([...decrypted]).toEqual([...PLAINTEXT]);
  });

  it("round-trips the empty payload", async () => {
    const encryptor = new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET }));
    const envelope = await encryptor.encrypt(new Uint8Array(0), CONTEXT);
    const decrypted = await encryptor.decrypt(envelope, CONTEXT);
    expect(decrypted.byteLength).toBe(0);
  });

  it("round-trips through a SECOND provider instance built from the same secret", async () => {
    const encrypting = new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET }));
    const decrypting = new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET }));
    const envelope = await encrypting.encrypt(PLAINTEXT, CONTEXT);
    const decrypted = await decrypting.decrypt(envelope, CONTEXT);
    expect([...decrypted]).toEqual([...PLAINTEXT]);
  });

  it("produces the packet-A19 envelope shape", async () => {
    const encryptor = new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET }));
    const envelope = await encryptor.encrypt(PLAINTEXT, CONTEXT);
    expect(envelope.algorithm).toBe("AES-256-GCM");
    expect(envelope.ciphertext).toBeInstanceOf(Uint8Array);
    expect(envelope.wrappedKey.algorithm).toBe("AES-256-GCM");
    expect(envelope.wrappedKey.iv.byteLength).toBe(12);
    expect(envelope.wrappedKey.tag.byteLength).toBe(16);
    expect(envelope.iv).toBeInstanceOf(Uint8Array);
    expect(envelope.iv.byteLength).toBe(12);
    expect(envelope.tag).toBeInstanceOf(Uint8Array);
    expect(envelope.tag.byteLength).toBe(16);
    expect(envelope.context).toEqual({ ...CONTEXT });
  });

  it("is semantically secure: same plaintext+context encrypts to different ciphertexts", async () => {
    const encryptor = new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET }));
    const first = await encryptor.encrypt(PLAINTEXT, CONTEXT);
    const second = await encryptor.encrypt(PLAINTEXT, CONTEXT);
    expect([...first.ciphertext]).not.toEqual([...second.ciphertext]);
    expect([...first.iv]).not.toEqual([...second.iv]);
    expect([...first.wrappedKey.ciphertext]).not.toEqual([...second.wrappedKey.ciphertext]);
    expect([...(await encryptor.decrypt(first, CONTEXT))]).toEqual([...PLAINTEXT]);
    expect([...(await encryptor.decrypt(second, CONTEXT))]).toEqual([...PLAINTEXT]);
  });
});

describe("EnvelopeEncryptor context binding", () => {
  it("decrypting under a DIFFERENT context is an authentication failure (context-mismatch)", async () => {
    const encryptor = new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET }));
    const envelope = await encryptor.encrypt(PLAINTEXT, CONTEXT);
    const wrongContext = { ...CONTEXT, personId: "prsn_OTHERpersonid009" };
    await expect(encryptor.decrypt(envelope, wrongContext)).rejects.toThrowError(
      expect.objectContaining({ code: "context-mismatch" }),
    );
  });

  it("an added context key also fails (strict structural equality)", async () => {
    const encryptor = new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET }));
    const envelope = await encryptor.encrypt(PLAINTEXT, CONTEXT);
    await expect(
      encryptor.decrypt(envelope, { ...CONTEXT, extra: "value" }),
    ).rejects.toThrowError(expect.objectContaining({ code: "context-mismatch" }));
  });

  it("context key ORDER is irrelevant (canonicalization)", async () => {
    const encryptor = new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET }));
    const envelope = await encryptor.encrypt(PLAINTEXT, CONTEXT);
    const reordered = {
      keySpace: CONTEXT.keySpace,
      personId: CONTEXT.personId,
    };
    const decrypted = await encryptor.decrypt(envelope, reordered);
    expect([...decrypted]).toEqual([...PLAINTEXT]);
  });

  it("rejects empty or malformed contexts on both encrypt and decrypt", async () => {
    const encryptor = new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET }));
    await expect(encryptor.encrypt(PLAINTEXT, {})).rejects.toThrowError(
      expect.objectContaining({ code: "invalid-context" }),
    );
    await expect(encryptor.encrypt(PLAINTEXT, { personId: "" })).rejects.toThrowError(
      expect.objectContaining({ code: "invalid-context" }),
    );
    const envelope = await encryptor.encrypt(PLAINTEXT, CONTEXT);
    await expect(encryptor.decrypt(envelope, {})).rejects.toThrowError(
      expect.objectContaining({ code: "invalid-context" }),
    );
  });
});

describe("EnvelopeEncryptor tamper detection", () => {
  it("a flipped ciphertext byte fails with integrity-failure", async () => {
    const encryptor = new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET }));
    const envelope = await encryptor.encrypt(PLAINTEXT, CONTEXT);
    const tampered: EncryptedEnvelope = {
      ...envelope,
      ciphertext: tamper(envelope.ciphertext, 0),
    };
    await expect(encryptor.decrypt(tampered, CONTEXT)).rejects.toThrowError(
      expect.objectContaining({ code: "integrity-failure" }),
    );
  });

  it("a flipped tag byte fails with integrity-failure", async () => {
    const encryptor = new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET }));
    const envelope = await encryptor.encrypt(PLAINTEXT, CONTEXT);
    const tampered: EncryptedEnvelope = { ...envelope, tag: tamper(envelope.tag, 5) };
    await expect(encryptor.decrypt(tampered, CONTEXT)).rejects.toThrowError(
      expect.objectContaining({ code: "integrity-failure" }),
    );
  });

  it("a flipped IV byte fails with integrity-failure", async () => {
    const encryptor = new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET }));
    const envelope = await encryptor.encrypt(PLAINTEXT, CONTEXT);
    const tampered: EncryptedEnvelope = { ...envelope, iv: tamper(envelope.iv, 1) };
    await expect(encryptor.decrypt(tampered, CONTEXT)).rejects.toThrowError(
      expect.objectContaining({ code: "integrity-failure" }),
    );
  });

  it("a tampered wrapped key fails with key-unwrap-failure", async () => {
    const encryptor = new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET }));
    const envelope = await encryptor.encrypt(PLAINTEXT, CONTEXT);
    const tampered: EncryptedEnvelope = {
      ...envelope,
      wrappedKey: {
        ...envelope.wrappedKey,
        ciphertext: tamper(envelope.wrappedKey.ciphertext, 2),
      },
    };
    await expect(encryptor.decrypt(tampered, CONTEXT)).rejects.toThrowError(
      expect.objectContaining({ code: "key-unwrap-failure" }),
    );
  });

  it("an envelope from a different provider secret cannot be decrypted", async () => {
    const foreign = new EnvelopeEncryptor(new SecretKeyProvider({ secret: OTHER_SECRET }));
    const local = new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET }));
    const foreignEnvelope = await foreign.encrypt(PLAINTEXT, CONTEXT);
    await expect(local.decrypt(foreignEnvelope, CONTEXT)).rejects.toThrowError(
      EnvelopeCryptoError,
    );
  });

  it("a tampered EMBEDDED context is caught (embedded context must match AAD)", async () => {
    const encryptor = new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET }));
    const envelope = await encryptor.encrypt(PLAINTEXT, CONTEXT);
    // Attacker swaps the embedded context to the value they will present...
    const swapped: EncryptedEnvelope = {
      ...envelope,
      context: { ...CONTEXT, personId: "prsn_ATTACKERpersonid1" },
    };
    // ...but the GCM AAD still binds the ORIGINAL context, so the presented
    // context (matching the swapped embedding) fails the AAD check.
    const presented = { ...CONTEXT, personId: "prsn_ATTACKERpersonid1" };
    await expect(encryptor.decrypt(swapped, presented)).rejects.toThrowError(
      expect.objectContaining({ code: "integrity-failure" }),
    );
  });

  it("malformed envelopes (bad lengths, wrong algorithm) fail with malformed-envelope", async () => {
    const encryptor = new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET }));
    const envelope = await encryptor.encrypt(PLAINTEXT, CONTEXT);
    const badIv: EncryptedEnvelope = { ...envelope, iv: new Uint8Array(3) };
    await expect(encryptor.decrypt(badIv, CONTEXT)).rejects.toThrowError(
      expect.objectContaining({ code: "malformed-envelope" }),
    );
    const badTag: EncryptedEnvelope = { ...envelope, tag: new Uint8Array(4) };
    await expect(encryptor.decrypt(badTag, CONTEXT)).rejects.toThrowError(
      expect.objectContaining({ code: "malformed-envelope" }),
    );
    const badAlgorithm = { ...envelope, algorithm: "AES-128-GCM" } as unknown as EncryptedEnvelope;
    await expect(encryptor.decrypt(badAlgorithm, CONTEXT)).rejects.toThrowError(
      expect.objectContaining({ code: "malformed-envelope" }),
    );
  });
});
