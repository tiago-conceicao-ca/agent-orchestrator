# Plan Review Architectural

Evaluate architectural quality and integration fit.

## Checklist

- Does the plan align with existing codebase patterns?
- Is scope right-sized without accidental creep?
- Are integration points and migration concerns explicit?
- Are risks and rollback/mitigation concerns covered?

## Output Schema

Severity levels:
- `high`: Would cause implementation failure or incorrect behavior
- `medium`: Would degrade quality or cause rework
- `low`: Suggestion for improvement, not blocking

Verdict:
- `pass`: No high or medium issues found
- `needs_fixes`: At least one high or medium issue requires plan changes

## Steps

1. Read the full artifact from `{artifact}`.
   - Validate the path exists and is readable before use.
   - If missing/unreadable, report a `high` issue describing the unreadable artifact and return `needs_fixes`.
2. Evaluate architecture fitness and integration risk against the checklist above.
3. Output exactly one JSON object as your final message, with lens identification:

```json
{"type":"plan_review","lens":"architectural","issues":[{"severity":"high","title":"Example issue","detail":"Replace with real findings"}],"verdict":"needs_fixes"}
```

If no high or medium issues are found, output:

```json
{"type":"plan_review","lens":"architectural","issues":[],"verdict":"pass"}
```
