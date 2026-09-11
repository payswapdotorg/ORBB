CREATE TABLE "access_audits" (
        "id" text PRIMARY KEY NOT NULL,
        "decision_id" text NOT NULL,
        "subject_id" text NOT NULL,
        "decision" text NOT NULL,
        "at" timestamp with time zone NOT NULL,
        "actor" text NOT NULL,
        "request_digest" text NOT NULL,
        "created_at" timestamp with time zone NOT NULL,
        CONSTRAINT "uq_access_audits_decision" UNIQUE("decision_id"),
        CONSTRAINT "access_audits_id_grammar" CHECK ("access_audits"."id" ~ '^audit_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "access_audits_subject_id_grammar" CHECK ("access_audits"."subject_id" ~ '^prsn_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "access_audits_decision_vocabulary" CHECK ("access_audits"."decision" in ('ALLOW', 'DENY')),
        CONSTRAINT "access_audits_decision_id_nonempty" CHECK ("access_audits"."decision_id" <> ''),
        CONSTRAINT "access_audits_actor_nonempty" CHECK ("access_audits"."actor" <> ''),
        CONSTRAINT "access_audits_request_digest_nonempty" CHECK ("access_audits"."request_digest" <> '')
);
--> statement-breakpoint
CREATE TABLE "access_grants" (
        "id" text PRIMARY KEY NOT NULL,
        "subject_id" text NOT NULL,
        "recipient_id" text NOT NULL,
        "purpose" text NOT NULL,
        "scope" text[] NOT NULL,
        "state" text NOT NULL,
        "expires_at" timestamp with time zone NOT NULL,
        "created_at" timestamp with time zone NOT NULL,
        CONSTRAINT "access_grants_id_grammar" CHECK ("access_grants"."id" ~ '^grant_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "access_grants_subject_id_grammar" CHECK ("access_grants"."subject_id" ~ '^prsn_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "access_grants_state_vocabulary" CHECK ("access_grants"."state" in ('active', 'revoked')),
        CONSTRAINT "access_grants_recipient_nonempty" CHECK ("access_grants"."recipient_id" <> ''),
        CONSTRAINT "access_grants_purpose_nonempty" CHECK ("access_grants"."purpose" <> ''),
        CONSTRAINT "access_grants_scope_nonempty" CHECK (array_length("access_grants"."scope", 1) > 0)
);
--> statement-breakpoint
CREATE TABLE "accounts" (
        "id" text PRIMARY KEY NOT NULL,
        "person_id" text NOT NULL,
        "created_at" timestamp with time zone NOT NULL,
        CONSTRAINT "accounts_id_grammar" CHECK ("accounts"."id" ~ '^acct_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "accounts_person_id_grammar" CHECK ("accounts"."person_id" ~ '^prsn_[A-Za-z0-9_-]{16,128}$')
);
--> statement-breakpoint
CREATE TABLE "evidence_objects" (
        "id" text PRIMARY KEY NOT NULL,
        "person_id" text NOT NULL,
        "object_key" text NOT NULL,
        "media_type" text NOT NULL,
        "sha256" text NOT NULL,
        "size_bytes" bigint NOT NULL,
        "captured_at" timestamp with time zone NOT NULL,
        "source_type" text NOT NULL,
        "provenance_id" text NOT NULL,
        "retention_class" text NOT NULL,
        "state" text NOT NULL,
        "created_at" timestamp with time zone NOT NULL,
        CONSTRAINT "uq_evidence_objects_object_key" UNIQUE("object_key"),
        CONSTRAINT "evidence_objects_id_grammar" CHECK ("evidence_objects"."id" ~ '^evid_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "evidence_objects_person_id_grammar" CHECK ("evidence_objects"."person_id" ~ '^prsn_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "evidence_objects_provenance_id_grammar" CHECK ("evidence_objects"."provenance_id" ~ '^prov_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "evidence_objects_sha256_hex" CHECK ("evidence_objects"."sha256" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "evidence_objects_size_nonnegative" CHECK ("evidence_objects"."size_bytes" >= 0),
        CONSTRAINT "evidence_objects_state_vocabulary" CHECK ("evidence_objects"."state" in ('active')),
        CONSTRAINT "evidence_objects_media_type_nonempty" CHECK ("evidence_objects"."media_type" <> ''),
        CONSTRAINT "evidence_objects_object_key_nonempty" CHECK ("evidence_objects"."object_key" <> ''),
        CONSTRAINT "evidence_objects_source_type_nonempty" CHECK ("evidence_objects"."source_type" <> ''),
        CONSTRAINT "evidence_objects_retention_class_nonempty" CHECK ("evidence_objects"."retention_class" <> '')
);
--> statement-breakpoint
CREATE TABLE "health_intents" (
        "id" text PRIMARY KEY NOT NULL,
        "person_id" text NOT NULL,
        "objective" text NOT NULL,
        "state" text NOT NULL,
        "created_at" timestamp with time zone NOT NULL,
        "evidence_pack_version" integer,
        "plan_id" text,
        CONSTRAINT "health_intents_id_grammar" CHECK ("health_intents"."id" ~ '^intent_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "health_intents_person_id_grammar" CHECK ("health_intents"."person_id" ~ '^prsn_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "health_intents_plan_id_grammar" CHECK ("health_intents"."plan_id" ~ '^plan_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "health_intents_state_vocabulary" CHECK ("health_intents"."state" in ('draft', 'active', 'paused', 'achieved', 'retired')),
        CONSTRAINT "health_intents_objective_nonempty" CHECK ("health_intents"."objective" <> ''),
        CONSTRAINT "health_intents_evidence_pack_version_positive" CHECK ("health_intents"."evidence_pack_version" is null or "health_intents"."evidence_pack_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "idempotency_ledger" (
        "table_name" text NOT NULL,
        "operation" text NOT NULL,
        "idempotency_key" text NOT NULL,
        "record_id" text NOT NULL,
        "applied_at" timestamp with time zone NOT NULL,
        CONSTRAINT "pk_idempotency_ledger" PRIMARY KEY("table_name","operation","idempotency_key"),
        CONSTRAINT "idempotency_ledger_table_nonempty" CHECK ("idempotency_ledger"."table_name" <> ''),
        CONSTRAINT "idempotency_ledger_operation_nonempty" CHECK ("idempotency_ledger"."operation" <> ''),
        CONSTRAINT "idempotency_ledger_key_nonempty" CHECK ("idempotency_ledger"."idempotency_key" <> ''),
        CONSTRAINT "idempotency_ledger_record_nonempty" CHECK ("idempotency_ledger"."record_id" <> '')
);
--> statement-breakpoint
CREATE TABLE "measurement_plans" (
        "id" text PRIMARY KEY NOT NULL,
        "person_id" text NOT NULL,
        "intent_id" text NOT NULL,
        "state" text NOT NULL,
        "metrics" text[] NOT NULL,
        "created_at" timestamp with time zone NOT NULL,
        CONSTRAINT "measurement_plans_id_grammar" CHECK ("measurement_plans"."id" ~ '^plan_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "measurement_plans_person_id_grammar" CHECK ("measurement_plans"."person_id" ~ '^prsn_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "measurement_plans_intent_id_grammar" CHECK ("measurement_plans"."intent_id" ~ '^intent_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "measurement_plans_state_vocabulary" CHECK ("measurement_plans"."state" in ('draft', 'published', 'active', 'completed', 'cancelled')),
        CONSTRAINT "measurement_plans_metrics_nonempty" CHECK (array_length("measurement_plans"."metrics", 1) > 0)
);
--> statement-breakpoint
CREATE TABLE "observations" (
        "id" text PRIMARY KEY NOT NULL,
        "person_id" text NOT NULL,
        "concept_code" text NOT NULL,
        "value" jsonb NOT NULL,
        "unit" text NOT NULL,
        "effective_at" timestamp with time zone NOT NULL,
        "observed_at" timestamp with time zone NOT NULL,
        "source_id" text NOT NULL,
        "method_id" text NOT NULL,
        "evidence_id" text,
        "quality" double precision,
        "validation_state" text NOT NULL,
        "provenance_id" text NOT NULL,
        "evidence_label" text NOT NULL,
        "supersedes_id" text,
        "created_at" timestamp with time zone NOT NULL,
        CONSTRAINT "uq_observations_supersedes" UNIQUE("supersedes_id"),
        CONSTRAINT "observations_id_grammar" CHECK ("observations"."id" ~ '^obs_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "observations_person_id_grammar" CHECK ("observations"."person_id" ~ '^prsn_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "observations_source_id_grammar" CHECK ("observations"."source_id" ~ '^src_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "observations_provenance_id_grammar" CHECK ("observations"."provenance_id" ~ '^prov_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "observations_supersedes_id_grammar" CHECK ("observations"."supersedes_id" ~ '^obs_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "observations_evidence_id_grammar" CHECK ("observations"."evidence_id" ~ '^evid_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "observations_validation_state_vocabulary" CHECK ("observations"."validation_state" in ('pending', 'validated', 'rejected', 'superseded')),
        CONSTRAINT "observations_evidence_label_vocabulary" CHECK ("observations"."evidence_label" in ('MEASURED', 'ESTIMATED', 'IMPORTED', 'DERIVED')),
        CONSTRAINT "observations_value_json_type" CHECK (jsonb_typeof("observations"."value") = 'object' and ("observations"."value" ? 'v') and jsonb_typeof("observations"."value"->'v') in ('string', 'number', 'boolean')),
        CONSTRAINT "observations_quality_range" CHECK ("observations"."quality" is null or ("observations"."quality" >= 0 and "observations"."quality" <= 1)),
        CONSTRAINT "observations_concept_code_nonempty" CHECK ("observations"."concept_code" <> ''),
        CONSTRAINT "observations_method_id_nonempty" CHECK ("observations"."method_id" <> '')
);
--> statement-breakpoint
CREATE TABLE "outbox" (
        "event_id" text PRIMARY KEY NOT NULL,
        "event_type" text NOT NULL,
        "payload" text NOT NULL,
        "status" text NOT NULL,
        "attempts" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp with time zone NOT NULL,
        "published_at" timestamp with time zone,
        "last_error" text,
        CONSTRAINT "outbox_event_id_grammar" CHECK ("outbox"."event_id" ~ '^evt_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "outbox_event_type_vocabulary" CHECK ("outbox"."event_type" in ('INTENT_CREATED', 'PLAN_PUBLISHED', 'TASK_DUE', 'OBSERVATION_RECORDED', 'OBSERVATION_SUPERSEDED', 'EVIDENCE_INGESTED', 'ACCESS_GRANTED', 'ACCESS_REVOKED', 'ACCESS_EVALUATED', 'SERVICE_ORDER_CREATED', 'SERVICE_ORDER_FULFILLED', 'EXTENSION_INSTALLED', 'STUDY_ENROLLED', 'SAFETY_FLAG_RAISED')),
        CONSTRAINT "outbox_status_vocabulary" CHECK ("outbox"."status" in ('pending', 'published', 'failed')),
        CONSTRAINT "outbox_payload_nonempty" CHECK ("outbox"."payload" <> ''),
        CONSTRAINT "outbox_attempts_nonnegative" CHECK ("outbox"."attempts" >= 0),
        CONSTRAINT "outbox_last_error_nonempty" CHECK ("outbox"."last_error" is null or "outbox"."last_error" <> '')
);
--> statement-breakpoint
CREATE TABLE "persons" (
        "id" text PRIMARY KEY NOT NULL,
        "display_name" text NOT NULL,
        "created_at" timestamp with time zone NOT NULL,
        CONSTRAINT "persons_id_grammar" CHECK ("persons"."id" ~ '^prsn_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "persons_display_name_nonempty" CHECK ("persons"."display_name" <> '')
);
--> statement-breakpoint
CREATE TABLE "provenances" (
        "id" text PRIMARY KEY NOT NULL,
        "actor" text NOT NULL,
        "subject" text NOT NULL,
        "occurred_at" timestamp with time zone NOT NULL,
        "causation_id" text,
        "correlation_id" text,
        "created_at" timestamp with time zone NOT NULL,
        CONSTRAINT "provenances_id_grammar" CHECK ("provenances"."id" ~ '^prov_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "provenances_actor_grammar" CHECK ("provenances"."actor" ~ '^(prsn|dev|src)_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "provenances_subject_grammar" CHECK ("provenances"."subject" ~ '^prsn_[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT "provenances_causation_nonempty" CHECK ("provenances"."causation_id" is null or "provenances"."causation_id" <> ''),
        CONSTRAINT "provenances_correlation_nonempty" CHECK ("provenances"."correlation_id" is null or "provenances"."correlation_id" <> '')
);
--> statement-breakpoint
ALTER TABLE "access_audits" ADD CONSTRAINT "access_audits_subject_id_persons_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_subject_id_persons_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_objects" ADD CONSTRAINT "evidence_objects_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_objects" ADD CONSTRAINT "evidence_objects_provenance_id_provenances_id_fk" FOREIGN KEY ("provenance_id") REFERENCES "public"."provenances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_intents" ADD CONSTRAINT "health_intents_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_plans" ADD CONSTRAINT "measurement_plans_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_plans" ADD CONSTRAINT "measurement_plans_intent_id_health_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."health_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_evidence_id_evidence_objects_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_provenance_id_provenances_id_fk" FOREIGN KEY ("provenance_id") REFERENCES "public"."provenances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_supersedes_id_observations_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenances" ADD CONSTRAINT "provenances_subject_persons_id_fk" FOREIGN KEY ("subject") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_access_audits_subject_created" ON "access_audits" USING btree ("subject_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_access_grants_subject_recipient" ON "access_grants" USING btree ("subject_id","recipient_id");--> statement-breakpoint
CREATE INDEX "idx_access_grants_subject_created" ON "access_grants" USING btree ("subject_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_accounts_person_created" ON "accounts" USING btree ("person_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_evidence_objects_person_created" ON "evidence_objects" USING btree ("person_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_evidence_objects_sha256" ON "evidence_objects" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "idx_health_intents_person_created" ON "health_intents" USING btree ("person_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_measurement_plans_person_created" ON "measurement_plans" USING btree ("person_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_measurement_plans_intent" ON "measurement_plans" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "idx_observations_person_created" ON "observations" USING btree ("person_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_observations_person_concept" ON "observations" USING btree ("person_id","concept_code","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_outbox_status_created" ON "outbox" USING btree ("status","created_at","event_id");--> statement-breakpoint
CREATE INDEX "idx_provenances_subject_created" ON "provenances" USING btree ("subject","created_at","id");
