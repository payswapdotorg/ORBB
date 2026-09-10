/**
 * Site footer. Sticky to the bottom of the viewport via the root layout's
 * `min-h-dvh flex flex-col` wrapper plus `mt-auto`, so it never overlaps
 * content and never floats above a gap on short pages.
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border-subtle bg-surface">
      <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6">
        <p className="text-sm text-fg-muted">
          ORBB — Personal Health Operating System. Synthetic M0 shell: no real
          medical data, no real credentials.
        </p>
      </div>
    </footer>
  );
}
