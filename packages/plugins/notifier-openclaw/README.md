# notifier-openclaw

OpenClaw notifier plugin for CAHI escalation events.

## Quick setup

```bash
cahi setup openclaw
```

This interactive wizard auto-detects your OpenClaw gateway, lets you reuse or change the URL, OpenClaw config path, and routing values, then writes the CAHI config. For non-interactive use (e.g., in CI/CD pipelines or automation scripts):

```bash
cahi setup openclaw --url http://127.0.0.1:18789/hooks/agent --non-interactive
```

CAHI does not generate the token or write shell-profile exports. Local setup reads `hooks.token` from your OpenClaw config. For a remote OpenClaw gateway, you can pass `--token` and CAHI will store that token in `cahi.yaml`.

Useful follow-up commands:

```bash
cahi setup openclaw --refresh
cahi setup openclaw --status
```

Interactive setup asks which notification priorities OpenClaw should receive.
For scriptable setup, pass `--routing-preset urgent-only`, `urgent-action`, or
`all`.

## Required OpenClaw config (`openclaw.json`)

```json
{
  "hooks": {
    "enabled": true,
    "token": "<your-hooks-token>",
    "allowRequestSessionKey": true,
    "allowedSessionKeyPrefixes": ["hook:"]
  }
}
```

## CAHI config (`cahi.yaml`)

```yaml
notifiers:
  openclaw:
    plugin: openclaw
    url: http://127.0.0.1:18789/hooks/agent
    openclawConfigPath: ~/.openclaw/openclaw.json
```

## Behavior

- Sends `POST /hooks/agent` payloads with per-session key `hook:ao:<sessionId>`.
- Defaults `wakeMode: now` and `deliver: true`.
- Retries on `429` and `5xx` responses with exponential backoff.

## Token rotation

1. Rotate `hooks.token` in OpenClaw.
2. Restart OpenClaw so it picks up the new config.
3. Run `cahi setup openclaw --status` to verify the new token.

## Known limitation (Phase 0)

- OpenClaw hook ingest is not idempotent by default. Replayed webhook payloads are processed as separate runs.
- Owner: CAHI integration.
- Follow-up: add stable event id/idempotency key support.
