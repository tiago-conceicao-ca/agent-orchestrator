# Implement Lens — Initial Implementation

Implement the task in your current worktree. This is the FIRST pass; later
review passes will read your diff and harden it, so focus on a correct,
complete first cut that satisfies the acceptance criteria.

## Steps

1. Read the task context provided above (title, summary, acceptance criteria).
2. Implement the change in the worktree at `{artifact}`.
   - Write the minimum code that satisfies every acceptance criterion.
   - If the task says to use TDD, write the failing tests first, then the code.
   - Keep the change surgical; match the surrounding code's style.
3. Verify your own work: build, typecheck, and run the relevant tests.
4. Commit your work.

## Verdict

After implementing, report a structured verdict:

- `pass`: the task is implemented and your self-checks (build/typecheck/tests) succeed.
- `needs_fixes`: you could not complete the implementation or a self-check fails;
  list each blocker as an issue so the next attempt can address it.

Severity: `high` (blocks the task), `medium` (works but incomplete), `low` (note).

Output exactly one JSON object as your verdict:

```json
{"type":"implement_lens","lens":"initial","issues":[],"verdict":"pass"}
```

If blocked, list the blockers:

```json
{"type":"implement_lens","lens":"initial","issues":[{"severity":"high","title":"Blocker","detail":"What failed and why"}],"verdict":"needs_fixes"}
```
