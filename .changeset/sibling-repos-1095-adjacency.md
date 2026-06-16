---
"@contaazul/cahi-core": minor
---

feat(core): per-session adjacency view for sibling repos (#1095)

Completes Phase 1 of first-class sibling repos: the `../{name}` adjacency (Decision 3 / Option 1).

Each session gets its own assembled-view dir at `{worktreeDir}/{sessionId}__ws/` holding directory symlinks named by the **real repo name** — the primary worktree under the primary repo's name, and each worktree-mode sibling under its source repo's name. Sibling-aware tools (e.g. pattern-library) run with `cwd = {sessionId}__ws/{primaryRepoName}`, from which `../{siblingRepoName}` resolves to that sibling's isolated worktree. The per-session `__ws` dir means two parallel sessions never collide.

- The view + primary symlink are created lazily on the first worktree-mode `addSibling`; the sibling's symlink is added in `addSibling` and removed in `removeSibling`.
- `kill()` removes the whole `__ws` dir best-effort (only the symlinks — the worktrees they point at are torn down separately).
- Windows uses junctions (same mechanism as readonly-symlink siblings).
- The assembled primary-view path is exposed on `Session.assembledViewPath` (metadata-backed; `null` until the first worktree-mode sibling is mounted).
