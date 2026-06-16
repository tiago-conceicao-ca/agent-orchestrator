# Implement Lens — Simplicity Review

Review the PREVIOUS pass's implementation for unnecessary complexity. You share
the worktree; read the diff and simplify without changing behavior.

## Checklist

- Dead code, unused variables/imports, unreachable branches.
- Over-abstraction: indirection, configuration, or "flexibility" not asked for.
- Duplicated logic that should be shared; logic that could reuse existing helpers.
- Could 200 lines be 50? Is there a clearer, smaller way to express the intent?
- Does the change touch more than it needs to (non-surgical edits)?

## Steps

1. Read the previous pass's git diff in the worktree at `{artifact}`.
2. Identify complexity that can be removed safely.
3. SIMPLIFY in place — keeping all tests green — then commit.
4. Re-run the build/typecheck/tests to confirm behavior is unchanged.

## Verdict

- `pass`: the implementation is appropriately simple (after your edits, if any).
- `needs_fixes`: meaningful complexity remains that you could not safely remove.

Severity: `high` (unmaintainable), `medium` (notable bloat), `low` (suggestion).

Output exactly one JSON object as your final message:

```json
{"type":"implement_lens","lens":"simplicity","issues":[],"verdict":"pass"}
```

```json
{"type":"implement_lens","lens":"simplicity","issues":[{"severity":"low","title":"Example","detail":"Replace with real findings"}],"verdict":"needs_fixes"}
```
