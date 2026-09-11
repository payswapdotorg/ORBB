/**
 * A18 tests — evidence checksum/metadata validation (pure functions).
 *
 * Uses only synthetic data (SYNTH markers / TEST ids following the M2-C
 * test convention in this package). Every mismatch family is covered,
 * plus the sha256-verification-of-bytes path with the real node:crypto
 * primitive and an injected deterministic verifier.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { parsePersonId, parseEvidenceId } from "@orbb/domain";
import { parseUploadSessionId } from "./upload/contracts.js";
import type { EncryptedEnvelope } from "./crypto/envelope.js";
import { UploadFlowError } from "./errors.js";
import { contentAddressedKey } from "./objectkeys.js";
import { sha256Checksum } from "./checksum.js";
import {
  verifyEvidenceMediaType,
  verifyEvidenceMetadata,
  verifyEvidenceSha256,
  verifyEvidenceSize,
  type DeclaredEvidenceMetadata,
} from "./verify.js";
import type { EvidenceObjectRecord } from "./upload/contracts.js";

const PERSON_ID = parsePersonId("prsn_TESTpersonid00001");
const EVIDENCE_ID = parseEvidenceId("evid_TESTobjectid000001");
const SESSION_ID = parseUploadSessionId("usess_TESTsessionid001");

const SYNTH_BYTES = new Uint8Array([1, 2, 3]);
const SYNTH_SHA256 = createHash("sha256").update(SYNTH_BYTES).digest("hex");
const SYNTH_MEDIA_TYPE = "image/jpeg";

function fakeEnvelope(): EncryptedEnvelope {
  return {
    algorithm: "AES-256-GCM",
    ciphertext: new Uint8Array([1, 2, 3]),
    wrappedKey: {
      algorithm: "AES-256-GCM",
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(32),
      tag: new Uint8Array(16),
    },
    iv: new Uint8Array(12),
    tag: new Uint8Array(16),
    context: { keySpace: "test" },
  };
}

function record(overrides?: Partial<EvidenceObjectRecord>): EvidenceObjectRecord {
  return {
    id: EVIDENCE_ID,
    personId: PERSON_ID,
    objectKey: contentAddressedKey(EVIDENCE_ID, SYNTH_SHA256),
    mediaType: SYNTH_MEDIA_TYPE,
    sha256: SYNTH_SHA256,
    sizeBytes: SYNTH_BYTES.byteLength,
    retentionClass: "original",
    state: "active",
    createdAt: new Date(2_000),
    sessionId: SESSION_ID,
    encryptedMetadata: fakeEnvelope(),
    ...overrides,
  };
}

function declared(overrides?: Partial<DeclaredEvidenceMetadata>): DeclaredEvidenceMetadata {
  return {
    sha256: SYNTH_SHA256,
    sizeBytes: SYNTH_BYTES.byteLength,
    mediaType: SYNTH_MEDIA_TYPE,
    ...overrides,
  };
}

function expectUploadFlowError(
  code: string,
  action: () => void,
): void {
  expect(action).toThrowError(UploadFlowError);
  try {
    action();
  } catch (error) {
    expect((error as UploadFlowError).code).toBe(code);
  }
}

describe("verifyEvidenceSha256 (bytes vs declared digest)", () => {
  it("verifies matching bytes and returns the computed digest", () => {
    const computed = verifyEvidenceSha256(SYNTH_BYTES, SYNTH_SHA256);
    expect(computed).toBe(SYNTH_SHA256);
    expect(computed).toBe(sha256Checksum(SYNTH_BYTES));
  });

  it("rejects mismatched bytes with checksum-mismatch", () => {
    expectUploadFlowError("checksum-mismatch", () =>
      verifyEvidenceSha256(new Uint8Array([9, 9, 9]), SYNTH_SHA256),
    );
  });

  it("rejects a malformed declared digest with invalid-request (uppercase hex is rejected, not normalized)", () => {
    expectUploadFlowError("invalid-request", () =>
      verifyEvidenceSha256(SYNTH_BYTES, SYNTH_SHA256.toUpperCase()),
    );
    expectUploadFlowError("invalid-request", () => verifyEvidenceSha256(SYNTH_BYTES, "abc"));
  });

  it("honors an injected deterministic verifier (pure seam)", () => {
    const digest = "a".repeat(64);
    const computed = verifyEvidenceSha256(SYNTH_BYTES, digest, () => digest);
    expect(computed).toBe(digest);
  });
});

describe("verifyEvidenceSize", () => {
  it("accepts equal sizes", () => {
    expect(() => verifyEvidenceSize(3, 3)).not.toThrow();
  });

  it("rejects any difference with size-mismatch (no tolerance)", () => {
    expectUploadFlowError("size-mismatch", () => verifyEvidenceSize(3, 4));
    expectUploadFlowError("size-mismatch", () => verifyEvidenceSize(0, 3));
  });

  it("rejects malformed sizes with invalid-request", () => {
    expectUploadFlowError("invalid-request", () => verifyEvidenceSize(3, -1));
    expectUploadFlowError("invalid-request", () => verifyEvidenceSize(-1, 3));
    expectUploadFlowError("invalid-request", () => verifyEvidenceSize(3, 1.5));
  });
});

describe("verifyEvidenceMediaType", () => {
  it("accepts equal media types", () => {
    expect(() => verifyEvidenceMediaType("image/jpeg", "image/jpeg")).not.toThrow();
  });

  it("rejects any difference with media-type-mismatch (strict equality — no case folding)", () => {
    expectUploadFlowError("media-type-mismatch", () =>
      verifyEvidenceMediaType("Image/JPEG", "image/jpeg"),
    );
    expectUploadFlowError("media-type-mismatch", () =>
      verifyEvidenceMediaType("image/png", "image/jpeg"),
    );
  });

  it("rejects malformed media types with invalid-request", () => {
    expectUploadFlowError("invalid-request", () => verifyEvidenceMediaType("image/jpeg", ""));
    expectUploadFlowError("invalid-request", () => verifyEvidenceMediaType("", "image/jpeg"));
  });
});

describe("verifyEvidenceMetadata (stored record vs declared metadata)", () => {
  it("passes silently when record and declared metadata agree", () => {
    expect(() => verifyEvidenceMetadata(record(), declared())).not.toThrow();
  });

  it("throws checksum-mismatch when the stored digest differs from the declared one", () => {
    const different = createHash("sha256").update(new Uint8Array([7, 7, 7])).digest("hex");
    expectUploadFlowError("checksum-mismatch", () =>
      verifyEvidenceMetadata(record(), declared({ sha256: different })),
    );
  });

  it("throws size-mismatch when the stored size differs from the declared one", () => {
    expectUploadFlowError("size-mismatch", () =>
      verifyEvidenceMetadata(record(), declared({ sizeBytes: 4 })),
    );
  });

  it("throws media-type-mismatch when the stored media type differs", () => {
    expectUploadFlowError("media-type-mismatch", () =>
      verifyEvidenceMetadata(record(), declared({ mediaType: "image/png" })),
    );
  });

  it("throws object-key-mismatch when the key is not the canonical content-addressed key", () => {
    expectUploadFlowError("object-key-mismatch", () =>
      verifyEvidenceMetadata(
        record({ objectKey: `evidence/v1/${EVIDENCE_ID}/${"0".repeat(64)}` }),
        declared(),
      ),
    );
  });

  it("validates the record shape first (canonical evid_ id, person id)", () => {
    expectUploadFlowError("invalid-request", () =>
      verifyEvidenceMetadata(record({ id: "not-an-evid-id" as never }), declared()),
    );
    expectUploadFlowError("invalid-request", () =>
      verifyEvidenceMetadata(record({ personId: "" as never }), declared()),
    );
    expectUploadFlowError("invalid-request", () =>
      verifyEvidenceMetadata({} as never, declared()),
    );
  });

  it("validates the declared shape first (digest grammar, integer size, media type)", () => {
    expectUploadFlowError("invalid-request", () =>
      verifyEvidenceMetadata(record(), declared({ sha256: "NOT_HEX" })),
    );
    expectUploadFlowError("invalid-request", () =>
      verifyEvidenceMetadata(record(), declared({ sizeBytes: -2 })),
    );
    expectUploadFlowError("invalid-request", () =>
      verifyEvidenceMetadata(record(), declared({ mediaType: "" })),
    );
  });

  it("rejects a non-hexadecimal record digest via the declared-shape guard", () => {
    // A record whose sha256 is not lowercase-hex cannot pass the
    // declared-shape grammar check either — the guards fire before
    // any comparison (invalid-request, never a silent mismatch).
    const badDigest = "A".repeat(64);
    expectUploadFlowError("invalid-request", () =>
      verifyEvidenceMetadata(record({ sha256: badDigest }), declared({ sha256: badDigest })),
    );
  });

  it("never echoes values in error messages (PHI-safe)", () => {
    for (const [action, code] of [
      [() => verifyEvidenceMetadata(record(), declared({ sizeBytes: 999 })), "size-mismatch"],
      [() => verifyEvidenceMetadata(record(), declared({ mediaType: "image/png" })), "media-type-mismatch"],
      [() => verifyEvidenceMetadata(record(), declared({ sha256: "0".repeat(64) })), "checksum-mismatch"],
    ] as const) {
      try {
        action();
        expect.unreachable("expected a throw");
      } catch (error) {
        const uploadError = error as UploadFlowError;
        expect(uploadError.code).toBe(code);
        expect(uploadError.message).not.toContain(SYNTH_SHA256);
        expect(uploadError.message).not.toContain("image/png");
        expect(uploadError.message).not.toContain("999");
        expect(uploadError.message).not.toContain(EVIDENCE_ID);
      }
    }
  });
});
