# Implement Lens — Production Hardening

The final pass. Review the PREVIOUS pass's implementation for production
readiness. You share the worktree; read the diff and raise it to a shippable bar.

## Checklist

- Error messages: actionable, with enough context to diagnose in production.
- Observability: are failures surfaced (logs/events) rather than swallowed?
- Resource safety: handles/connections closed, no leaks, bounded work.
- Security: input validation, no injection, no secrets in code or logs.
- Documentation: public APIs and non-obvious decisions explained.
- Test economy: meaningful coverage of the critical paths, no flaky tests.

## Steps

1. Read the previous pass's git diff in the worktree at `{artifact}`.
2. Identify production-readiness gaps.
3. HARDEN in place — fixes + tests — then commit.
4. Re-run the build/typecheck/tests to confirm green.

## Verdict

- `pass`: the change is production-ready (after your hardening, if any).
- `needs_fixes`: production-readiness gaps remain that you could not resolve.

Severity: `high` (unsafe to ship), `medium` (should fix before ship), `low` (note).

Output exactly one JSON object as your final message:

```json
{"type":"implement_lens","lens":"excellence","issues":[],"verdict":"pass"}
```

```json
{"type":"implement_lens","lens":"excellence","issues":[{"severity":"high","title":"Example","detail":"Replace with real findings"}],"verdict":"needs_fixes"}
```
