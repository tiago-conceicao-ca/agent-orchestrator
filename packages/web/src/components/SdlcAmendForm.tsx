"use client";

import { useState } from "react";

// Append-only "amend plan" control: add a comment that is appended to the run's
// plan and persisted immediately (no re-run). Prominent when a lens returned
// needs_fixes — the user reads the surfaced issues, then leaves a comment that
// the orchestrator picks up on the next Resume.

export function SdlcAmendForm({
  needsFixes,
  busy,
  onSave,
}: {
  needsFixes: boolean;
  busy: boolean;
  onSave: (comment: string) => void;
}) {
  const [comment, setComment] = useState("");
  const trimmed = comment.trim();

  const save = () => {
    if (!trimmed || busy) return;
    onSave(trimmed);
    setComment("");
  };

  return (
    <section className="sdlc-amend" data-needs-fixes={needsFixes ? "true" : "false"}>
      <h2 className="sdlc-amend__title">Amend plan</h2>
      <p className="sdlc-amend__hint">
        {needsFixes
          ? "A lens requested changes. Add a comment to the plan — it's appended now and applied on the next Resume."
          : "Add a comment to the plan — it's appended now and applied on the next Resume."}
      </p>
      <textarea
        className="sdlc-amend__input"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Extra instructions for the plan…"
        rows={3}
        disabled={busy}
        aria-label="Plan comment"
      />
      <div className="sdlc-amend__actions">
        <button
          type="button"
          className="dashboard-app-btn dashboard-app-btn--primary"
          disabled={busy || !trimmed}
          onClick={save}
        >
          {busy ? "Saving…" : "Save comment"}
        </button>
      </div>
    </section>
  );
}
