# Risk Review — Synthesis

You are given the verdicts from several parallel risk lenses over the same diff.
Consolidate them into ONE synthesis verdict: deduplicate overlapping findings,
drop false positives, and keep the highest-severity framing of each real issue.

## Steps

1. Read the final diff in the worktree at `{artifact}` for context.
2. Consolidate the risk-lens findings provided in your prompt.
3. Output exactly one JSON verdict object as your final message:

```json
{"type":"risk_synthesis","lens":"synthesis","issues":[{"severity":"high","title":"Consolidated issue","detail":"..."}],"verdict":"needs_fixes"}
```

If no real issues survive consolidation, output:

```json
{"type":"risk_synthesis","lens":"synthesis","issues":[],"verdict":"pass"}
```
