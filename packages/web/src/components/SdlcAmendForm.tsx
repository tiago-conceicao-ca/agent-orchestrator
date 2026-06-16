"use client";

import { useState } from "react";

// "Amend & re-run" control on the per-run detail page: append extra instructions
// to the run's plan and re-run normalize + lens in place. Prominent when a lens
// returned needs_fixes — the user reads the surfaced issues, then amends.

export function SdlcAmendForm({
  needsFixes,
  busy,
  onSubmit,
}: {
  needsFixes: boolean;
  busy: boolean;
  onSubmit: (comment: string) => void;
}) {
  const [comment, setComment] = useState("");
  const trimmed = comment.trim();

  const submit = () => {
    if (!trimmed || busy) return;
    onSubmit(trimmed);
    setComment("");
  };

  return (
    <section className="sdlc-amend" data-needs-fixes={needsFixes ? "true" : "false"}>
      <h2 className="sdlc-amend__title">Amend &amp; re-run</h2>
      <p className="sdlc-amend__hint">
        {needsFixes
          ? "A lens requested changes. Add instructions and re-run normalize + lens in place."
          : "Append instructions and re-run normalize + lens in place (same run)."}
      </p>
      <textarea
        className="sdlc-amend__input"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Extra instructions for the re-run…"
        rows={3}
        disabled={busy}
        aria-label="Amendment instructions"
      />
      <div className="sdlc-amend__actions">
        <button
          type="button"
          className="dashboard-app-btn dashboard-app-btn--primary"
          disabled={busy || !trimmed}
          onClick={submit}
        >
          {busy ? "Re-running…" : "Re-run"}
        </button>
      </div>
    </section>
  );
}
