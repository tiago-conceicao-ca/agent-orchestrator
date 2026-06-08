# Plan Review Adversarial

Challenge assumptions and push for simpler, safer alternatives.

## Checklist

- Should this be built now, or is there a smaller move with better value?
- What assumptions are weak or unverified?
- What could fail in worst-case rollout scenarios?
- Where does the plan introduce premature complexity?

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
2. Evaluate from an adversarial lens against the checklist above. Be genuinely adversarial -- the plan has already passed tactical and architectural review. Your job is to find what those reviews were too polite to flag.
3. Output exactly one JSON object as your final message, with lens identification:

```json
{"type":"plan_review","lens":"adversarial","issues":[{"severity":"medium","title":"Example issue","detail":"Replace with real findings"}],"verdict":"needs_fixes"}
```

If no high or medium issues are found, output:

```json
{"type":"plan_review","lens":"adversarial","issues":[],"verdict":"pass"}
```
