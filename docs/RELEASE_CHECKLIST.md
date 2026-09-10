# Release Checklist

## Architecture
- [ ] Frozen domain contracts unchanged or ADR-approved
- [ ] Provider abstractions preserved
- [ ] Event/outbox semantics verified
- [ ] No cross-lane ownership violations

## Security/privacy
- [ ] Authn/authz tests green
- [ ] Consent and revocation tests green
- [ ] No PHI in logs/analytics/traces
- [ ] Extension sandbox tests green
- [ ] Upload URL and object access expiry verified
- [ ] Rate limits and abuse controls verified
- [ ] OWASP ASVS 5.0 mapping reviewed

## Data integrity
- [ ] Provenance present for every Observation
- [ ] Raw Evidence retained according to policy
- [ ] Idempotency verified
- [ ] Migration expand/contract verified
- [ ] Backup/restore drill passed

## Product
- [ ] Accessibility check passed
- [ ] Playwright critical journeys green
- [ ] Maestro critical journeys green for supported mobile release
- [ ] Error and offline paths exercised
- [ ] Consent/sharing UX manually reviewed

## Deployment
- [ ] Preview is reachable
- [ ] Staging is reachable
- [ ] DB migrations applied safely
- [ ] Workers/queues healthy
- [ ] Smoke tests passed after deploy
- [ ] Observability alerts tested
- [ ] Rollback/forward-fix plan documented

## Health safety
- [ ] No unsupported diagnostic claims
- [ ] AI outputs are appropriately labeled and source-grounded
- [ ] Safety-critical recommendations have deterministic guards
- [ ] User escape/emergency paths remain available

## Final lead sign-off
- Release candidate commit:
- Preview/staging URL:
- Last dogfood timestamp:
- Known limitations:
- Rollback target:
- Lead decision: GO / NO-GO
