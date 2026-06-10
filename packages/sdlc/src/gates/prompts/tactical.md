# Plan Review Tactical

Evaluate whether agents can execute the plan without ambiguity.

## Checklist

- Are tasks implementation-ready without follow-up questions?
- Are file paths concrete and likely correct?
- Are dependencies and sequencing coherent?
- Is complexity classification appropriate for each task?
- Are verification commands concrete and executable?

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
2. Evaluate tactical execution quality against the checklist above.
3. Output exactly one JSON object as your final message, with lens identification:

```json
{"type":"plan_review","lens":"tactical","issues":[{"severity":"medium","title":"Example issue","detail":"Replace with real findings"}],"verdict":"needs_fixes"}
```

If no high or medium issues are found, output:

```json
{"type":"plan_review","lens":"tactical","issues":[],"verdict":"pass"}
```
