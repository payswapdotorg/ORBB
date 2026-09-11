CREATE OR REPLACE FUNCTION "orbb_reject_access_audit_mutation"() RETURNS trigger AS $$ BEGIN
  RAISE EXCEPTION 'access_audits is append-only: % is not permitted (architecture §7 immutable audit trail)', TG_OP
    USING ERRCODE = 'check_violation';
END;
 $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "access_audits_append_only" BEFORE UPDATE OR DELETE ON "access_audits" FOR EACH ROW EXECUTE FUNCTION "orbb_reject_access_audit_mutation"();--> statement-breakpoint
CREATE TRIGGER "access_audits_append_only_truncate" BEFORE TRUNCATE ON "access_audits" FOR EACH STATEMENT EXECUTE FUNCTION "orbb_reject_access_audit_mutation"();
