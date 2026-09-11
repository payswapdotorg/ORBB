-- M2-D Lane A — db-backed upload store (additive only, expand/contract).

-- 1. upload_sessions: the pre-publication metadata record for one §6
-- raw-object upload (create-before-publication semantics; the session
-- carries its EvidenceId from creation, which is what makes double
-- finalize naturally idempotent). Mirrors @orbb/databox's frozen
-- UploadSessionRecord interface field-for-field.
-- 2. evidence_objects gains the M2-C upload-plane columns recorded as a
-- handoff in the M2-A contracts: session_id (nullable — legacy rows
-- and non-upload ingestion paths have none; UNIQUE when present, so a
-- session maps to at most one finalized EvidenceObject) and
-- encrypted_metadata (nullable jsonb — the envelope-encrypted
-- sensitive metadata: algorithm/wrappedKey/iv/tag are base64-encoded,
-- context binds the envelope to person + key-space + evidence id).
CREATE TABLE "upload_sessions" (
"session_id" text PRIMARY KEY NOT NULL,
"evidence_id" text NOT NULL,
"person_id" text NOT NULL,
"object_key" text NOT NULL,
"media_type" text NOT NULL,
"declared_sha256" text NOT NULL,
"declared_size_bytes" bigint NOT NULL,
"purpose" text NOT NULL,
"scope" text[] NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"expires_at" timestamp with time zone NOT NULL,
"state" text NOT NULL,
"finalized_at" timestamp with time zone,
CONSTRAINT "uq_upload_sessions_evidence" UNIQUE("evidence_id"),
CONSTRAINT "upload_sessions_session_id_grammar" CHECK ("upload_sessions"."session_id" ~ '^usess_[A-Za-z0-9_-]{16,128}$'),
CONSTRAINT "upload_sessions_evidence_id_grammar" CHECK ("upload_sessions"."evidence_id" ~ '^evid_[A-Za-z0-9_-]{16,128}$'),
CONSTRAINT "upload_sessions_person_id_grammar" CHECK ("upload_sessions"."person_id" ~ '^prsn_[A-Za-z0-9_-]{16,128}$'),
CONSTRAINT "upload_sessions_state_vocabulary" CHECK ("upload_sessions"."state" in ('open', 'finalized')),
CONSTRAINT "upload_sessions_declared_sha256_hex" CHECK ("upload_sessions"."declared_sha256" ~ '^[0-9a-f]{64}$'),
CONSTRAINT "upload_sessions_declared_size_nonnegative" CHECK ("upload_sessions"."declared_size_bytes" >= 0),
CONSTRAINT "upload_sessions_object_key_nonempty" CHECK ("upload_sessions"."object_key" <> ''),
CONSTRAINT "upload_sessions_media_type_nonempty" CHECK ("upload_sessions"."media_type" <> ''),
CONSTRAINT "upload_sessions_purpose_nonempty" CHECK ("upload_sessions"."purpose" <> ''),
CONSTRAINT "upload_sessions_scope_nonempty" CHECK (array_length("upload_sessions"."scope", 1) > 0),
CONSTRAINT "upload_sessions_finalized_at_present" CHECK ("upload_sessions"."state" <> 'finalized' OR "upload_sessions"."finalized_at" IS NOT NULL),
CONSTRAINT "upload_sessions_person_fk" FOREIGN KEY ("person_id") REFERENCES "persons"("id")
);
--> statement-breakpoint
CREATE INDEX "idx_upload_sessions_person_created" ON "upload_sessions" USING btree ("person_id","created_at","session_id");--> statement-breakpoint
CREATE INDEX "idx_upload_sessions_state_expires" ON "upload_sessions" USING btree ("state","expires_at");--> statement-breakpoint
ALTER TABLE "evidence_objects" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "evidence_objects" ADD COLUMN "encrypted_metadata" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_evidence_objects_session" ON "evidence_objects" USING btree ("session_id") WHERE "evidence_objects"."session_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_objects" ADD CONSTRAINT "evidence_objects_session_id_grammar" CHECK ("evidence_objects"."session_id" IS NULL OR "evidence_objects"."session_id" ~ '^usess_[A-Za-z0-9_-]{16,128}$');--> statement-breakpoint
ALTER TABLE "evidence_objects" ADD CONSTRAINT "evidence_objects_encrypted_metadata_shape" CHECK ("evidence_objects"."encrypted_metadata" IS NULL OR (jsonb_typeof("evidence_objects"."encrypted_metadata") = 'object' AND ("evidence_objects"."encrypted_metadata" ? 'algorithm') AND ("evidence_objects"."encrypted_metadata" ? 'ciphertext') AND ("evidence_objects"."encrypted_metadata" ? 'wrappedKey') AND ("evidence_objects"."encrypted_metadata" ? 'iv') AND ("evidence_objects"."encrypted_metadata" ? 'tag') AND ("evidence_objects"."encrypted_metadata" ? 'context')));

