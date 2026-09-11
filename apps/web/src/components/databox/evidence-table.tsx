"use client";

import {
  DisclosurePanel,
  DueWindow,
  Table,
  useColumnSort,
  type ColumnSort,
  type DueWindowTone,
  type TableColumn,
  type TableRow,
} from "@orbb/ui";
import {
  EVIDENCE_STATUS_LABELS,
  SYNTHETIC_EVIDENCE_ITEMS,
  type EvidenceValidationStatus,
  type SyntheticEvidenceItem,
} from "@/lib/synthetic-data";

/**
 * Evidence list (M3-B): the DataBox evidence table.
 *
 * Composition of `@orbb/ui` primitives — consume, never re-implement:
 * - the `Table` renders semantic table markup with sortable columns
 *   (captured time, media type, status); sort transitions are computed by
 *   the library's pure `toggleColumnSort` via the `useColumnSort` hook,
 *   with the actual row ordering staying the caller's job (this module's
 *   pure `sortEvidenceRows`);
 * - each row carries a `DisclosurePanel` in its metadata cell, revealing
 *   the evidence metadata details (checksum prefix, retention class,
 *   provenance actor) per the Provenance UX drawer contract;
 * - validation status renders as a `DueWindow` badge — the label text is
 *   the status carrier, the tone only reinforces it (WCAG 1.4.1).
 */

const COLUMNS: readonly TableColumn[] = [
  { id: "evidence", header: "Evidence" },
  { id: "capturedAt", header: "Captured", sortable: true },
  { id: "mediaType", header: "Media type", sortable: true },
  { id: "status", header: "Status", sortable: true },
  { id: "metadata", header: "Metadata" },
];

const STATUS_TONE: Readonly<Record<EvidenceValidationStatus, DueWindowTone>> = {
  validated: "success",
  pending: "warning",
  superseded: "neutral",
};

/** Status ordering used when the status column is sorted. */
const STATUS_RANK: Readonly<Record<EvidenceValidationStatus, number>> = {
  validated: 0,
  pending: 1,
  superseded: 2,
};

function compareEvidence(
  a: SyntheticEvidenceItem,
  b: SyntheticEvidenceItem,
  columnId: string,
): number {
  if (columnId === "capturedAt") {
    return a.capturedAtIso.localeCompare(b.capturedAtIso);
  }
  if (columnId === "mediaType") {
    return a.mediaType.localeCompare(b.mediaType);
  }
  if (columnId === "status") {
    return (STATUS_RANK[a.status] ?? 0) - (STATUS_RANK[b.status] ?? 0);
  }
  return 0;
}

/**
 * Orders evidence rows for a sort state (pure). `null` keeps the fixture
 * order (most recent first). Ties break by id so the order is always
 * deterministic.
 */
export function sortEvidenceRows(
  items: readonly SyntheticEvidenceItem[],
  sort: ColumnSort | null,
): readonly SyntheticEvidenceItem[] {
  if (sort === null) {
    return items;
  }
  const factor = sort.direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const compared = compareEvidence(a, b, sort.columnId);
    if (compared !== 0) {
      return compared * factor;
    }
    return a.id.localeCompare(b.id);
  });
}

function EvidenceMetadata({ item }: { item: SyntheticEvidenceItem }) {
  return (
    <DisclosurePanel
      id={`evidence-metadata-${item.id}`}
      title={`Metadata: ${item.id}`}
    >
      <dl className="m-0 grid grid-cols-1 gap-2">
        <div>
          <dt className="text-xs font-semibold">Checksum prefix</dt>
          <dd className="m-0 font-mono text-xs">{item.checksumPrefix}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold">Retention class</dt>
          <dd className="m-0">{item.retentionClass}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold">Provenance actor</dt>
          <dd className="m-0">{item.provenanceActor}</dd>
        </div>
      </dl>
    </DisclosurePanel>
  );
}

export function EvidenceTable() {
  const [sort, sortBy] = useColumnSort();
  const sorted = sortEvidenceRows(SYNTHETIC_EVIDENCE_ITEMS, sort);

  const rows: TableRow[] = sorted.map((item) => ({
    id: item.id,
    cells: {
      evidence: (
        <span className="flex flex-col gap-0.5">
          <span>{item.summary}</span>
          <span className="font-mono text-xs text-fg-muted">{item.id}</span>
        </span>
      ),
      capturedAt: item.capturedAtLabel,
      mediaType: item.mediaType,
      status: (
        <DueWindow tone={STATUS_TONE[item.status]}>
          {EVIDENCE_STATUS_LABELS[item.status]}
        </DueWindow>
      ),
      metadata: <EvidenceMetadata item={item} />,
    },
  }));

  return (
    <Table
      caption="Synthetic evidence captured into your DataBox — no real records."
      columns={COLUMNS}
      rows={rows}
      sort={sort}
      onSortChange={(next) => {
        sortBy(next.columnId);
      }}
    />
  );
}
