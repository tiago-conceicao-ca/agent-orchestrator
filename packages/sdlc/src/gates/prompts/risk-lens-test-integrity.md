# Risk Lens — Test Integrity

Review the final diff for test integrity.

## Focus

- Do tests assert real behavior (not tautologies / always-true)?
- Are critical paths and the acceptance criteria actually covered?
- Any skipped/disabled tests, or tests weakened to pass?
- Flaky patterns (timing, ordering, shared state).

## Steps

1. Read the final diff in the worktree at `{artifact}`.
2. Identify test-integrity risks (review only — do NOT fix).
3. Output exactly one JSON verdict object as your final message:

```json
{"type":"risk_lens","lens":"test_integrity","issues":[],"verdict":"pass"}
```

```json
{"type":"risk_lens","lens":"test_integrity","issues":[{"severity":"medium","title":"X","detail":"Y"}],"verdict":"needs_fixes"}
```
