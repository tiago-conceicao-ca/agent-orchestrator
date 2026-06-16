# Risk Review — Triage

You are given a consolidated synthesis verdict. Decide which confirmed issues
warrant a follow-up FIX task. Be conservative: only open fix tasks for issues
that are real, in-scope, and worth fixing now.

## Steps

1. Read the synthesis findings provided in your prompt.
2. For each issue that warrants a fix, emit a fix task with a concise title.
3. Output exactly one JSON object as your final message:

```json
{"fixTasks":[{"title":"Fix: <short>","issue":{"severity":"high","title":"X","detail":"Y"}}]}
```

If nothing warrants a fix task, output:

```json
{"fixTasks":[]}
```
