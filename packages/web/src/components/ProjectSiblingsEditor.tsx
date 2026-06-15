"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SiblingGlyph } from "./SessionSiblings";

/**
 * A registered project offered in the project-level "+ sibling" picker (#1095).
 * `id` is the project id, persisted verbatim into the project's `siblings`
 * config array.
 */
export interface SiblingCatalogEntry {
  id: string;
  name: string;
}

interface ProjectSiblingsEditorProps {
  projectId: string;
  /** Configured siblings from the project config, resolved to display names. */
  siblings: SiblingCatalogEntry[];
  /** The other registered projects; already-configured entries are filtered out of the picker. */
  catalog: SiblingCatalogEntry[];
}

/**
 * Interactive editor for a project's configured sibling repos (#1095), shown
 * under the project header in the sidebar. Add/remove PATCH the project config
 * (`/api/projects/[id]`) with the full updated `siblings` array (replace
 * semantics); optimistic state reconciles against the server-rendered prop
 * after `router.refresh()`. Edits apply to sessions spawned afterwards —
 * running sessions keep what they mounted.
 */
export function ProjectSiblingsEditor({
  projectId,
  siblings,
  catalog,
}: ProjectSiblingsEditorProps) {
  const router = useRouter();
  const [added, setAdded] = useState<SiblingCatalogEntry[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Reconcile optimistic state once the server-rendered prop catches up.
  useEffect(() => {
    setAdded((prev) => prev.filter((a) => !siblings.some((s) => s.id === a.id)));
    setRemoved((prev) => {
      const next = new Set([...prev].filter((id) => siblings.some((s) => s.id === id)));
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

  const configured: SiblingCatalogEntry[] = [
    ...siblings.filter((s) => !removed.has(s.id)),
    ...added.filter((a) => !siblings.some((s) => s.id === a.id)),
  ];
  const configuredIds = new Set(configured.map((s) => s.id));
  const available = catalog.filter((c) => !configuredIds.has(c.id));

  async function patchSiblings(nextIds: string[]): Promise<void> {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siblings: nextIds }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Failed to update siblings");
    }
  }

  async function addSibling(entry: SiblingCatalogEntry) {
    setBusy(entry.id);
    setError(null);
    try {
      await patchSiblings([...configured.map((s) => s.id), entry.id]);
      setAdded((prev) => [...prev, entry]);
      setPickerOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add sibling");
    } finally {
      setBusy(null);
    }
  }

  async function removeSibling(entry: SiblingCatalogEntry) {
    setBusy(entry.id);
    setError(null);
    try {
      await patchSiblings(configured.filter((s) => s.id !== entry.id).map((s) => s.id));
      setRemoved((prev) => new Set(prev).add(entry.id));
      setAdded((prev) => prev.filter((a) => a.id !== entry.id));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove sibling");
    } finally {
      setBusy(null);
    }
  }

  if (configured.length === 0 && catalog.length === 0) return null;

  return (
    <div className="px-3 py-1.5" aria-label={`Sibling repos for ${projectId}`}>
      <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
        Siblings
      </span>
      {configured.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-0.5" aria-label="Configured sibling repos">
          {configured.map((s) => (
            <li key={s.id} className="group/psib flex min-w-0 items-center gap-1.5 text-[11px]">
              <SiblingGlyph />
              <span className="truncate text-[var(--color-text-secondary)]">{s.name}</span>
              <button
                type="button"
                onClick={() => void removeSibling(s)}
                disabled={busy === s.id}
                className="ml-auto shrink-0 rounded p-0.5 text-[var(--color-text-muted)] opacity-0 hover:text-[var(--color-accent-red)] focus:opacity-100 group-hover/psib:opacity-100 disabled:opacity-40"
                aria-label={`Remove sibling ${s.name}`}
                title={`Remove ${s.name} — applies to new sessions only`}
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
            </li>
          ))}
        </ul>
      ) : null}

      {catalog.length > 0 ? (
        <div className="relative mt-0.5" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)]"
            aria-label={`Add sibling to ${projectId}`}
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
              aria-label="Add a sibling repo"
              className="absolute left-0 top-full z-20 mt-0.5 min-w-[10rem] rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] py-1 shadow-lg"
            >
              {available.length === 0 ? (
                <div className="px-2 py-1 text-[11px] text-[var(--color-text-muted)]">
                  All projects configured
                </div>
              ) : (
                available.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="menuitem"
                    onClick={() => void addSibling(entry)}
                    disabled={busy === entry.id}
                    className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-40"
                  >
                    <SiblingGlyph />
                    <span className="truncate">{entry.name}</span>
                  </button>
                ))
              )}
              <div className="mt-1 border-t border-[var(--color-border-subtle)] px-2 pt-1 text-[10px] text-[var(--color-text-muted)]">
                Applies to new sessions only
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="mt-0.5 text-[10px] text-[var(--color-accent-red)]">
          {error}
        </div>
      ) : null}
    </div>
  );
}
