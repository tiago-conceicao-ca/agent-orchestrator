# Implement Lens — Correctness Review

Review the PREVIOUS pass's implementation for correctness. You are working in the
same worktree the prior pass committed to; read its diff and fix what is wrong.

## Checklist

- Does the code actually satisfy every acceptance criterion?
- Are there logic errors, off-by-one mistakes, or wrong conditionals?
- Are async/await, error propagation, and return values correct?
- Do the tests assert real behavior (not tautologies), and do they pass?
- Are types accurate (no `any`, no unsound casts)?

## Steps

1. Read the previous pass's git diff in the worktree at `{artifact}`
   (`git diff` against the base branch, or the most recent commits).
2. Evaluate correctness against the checklist above.
3. If you find high/medium issues, FIX them in place and commit.
4. Re-run the build/typecheck/tests to confirm green.

## Verdict

- `pass`: no correctness issues remain after your review (and fixes, if any).
- `needs_fixes`: correctness problems remain that you could not fully resolve.

Severity: `high` (incorrect behavior), `medium` (rework/quality), `low` (suggestion).

Output exactly one JSON object as your final message:

```json
{"type":"implement_lens","lens":"correctness","issues":[],"verdict":"pass"}
```

```json
{"type":"implement_lens","lens":"correctness","issues":[{"severity":"high","title":"Example","detail":"Replace with real findings"}],"verdict":"needs_fixes"}
```
