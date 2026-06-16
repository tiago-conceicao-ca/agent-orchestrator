# Implement Lens — Edge Case Review

Review the PREVIOUS pass's implementation for unhandled edge cases. You share the
worktree; read the diff and harden the boundaries.

## Checklist

- Empty / null / undefined inputs, empty collections, zero and negative numbers.
- Boundary values (first/last, off-by-one, max length, overflow).
- Concurrency: races, re-entrancy, partial failure, retries.
- I/O failures: missing files, network errors, timeouts, permission errors.
- Are these edge cases covered by tests?

## Steps

1. Read the previous pass's git diff in the worktree at `{artifact}`.
2. Identify edge cases the implementation does not handle.
3. FIX the gaps in place — add guards and tests — then commit.
4. Re-run the build/typecheck/tests to confirm green.

## Verdict

- `pass`: edge cases are adequately handled (after your fixes, if any).
- `needs_fixes`: material edge-case gaps remain that you could not resolve.

Severity: `high` (crash / data loss), `medium` (degraded behavior), `low` (note).

Output exactly one JSON object as your final message:

```json
{"type":"implement_lens","lens":"edge_cases","issues":[],"verdict":"pass"}
```

```json
{"type":"implement_lens","lens":"edge_cases","issues":[{"severity":"medium","title":"Example","detail":"Replace with real findings"}],"verdict":"needs_fixes"}
```
