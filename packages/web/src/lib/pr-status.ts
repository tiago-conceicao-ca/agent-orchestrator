import { type DashboardPR } from "@/lib/types";

// Shared PR/CI tone + label mapping. Single source of truth for the dot colour,
// chip colour, and status label so the coding board (SessionCard) and the SDLC
// run view (SdlcTaskDetail) render a linked session's PR/CI identically.

/** Tailwind background class for the small PR state dot. */
export function getPRDotClass(p: DashboardPR): string {
  if (!p.enriched) return "bg-[var(--color-text-tertiary)] opacity-30";
  if (p.state === "merged") return "bg-[var(--color-status-merge)]";
  if (p.state === "closed") return "bg-[var(--color-text-muted)]";
  if (p.ciStatus === "failing" || p.reviewDecision === "changes_requested")
    return "bg-[var(--color-status-error)]";
  if (p.isDraft) return "bg-[var(--color-text-muted)]";
  if (p.ciStatus === "passing") return "bg-[var(--color-status-merge)]";
  if (p.ciStatus === "pending") return "bg-[var(--color-status-pending)]";
  return "bg-[var(--color-text-tertiary)] opacity-30";
}

/** Tailwind bg+text classes for a PR status chip. */
export function getPRChipColorClass(p: DashboardPR): string {
  if (!p.enriched)
    return "bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)]";
  if (p.state === "merged")
    return "bg-[color-mix(in_srgb,var(--color-status-merge)_15%,transparent)] text-[var(--color-status-merge)]";
  if (p.state === "closed")
    return "bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)]";
  if (p.ciStatus === "failing" || p.reviewDecision === "changes_requested")
    return "bg-[color-mix(in_srgb,var(--color-status-error)_15%,transparent)] text-[var(--color-status-error)]";
  if (p.isDraft)
    return "bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)]";
  if (p.ciStatus === "passing")
    return "bg-[color-mix(in_srgb,var(--color-status-merge)_15%,transparent)] text-[var(--color-status-merge)]";
  if (p.ciStatus === "pending")
    return "bg-[color-mix(in_srgb,var(--color-status-pending)_15%,transparent)] text-[var(--color-status-pending)]";
  return "bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)]";
}

/** Short human label for a PR's current state (empty when unenriched). */
export function getPRStatusLabel(p: DashboardPR): string {
  if (!p.enriched) return "";
  if (p.state === "merged") return "merged";
  if (p.state === "closed") return "closed";
  if (p.ciStatus === "failing") return "CI failing";
  if (p.reviewDecision === "changes_requested") return "changes requested";
  if (p.isDraft) return "draft";
  if (p.reviewDecision === "approved") return "approved";
  if (p.ciStatus === "passing") return "needs review";
  if (p.ciStatus === "pending") return "CI running";
  return "";
}
