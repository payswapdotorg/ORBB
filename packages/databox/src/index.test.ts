import { describe, expect, it } from "vitest";
import * as databox from "./index.js";

describe("@orbb/databox public surface (M2-C)", () => {
  it("exports the object-plane, crypto, and upload-flow modules", () => {
    // A16 — R2 adapter + SigV4.
    expect(databox.R2ObjectStore).toBeTypeOf("function");
    expect(databox.uriEncode).toBeTypeOf("function");
    expect(databox.deriveSigningKey).toBeTypeOf("function");

    // A19 — envelope encryption.
    expect(databox.SecretKeyProvider).toBeTypeOf("function");
    expect(databox.EnvelopeEncryptor).toBeTypeOf("function");

    // A17 — upload-session orchestration.
    expect(databox.UploadSessionService).toBeTypeOf("function");

    // In-memory reference implementations.
    expect(databox.InMemoryObjectStore).toBeTypeOf("function");
    expect(databox.InMemoryEvidenceMetadataStore).toBeTypeOf("function");
    expect(databox.InMemoryEventSink).toBeTypeOf("function");
    expect(databox.InMemoryTaskSink).toBeTypeOf("function");
    expect(databox.StaticUploadAuthorizationGuard).toBeTypeOf("function");
    expect(databox.SyntheticUploadPresigner).toBeTypeOf("function");

    // Pure helpers + errors.
    expect(databox.contentAddressedKey).toBeTypeOf("function");
    expect(databox.sha256Checksum).toBeTypeOf("function");
    expect(databox.UploadFlowError).toBeTypeOf("function");
    expect(databox.EnvelopeCryptoError).toBeTypeOf("function");
    expect(databox.ObjectStoreError).toBeTypeOf("function");
  });
});
