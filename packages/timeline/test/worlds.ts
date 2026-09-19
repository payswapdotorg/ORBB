/**
 * SYNTH test worlds for @orbb/timeline (agent-protocol test-data rules:
 * every id body carries the SYNTH marker; fixture identities can never
 * be confused with real patient records; never real medical data).
 *
 * The world builder constructs a fully deterministic fixture context —
 * the A45 clinical snapshot pieces (mirroring @orbb/clinical's own
 * evaluation fixtures), the domain records (observations, measurement
 * tasks, health intents), and the wired-up `PatientTimelineService` with
 * in-memory stores, a `DeterministicClock`, and a `DeterministicIdFactory`.
 *
 * `buildTimelineWorld()` is pure: the same call → the same world, always
 * (each call mints ids from a private counter in a fixed sequence).
 */
import {
  parsePersonId,
  parseQualityScore,
  type AccessGrant,
  type HealthIntent,
  type Observation,
  type ObservationId,
  type PersonId,
  type PlanId,
  type ProvenanceId,
  type QualityScore,
  type SourceId,
  type TaskId,
} from "@orbb/domain";
import {
  parseClinicId,
  parseOrganizationId,
  parsePractitionerId,
  type CareTeam,
  type CareTeamAccessSnapshot,
  type Clinic,
  type Organization,
  type PatientLink,
  type Practitioner,
  type PractitionerClinicAffiliation,
  type PractitionerId,
  type PractitionerOrganizationMembership,
} from "@orbb/clinical";
import type { MeasurementTask } from "@orbb/measurement";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import {
  InMemoryIntentTimelineStore,
  InMemoryObservationTimelineStore,
  InMemoryTaskTimelineStore,
  PatientTimelineService,
  type CanonicalObservationRecord,
  type PractitionerTimelineContext,
  type TimelineObservationSourceProvenance,
  type TimelineQuery,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Deterministic SYNTH id minting (per-world private counter).
// ---------------------------------------------------------------------------

/** Minted id bodies: `SYNTH-tl-<8-digit counter>` (sortable, canonical). */
function idMint(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `SYNTH-tl-${counter.toString().padStart(8, "0")}`;
  };
}

// ---------------------------------------------------------------------------
// Fixed SYNTH vocabulary (mirrors the measurement seed vocabulary).
// ---------------------------------------------------------------------------

const HR_CONCEPT = "SYNTH-8867-4";
const HR_METRIC = "SYNTH-metric-heart-rate";
const HR_METHOD_WEARABLE = "SYNTH-method-hr-wearable";
const HR_METHOD_MANUAL = "SYNTH-method-hr-manual";
const HR_UNIT = "beats/min";

// ---------------------------------------------------------------------------
// Fixed clock instants (UTC).
// ---------------------------------------------------------------------------

const REQUEST_AT = new Date("2025-06-01T12:00:00.000Z");
const EXPIRES_AT = new Date("2026-06-01T12:00:00.000Z");
const T0 = new Date("2025-05-01T08:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** A fixed instant `days` after T0 at the same time of day. */
function atDay(days: number, hour = 8): Date {
  return new Date(T0.getTime() + days * DAY + hour * HOUR);
}

// ---------------------------------------------------------------------------
// The world.
// ---------------------------------------------------------------------------

/** The deterministic SYNTH world (all fixtures, all builders). */
export interface TimelineWorld {
  readonly subject: PersonId;
  readonly otherPerson: PersonId;
  readonly practitioner: PractitionerId;
  readonly otherPractitioner: PractitionerId;
  readonly orgId: ReturnType<typeof parseOrganizationId>;
  readonly clinicId: ReturnType<typeof parseClinicId>;
  readonly requestAt: Date;
  readonly expiresAt: Date;
  readonly careManagement: string;

  makeGrant(overrides?: Partial<AccessGrant>): AccessGrant;
  makeLink(overrides?: Partial<PatientLink>): PatientLink;
  makeTeam(overrides?: Partial<CareTeam>): CareTeam;
  makePractitioner(overrides?: Partial<Practitioner>): Practitioner;
  makeOrganization(overrides?: Partial<Organization>): Organization;
  makeClinic(overrides?: Partial<Clinic>): Clinic;
  makeMembership(overrides?: Partial<PractitionerOrganizationMembership>): PractitionerOrganizationMembership;
  makeAffiliation(overrides?: Partial<PractitionerClinicAffiliation>): PractitionerClinicAffiliation;
  makeSnapshot(overrides?: SnapshotOverrides): CareTeamAccessSnapshot;
  makeContext(overrides?: ContextOverrides): PractitionerTimelineContext;

  observation(overrides?: Partial<Observation>): Observation;
  sourceProvenance(
    observation: Observation,
    role: TimelineObservationSourceProvenance["role"],
    overrides?: Partial<TimelineObservationSourceProvenance>,
  ): TimelineObservationSourceProvenance;
  canonicalRecord(
    canonical: Observation,
    extraSources?: readonly TimelineObservationSourceProvenance[],
  ): CanonicalObservationRecord;
  task(overrides?: Partial<MeasurementTask>): MeasurementTask;
  intent(overrides?: Partial<HealthIntent>): HealthIntent;

  makeService(options?: ServiceOptions): ServiceHarness;
}

/** Snapshot overrides with an org-level/clinic-scoped switch. */
export interface SnapshotOverrides {
  grant?: AccessGrant;
  patientLink?: PatientLink;
  careTeam?: CareTeam;
  practitioner?: Practitioner;
  organization?: Organization;
  membership?: PractitionerOrganizationMembership;
  clinic?: Clinic;
  affiliation?: PractitionerClinicAffiliation;
  /** Default true; false builds an org-level (clinic-less) snapshot. */
  clinicScoped?: boolean;
}

/** Practitioner-context overrides. */
export interface ContextOverrides {
  practitionerId?: PractitionerId;
  purpose?: string;
  snapshot?: CareTeamAccessSnapshot;
}

/** The wired-up service plus its injectable doubles. */
export interface ServiceHarness {
  readonly service: PatientTimelineService;
  readonly observations: InMemoryObservationTimelineStore;
  readonly tasks: InMemoryTaskTimelineStore;
  readonly intents: InMemoryIntentTimelineStore;
  readonly clock: DeterministicClock;
  readonly ids: DeterministicIdFactory;
}

/** Options for `makeService`. */
export interface ServiceOptions {
  /** Clock epoch (default: the fixed request instant). */
  readonly epochMs?: number;
  /** Id-factory seed (default "tl-evt"). */
  readonly seed?: string;
}

/**
 * Builds the deterministic SYNTH timeline world. Pure: the same options
 * (none by default) → the identical world, always.
 */
export function buildTimelineWorld(): TimelineWorld {
  const mint = idMint();

  const subject = parsePersonId(`prsn_${mint()}`);
  const otherPerson = parsePersonId(`prsn_${mint()}`);
  const practitioner = parsePractitionerId(`pract_${mint()}`);
  const otherPractitioner = parsePractitionerId(`pract_${mint()}`);
  const orgId = parseOrganizationId(`org_${mint()}`);
  const clinicId = parseClinicId(`clin_${mint()}`);
  const grantId = `grant_${mint()}` as AccessGrant["id"];

  const careManagement = "CARE_MANAGEMENT";

  const makeGrant = (overrides: Partial<AccessGrant> = {}): AccessGrant => ({
    id: grantId,
    subjectId: subject,
    // The clinical lane resolves the kernel's opaque recipientId: the
    // practitioner's canonical id IS the recipient.
    recipientId: practitioner,
    purpose: careManagement,
    scope: ["observations:read", "timeline:read", "intent:read"],
    state: "active",
    expiresAt: EXPIRES_AT,
    ...overrides,
  });

  const makeLink = (overrides: Partial<PatientLink> = {}): PatientLink => ({
    personId: subject,
    practitionerId: practitioner,
    state: "confirmed",
    requestedBy: "practitioner",
    ...overrides,
  });

  const makeTeam = (overrides: Partial<CareTeam> = {}): CareTeam => ({
    personId: subject,
    state: "active",
    entries: [{ practitionerId: practitioner, role: "primary-care" }],
    ...overrides,
  });

  const makePractitioner = (overrides: Partial<Practitioner> = {}): Practitioner => ({
    id: practitioner,
    displayName: "Dr. Synth Practitioner",
    state: "verified",
    ...overrides,
  });

  const makeOrganization = (overrides: Partial<Organization> = {}): Organization => ({
    id: orgId,
    displayName: "Synth Community Health",
    state: "active",
    ...overrides,
  });

  const makeClinic = (overrides: Partial<Clinic> = {}): Clinic => ({
    id: clinicId,
    organizationId: orgId,
    displayName: "Synth Riverside Clinic",
    state: "active",
    ...overrides,
  });

  const makeMembership = (
    overrides: Partial<PractitionerOrganizationMembership> = {},
  ): PractitionerOrganizationMembership => ({
    practitionerId: practitioner,
    organizationId: orgId,
    role: "member",
    active: true,
    ...overrides,
  });

  const makeAffiliation = (
    overrides: Partial<PractitionerClinicAffiliation> = {},
  ): PractitionerClinicAffiliation => ({
    practitionerId: practitioner,
    clinicId,
    role: "member",
    active: true,
    ...overrides,
  });

  const makeSnapshot = (overrides: SnapshotOverrides = {}): CareTeamAccessSnapshot => {
    const {
      grant = makeGrant(),
      patientLink = makeLink(),
      careTeam = makeTeam(),
      practitioner: practitionerEntity = makePractitioner(),
      organization = makeOrganization(),
      membership = makeMembership(),
      clinic = makeClinic(),
      affiliation = makeAffiliation(),
      clinicScoped = true,
    } = overrides;
    return clinicScoped
      ? {
          grant,
          patientLink,
          careTeam,
          practitioner: practitionerEntity,
          organization,
          membership,
          clinic,
          affiliation,
        }
      : { grant, patientLink, careTeam, practitioner: practitionerEntity, organization, membership };
  };

  const makeContext = (overrides: ContextOverrides = {}): PractitionerTimelineContext => ({
    practitionerId: overrides.practitionerId ?? practitioner,
    purpose: overrides.purpose ?? careManagement,
    snapshot: overrides.snapshot ?? makeSnapshot(),
  });

  const observation = (overrides: Partial<Observation> = {}): Observation => ({
    id: `obs_${mint()}` as ObservationId,
    personId: subject,
    conceptCode: HR_CONCEPT,
    value: 72,
    unit: HR_UNIT,
    effectiveAt: atDay(5),
    observedAt: atDay(5),
    sourceId: `src_${mint()}` as SourceId,
    methodId: HR_METHOD_WEARABLE,
    quality: parseQualityScore(0.95) as QualityScore,
    validationState: "validated",
    provenanceId: `prov_${mint()}` as ProvenanceId,
    evidenceLabel: "MEASURED",
    ...overrides,
  });

  const sourceProvenance = (
    of: Observation,
    role: TimelineObservationSourceProvenance["role"],
    overrides: Partial<TimelineObservationSourceProvenance> = {},
  ): TimelineObservationSourceProvenance => ({
    observationId: of.id,
    sourceId: of.sourceId,
    methodId: of.methodId,
    evidenceLabel: of.evidenceLabel,
    ...(of.quality !== undefined ? { quality: of.quality } : {}),
    provenanceId: of.provenanceId,
    role,
    ...overrides,
  });

  const canonicalRecord = (
    canonical: Observation,
    extraSources: readonly TimelineObservationSourceProvenance[] = [],
  ): CanonicalObservationRecord => ({
    canonical,
    sources: [sourceProvenance(canonical, "canonical-source"), ...extraSources],
  });

  const task = (overrides: Partial<MeasurementTask> = {}): MeasurementTask => ({
    id: `task_${mint()}` as TaskId,
    planId: `plan_${mint()}` as PlanId,
    personId: subject,
    metricId: HR_METRIC,
    conceptCode: HR_CONCEPT,
    methodOrder: [HR_METHOD_WEARABLE, HR_METHOD_MANUAL],
    window: { sequence: 0, startsAt: atDay(6, 7), endsAt: atDay(6, 9) },
    state: "open",
    createdAt: REQUEST_AT,
    rollCount: 0,
    ...overrides,
  });

  const intent = (overrides: Partial<HealthIntent> = {}): HealthIntent => ({
    id: `intent_${mint()}` as HealthIntent["id"],
    personId: subject,
    objective: "SYNTH objective: maintain steady heart-rate monitoring",
    state: "active",
    createdAt: atDay(0),
    ...overrides,
  });

  const makeService = (options: ServiceOptions = {}): ServiceHarness => {
    const observations = new InMemoryObservationTimelineStore();
    const tasks = new InMemoryTaskTimelineStore();
    const intents = new InMemoryIntentTimelineStore();
    const clock = new DeterministicClock({
      epochMs: options.epochMs ?? REQUEST_AT.getTime(),
    });
    const ids = new DeterministicIdFactory({ seed: options.seed ?? "tl-evt" });
    const service = new PatientTimelineService({
      observations,
      tasks,
      intents,
      clock,
      ids,
    });
    return { service, observations, tasks, intents, clock, ids };
  };

  return {
    subject,
    otherPerson,
    practitioner,
    otherPractitioner,
    orgId,
    clinicId,
    requestAt: REQUEST_AT,
    expiresAt: EXPIRES_AT,
    careManagement,
    makeGrant,
    makeLink,
    makeTeam,
    makePractitioner,
    makeOrganization,
    makeClinic,
    makeMembership,
    makeAffiliation,
    makeSnapshot,
    makeContext,
    observation,
    sourceProvenance,
    canonicalRecord,
    task,
    intent,
    makeService,
  };
}

/** The unbounded default query (all entries, first page, default limit). */
export function allEntriesQuery(overrides: Partial<TimelineQuery> = {}): TimelineQuery {
  return { ...overrides };
}

export { atDay as atDayAfterT0, HOUR as MILLIS_PER_HOUR, DAY as MILLIS_PER_DAY };
export { HR_CONCEPT, HR_METRIC, HR_METHOD_MANUAL, HR_METHOD_WEARABLE, HR_UNIT };
export { REQUEST_AT, EXPIRES_AT, T0 };
