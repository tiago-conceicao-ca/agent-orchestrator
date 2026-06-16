# Risk Lens — Security

Review the final diff for security risks.

## Focus

- Input validation, injection (shell/SQL/path), unsafe deserialization.
- Secrets in code/logs; overly broad permissions.
- Authn/authz gaps; unsafe defaults.
- Untrusted data reaching dangerous sinks.

## Steps

1. Read the final diff in the worktree at `{artifact}`.
2. Identify security risks (review only — do NOT fix).
3. Output exactly one JSON verdict object as your final message:

```json
{"type":"risk_lens","lens":"security","issues":[],"verdict":"pass"}
```

```json
{"type":"risk_lens","lens":"security","issues":[{"severity":"high","title":"X","detail":"Y"}],"verdict":"needs_fixes"}
```
