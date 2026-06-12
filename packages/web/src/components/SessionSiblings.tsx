"use client";

import { cn } from "@/lib/cn";
import type { DashboardSibling } from "@/lib/types";

/** Small link/branch glyph (line icon, currentColor) used beside each sibling. */
export function SiblingGlyph() {
  return (
    <svg
      className="shrink-0 text-[var(--color-text-muted)]"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

/**
 * Read-only list of a session's mounted siblings (repo + branch). Siblings are
 * configured per project (see ProjectSiblingsEditor) and mounted at spawn —
 * sessions only display what they got. Renders nothing when there are none.
 */
export function MountedSiblings({
  siblings,
  className,
}: {
  siblings: DashboardSibling[];
  className?: string;
}) {
  if (siblings.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-0.5", className)} aria-label="Mounted sibling repos">
      {siblings.map((s) => (
        <li key={s.repo} className="flex min-w-0 items-center gap-1.5 text-[11px]">
          <SiblingGlyph />
          <span className="truncate font-mono text-[var(--color-text-secondary)]">{s.repo}</span>
          <span className="truncate font-mono text-[var(--color-text-tertiary)]">{s.branch}</span>
          {s.mode === "readonly-symlink" ? (
            <span
              className="font-mono text-[10px] uppercase text-[var(--color-text-muted)]"
              title="read-only symlink"
            >
              ro
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
