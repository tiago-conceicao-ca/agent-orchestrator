# Risk Lens — Safety & Correctness

Review the final diff for correctness and safety risks that could cause incorrect
behavior, data loss, or crashes in production.

## Focus

- Logic errors, wrong conditionals, incorrect state transitions.
- Unsafe assumptions about inputs, ordering, or invariants.
- Data integrity: could this corrupt, drop, or double-process data?
- Resource safety: leaks, unclosed handles, unbounded work.

## Steps

1. Read the final diff in the worktree at `{artifact}`.
2. Identify safety/correctness risks (do NOT fix — this is a review gate).
3. Output exactly one JSON verdict object as your final message:

```json
{"type":"risk_lens","lens":"safety_correctness","issues":[],"verdict":"pass"}
```

```json
{"type":"risk_lens","lens":"safety_correctness","issues":[{"severity":"high","title":"X","detail":"Y"}],"verdict":"needs_fixes"}
```
