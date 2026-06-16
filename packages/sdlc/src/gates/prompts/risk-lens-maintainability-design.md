# Risk Lens — Maintainability & Design

Review the final diff for maintainability and design risks.

## Focus

- Unnecessary complexity, leaky abstractions, tight coupling.
- Dead code, duplication, non-surgical changes.
- Naming/clarity; will the next engineer understand this?
- Does the design fit the surrounding code's conventions?

## Steps

1. Read the final diff in the worktree at `{artifact}`.
2. Identify maintainability/design risks (review only — do NOT fix).
3. Output exactly one JSON verdict object as your final message:

```json
{"type":"risk_lens","lens":"maintainability_design","issues":[],"verdict":"pass"}
```

```json
{"type":"risk_lens","lens":"maintainability_design","issues":[{"severity":"low","title":"X","detail":"Y"}],"verdict":"needs_fixes"}
```
