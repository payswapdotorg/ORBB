import { describe, expect, it } from "vitest";
import * as smart from "./index.js";

describe("@orbb/smart public surface", () => {
  it("exports the launch-boundary surface", () => {
    expect(typeof smart.parseSmartLaunchContext).toBe("function");
    expect(typeof smart.isSmartLaunchContext).toBe("function");
    expect(Array.isArray(smart.LAUNCH_VALIDATION_REASONS)).toBe(true);
  });

  it("exports the frozen scope grammar + evaluation surface", () => {
    expect(typeof smart.parseSmartScope).toBe("function");
    expect(typeof smart.parseSmartScopeSet).toBe("function");
    expect(typeof smart.formatSmartScope).toBe("function");
    expect(typeof smart.evaluateSmartScope).toBe("function");
    expect(typeof smart.effectiveLaunchAccess).toBe("function");
    expect(typeof smart.grantedAccessOf).toBe("function");
    expect(Array.isArray(smart.SMART_SCOPE_RESOURCE_TYPES)).toBe(true);
    expect(Array.isArray(smart.SMART_SCOPE_MODIFIERS)).toBe(true);
    expect(Array.isArray(smart.SMART_ACCESS_ACTIONS)).toBe(true);
    expect(Array.isArray(smart.SCOPE_VALIDATION_REASONS)).toBe(true);
    expect(Array.isArray(smart.SMART_SCOPE_DENY_REASONS)).toBe(true);
  });

  it("exports the token-exchange seam and the SYNTH doubles", () => {
    expect(typeof smart.InMemoryTokenExchange).toBe("function");
    expect(typeof smart.SynthEhrExchange).toBe("function");
    expect(Array.isArray(smart.SMART_EXCHANGE_FAILURE_CODES)).toBe(true);
    expect(typeof smart.timingSafeEqualHex).toBe("function");
    expect(typeof smart.sha256Hex).toBe("function");
    expect(typeof smart.randomOpaqueToken).toBe("function");
  });

  it("exports the audit surface", () => {
    expect(typeof smart.isSmartLaunchAuditRecord).toBe("function");
    expect(typeof smart.toSmartLaunchAuditRecord).toBe("function");
    expect(typeof smart.auditIssHostOf).toBe("function");
    expect(Array.isArray(smart.SMART_AUDIT_STAGES)).toBe(true);
    expect(Array.isArray(smart.SMART_LAUNCH_DECISION_KINDS)).toBe(true);
  });

  it("round-trips the golden path through the whole boundary", async () => {
    const audience = "orbb-clinical-web";
    const issuer = "https://ehr.synth.test/fhir";
    const ids = new smart.SmartRandomIdFactory();

    // 1. EHR-side: mint a launch handle (SYNTH double standing in).
    const ehr = new smart.SynthEhrExchange({
      registrations: [
        {
          issuer,
          clientId: audience,
          redirectUri: "https://app.orbb.example.test/smart/callback",
          clientAuthentication: { kind: "client_secret", clientSecret: "synth-secret" },
          allowedScopes: "patient/Observation.rs patient/Condition.rs",
        },
      ],
      idFactory: ids,
    });
    const launch = await ehr.beginLaunch({ issuer, patient: "synth-patient-0077" });

    // 2. Boundary: parse + validate the launch parameters (total, typed).
    const parsed = smart.parseSmartLaunchContext(
      { iss: issuer, launch },
      { audience },
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.context.synth).toBe(true);

    // 3. Exchange the validated context for an opaque, narrowed token.
    const exchanged = await ehr.exchange({
      context: parsed.context,
      client: { clientId: audience, clientSecret: "synth-secret" },
      requestedScopes: "patient/Observation.rs patient/Patient.rs",
    });
    expect(exchanged.ok).toBe(true);
    if (!exchanged.ok) return;
    expect(exchanged.record.scope).toBe("patient/Observation.rs"); // narrowed
    expect(exchanged.scopeNarrowed).toBe(true);

    // 4. Deny-by-default evaluation over the granted set.
    const allowed = smart.evaluateSmartScope(exchanged.record.scope, {
      resourceType: "Observation",
      access: "search",
    });
    expect(allowed.decision).toBe("ALLOW");
    const denied = smart.evaluateSmartScope(exchanged.record.scope, {
      resourceType: "Patient",
      access: "read",
    });
    expect(denied.decision).toBe("DENY");

    // 5. A launch alone grants nothing: intersection with standing grants.
    expect(smart.effectiveLaunchAccess(exchanged.record.scopes, [])).toEqual([]);

    // 6. Verify + revoke.
    const verified = await ehr.verify(exchanged.token);
    expect(verified.ok).toBe(true);
    expect(await ehr.revoke(exchanged.token)).toBe(true);
  });
});
