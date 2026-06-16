---
"@contaazul/cahi-core": minor
---

feat(core): foundation for first-class sibling repos (#1095)

Adds the data model and core engine for mounting secondary "sibling" repos into a session, each as an isolated per-session git worktree (or a read-only symlink):

- `SiblingRef` type and `Session.siblings`, persisted metadata-backed (mirrors the `prs` pattern from #1821; JSON-encoded since `SiblingRef` is structured). Old sessions with no `siblings` field load as `[]`.
- `SessionManager.addSibling` / `removeSibling`: resolve the source from the registered-projects catalog, create an isolated per-session worktree at `{worktreeDir}/{sessionId}__sib__{name}` (no cross-session collision), and tear it down on removal.
- Sibling worktrees/symlinks are cleaned up best-effort when a session is killed, alongside the primary worktree.

CLI, Web, and `ao start` integration (and `../{name}` adjacency) land in follow-up PRs.
