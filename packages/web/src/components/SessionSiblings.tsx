"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { DashboardSibling } from "@/lib/types";

/**
 * A mountable sibling repo offered in the "+ sibling" picker (#1095). The
 * catalog is the set of *other* registered projects — `id` is the project id,
 * used verbatim as the `repo` the core resolves against.
 */
export interface SiblingCatalogEntry {
  id: string;
  name: string;
}

/** Small link/branch glyph (line icon, currentColor) used beside each sibling. */
function SiblingGlyph() {
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
 * Read-only list of a session's mounted siblings (repo + branch). Used in the
 * kanban card and the session inspector. Renders nothing when there are none.
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

/**
 * Read-only view of the available-siblings catalog (the other registered
 * projects), shown under a project header. Renders nothing when empty.
 */
export function SiblingCatalogList({ catalog }: { catalog: SiblingCatalogEntry[] }) {
  if (catalog.length === 0) return null;
  return (
    <div className="px-3 py-1.5" aria-label="Available sibling repos">
      <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
        Available siblings
      </span>
      <ul className="mt-1 flex flex-col gap-0.5">
        {catalog.map((entry) => (
          <li
            key={entry.id}
            className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--color-text-tertiary)]"
          >
            <SiblingGlyph />
            <span className="truncate">{entry.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface SessionSiblingsProps {
  sessionId: string;
  siblings: DashboardSibling[];
  /** Other registered projects that can be mounted. Empty → read-only (no add). */
  catalog: SiblingCatalogEntry[];
}

/**
 * Interactive per-session sibling manager (#1095) for the sidebar: lists the
 * mounted siblings (with an unmount affordance) and a "+ sibling" picker over
 * the available catalog. Optimistic add/remove reconcile against the prop the
 * next SSE refresh provides (mirrors the inline-rename pattern in the sidebar).
 */
export function SessionSiblings({ sessionId, siblings, catalog }: SessionSiblingsProps) {
  const [added, setAdded] = useState<DashboardSibling[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Reconcile optimistic state once the prop (SSE refresh) catches up.
  useEffect(() => {
    setAdded((prev) => prev.filter((a) => !siblings.some((s) => s.repo === a.repo)));
    setRemoved((prev) => {
      const next = new Set([...prev].filter((repo) => siblings.some((s) => s.repo === repo)));
      return next.size === prev.size ? prev : next;
    });
  }, [siblings]);

  // Close the picker on outside click or Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  const mounted: DashboardSibling[] = [
    ...siblings.filter((s) => !removed.has(s.repo)),
    ...added.filter((a) => !siblings.some((s) => s.repo === a.repo)),
  ];
  const mountedRepos = new Set(mounted.map((s) => s.repo));
  const available = catalog.filter((c) => !mountedRepos.has(c.id));

  async function mountSibling(entry: SiblingCatalogEntry) {
    setBusy(entry.id);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/siblings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: entry.id }),
      });
      const body = (await res.json().catch(() => null)) as
        | { sibling?: DashboardSibling; error?: string }
        | null;
      if (!res.ok) throw new Error(body?.error ?? "Failed to mount sibling");
      if (body?.sibling) setAdded((prev) => [...prev, body.sibling as DashboardSibling]);
      setPickerOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mount sibling");
    } finally {
      setBusy(null);
    }
  }

  async function unmountSibling(repo: string) {
    setBusy(repo);
    setError(null);
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/siblings?repo=${encodeURIComponent(repo)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to unmount sibling");
      }
      setRemoved((prev) => new Set(prev).add(repo));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to unmount sibling");
    } finally {
      setBusy(null);
    }
  }

  if (mounted.length === 0 && catalog.length === 0) return null;

  return (
    <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-[var(--color-border-subtle)] pl-2">
      {mounted.map((s) => (
        <div key={s.repo} className="group/sib flex min-w-0 items-center gap-1.5 text-[11px]">
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
          <button
            type="button"
            onClick={() => void unmountSibling(s.repo)}
            disabled={busy === s.repo}
            className="ml-auto shrink-0 rounded p-0.5 text-[var(--color-text-muted)] opacity-0 hover:text-[var(--color-accent-red)] focus:opacity-100 group-hover/sib:opacity-100 disabled:opacity-40"
            aria-label={`Unmount ${s.repo}`}
            title={`Unmount ${s.repo}`}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}

      {catalog.length > 0 ? (
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)]"
            aria-label="Add sibling repo"
            aria-expanded={pickerOpen}
            aria-haspopup="menu"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>sibling</span>
          </button>
          {pickerOpen ? (
            <div
              role="menu"
              aria-label="Mount a sibling repo"
              className="absolute left-0 top-full z-20 mt-0.5 min-w-[10rem] rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] py-1 shadow-lg"
            >
              {available.length === 0 ? (
                <div className="px-2 py-1 text-[11px] text-[var(--color-text-muted)]">
                  All repos mounted
                </div>
              ) : (
                available.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="menuitem"
                    onClick={() => void mountSibling(entry)}
                    disabled={busy === entry.id}
                    className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-40"
                  >
                    <SiblingGlyph />
                    <span className="truncate">{entry.name}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="text-[10px] text-[var(--color-accent-red)]">
          {error}
        </div>
      ) : null}
    </div>
  );
}
