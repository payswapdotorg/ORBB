"use client";

/**
 * Answer-only share preview (M6-C B7, Lane B) — the §Sharing UX
 * "answer only" concept presented as a clearly-labeled, DISPLAY-ONLY
 * affordance with an honest "requires protocol support not yet enabled"
 * note. Never fakes the computation (the work order's binding honesty
 * rule).
 */

import { Card, Heading, Text } from "@orbb/ui";

export function AnswerOnlyPreview() {
  return (
    <div data-testid="answer-only-preview">
    <Card>
      <Heading level={2}>Answer-only access (preview)</Heading>
      <Text variant="muted">
        Some questions can be answered without sharing the underlying records:
      </Text>
      <blockquote className="mt-3 rounded-md border border-border bg-muted/40 p-3">
        <Text>
          &ldquo;Does this person have at least 90 days of qualifying observations?&rdquo;
        </Text>
      </blockquote>
      <Text variant="small">
        Requires protocol support that is not yet enabled. When available, the recipient receives
        only the yes/no answer — never your records. (Preview shown for transparency; nothing is
        computed or sent.)
      </Text>
      </Card>
    </div>
  );
}
