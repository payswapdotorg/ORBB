"use client";

import { useId } from "react";
import type { ReactNode } from "react";
import { color, spacing, typography } from "../../tokens";

/**
 * Props `FieldWrapper` hands to its render callback so the wrapped control is
 * correctly wired into the field's accessibility tree.
 *
 * Spread these onto the control element (input, select, textarea):
 * - `id` pairs with the wrapper's `<label htmlFor>`;
 * - `aria-describedby` references the hint and/or error message ids
 *   (WCAG 1.3.1 / 3.3.1 / 3.3.2);
 * - `aria-invalid` is present only when an error is rendered;
 * - `aria-required` is present only when the field is required
 *   (paired with the visible asterisk indicator).
 */
export interface FieldControlProps {
  readonly id: string;
  readonly "aria-describedby"?: string;
  readonly "aria-invalid"?: boolean;
  readonly "aria-required"?: boolean;
}

export interface FieldWrapperProps {
  /** Stable external id for the control (generated via `useId` when omitted). */
  id?: string;
  /** Visible field label (rendered as `<label htmlFor>`). */
  label: ReactNode;
  /** Supporting hint text, associated via `aria-describedby`. */
  hint?: ReactNode;
  /** Error message; presence marks the field invalid (`aria-invalid`). */
  error?: ReactNode;
  /** Marks the field required (asterisk + `aria-required`). */
  required?: boolean;
  /**
   * Render callback receiving the wiring props for the control, e.g.
   * `<FieldWrapper label="Name">{(field) => <TextField {...field} />}</FieldWrapper>`.
   */
  children: (field: FieldControlProps) => ReactNode;
}

/**
 * Field wiring primitive (M1-B): renders label, optional hint and error, the
 * required indicator, and computes the `aria-describedby` chain for the
 * control. Purely presentational — validation logic lives with the caller.
 *
 * Accessibility contract:
 * - the label is programmatically tied to the control via `htmlFor`/`id`;
 * - hint and error are referenced from the control through
 *   `aria-describedby`, so screen readers announce them on focus;
 * - `aria-invalid` and `aria-required` are only emitted when applicable,
 *   avoiding redundant "false" announcements;
 * - the visible asterisk is `aria-hidden` because `aria-required` already
 *   conveys the state (no double announcement).
 *
 * Checkbox and RadioGroup carry their own labels (label wrapping / group
 * naming) by nature of their geometry and are not FieldWrapper targets.
 */
export function FieldWrapper({
  id,
  label,
  hint,
  error,
  required = false,
  children,
}: FieldWrapperProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;

  const describedByParts: string[] = [];
  if (hint !== undefined) {
    describedByParts.push(hintId);
  }
  if (error !== undefined) {
    describedByParts.push(errorId);
  }
  const describedBy =
    describedByParts.length > 0 ? describedByParts.join(" ") : undefined;

  const controlProps: FieldControlProps = {
    id: controlId,
    ...(describedBy !== undefined ? { "aria-describedby": describedBy } : {}),
    ...(error !== undefined ? { "aria-invalid": true } : {}),
    ...(required ? { "aria-required": true } : {}),
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch" }}>
      <label
        htmlFor={controlId}
        style={{
          marginBottom: `${spacing[1]}px`,
          color: color.fgPrimary,
          fontFamily: typography.family.sans,
          fontSize: `${typography.size.sm}px`,
          fontWeight: typography.weight.medium,
          lineHeight: typography.lineHeight.normal,
        }}
      >
        {label}
        {required ? (
          <span aria-hidden="true" style={{ color: color.danger, marginLeft: `${spacing[1]}px` }}>
            *
          </span>
        ) : null}
      </label>
      {children(controlProps)}
      {hint !== undefined ? (
        <p
          id={hintId}
          style={{
            margin: 0,
            marginTop: `${spacing[1]}px`,
            color: color.fgMuted,
            fontFamily: typography.family.sans,
            fontSize: `${typography.size.xs}px`,
            lineHeight: typography.lineHeight.normal,
          }}
        >
          {hint}
        </p>
      ) : null}
      {error !== undefined ? (
        <p
          id={errorId}
          style={{
            margin: 0,
            marginTop: `${spacing[1]}px`,
            color: color.danger,
            fontFamily: typography.family.sans,
            fontSize: `${typography.size.xs}px`,
            lineHeight: typography.lineHeight.normal,
          }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
