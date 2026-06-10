# Plano — Sibling repos de primeira-classe (implementação do #1095)

## Objetivo
Transformar o workaround do #1095 (`git worktree add ~/.worktrees/<repo>/<sessão> <branch>`) numa feature de primeira-classe:
1. **CLI** — comando pra adicionar/remover/listar sibling repos de uma sessão.
2. **Web** — botão no sidebar pra adicionar sibling (chama o CLI/core por baixo).
3. **Sidebar** — visualização dos siblings montados por sessão + o catálogo de siblings que o orchestrator tem disponível.

Em vez de instrução no prompt do orchestrator → vira mecanismo real, rastreado e visível.

## Precedente que vamos copiar
O #1821 já fez exatamente esse padrão pra PRs: `Session.prs: PRInfo[]` persistido na metadata (campo comma-separated), espelhado em `DashboardSession.prs`, renderizado no card. **`siblings` segue o mesmo molde.**

## Conceito: catálogo (disponível) × montado (por sessão)
- **Catálogo** (nível orchestrator/projeto): repos que PODEM ser montados como sibling. Default = outros projetos registrados (cada um é um repo git com `path`).
- **Montado** (por sessão): um worktree isolado daquele repo, criado sob demanda, gravado na metadata da sessão.
- Isolamento **por sessão** evita a colisão que o #1095 descreve.

## Modelo de dados
```ts
// types.ts
interface SiblingRef {
  repo: string;        // projectId ou owner/name do repo fonte
  path: string;        // worktree isolado: {worktreeDir}/{projectId}/{sessionId}__sib__{name}
  branch: string;      // default = defaultBranch do projeto fonte (ex: master)
  mode: "worktree" | "readonly-symlink"; // worktree (escrita) ou symlink (ref read-only, ex: ca-starters-front)
}
interface Session { /* ... */ siblings: SiblingRef[]; }  // metadata-backed, igual a prs[]
```

## Fases

### Fase 0 — Modelo & metadata (core)
- `types.ts`: `SiblingRef` + `Session.siblings`.
- `session-from-metadata` / `session-manager`: ler/gravar `siblings` na metadata (espelhar o padrão `prs`).
- Catálogo de siblings disponíveis: derivar dos projetos registrados (config) — opcional: campo `siblings:` por projeto pra restringir candidatos.
- Verify: testes de parse/round-trip de `siblings`; catálogo derivado dos projetos.

### Fase 1 — Core: criar/remover worktree de sibling
- `addSibling(sessionId, repoOrProjectId, branch?)`: resolve o `path` do repo fonte (do projeto registrado) → `git worktree add {managed-path} {branch}` → grava `SiblingRef` na metadata da sessão.
- `removeSibling(sessionId, repo)`: `git worktree remove` + tira da metadata.
- **Cleanup no kill**: ao matar a sessão, remover seus worktrees de sibling (best-effort), como o worktree primário.
- (Opcional) `mode: readonly-symlink` → cria symlink em vez de worktree (pra refs read-only tipo ca-starters-front).
- Reusa o `workspace-worktree` (mesmas funções de criação/limpeza/stale-path).
- Verify: add cria worktree isolado + grava metadata; remove limpa; kill remove os siblings; colisão entre 2 sessões paralelas não acontece.

### Fase 2 — CLI
- `ao session sibling add <sessionId> <repo> [--branch <ref>] [--readonly]`
- `ao session sibling ls <sessionId>`
- `ao session sibling rm <sessionId> <repo>`
- (resolve repo via projetos registrados; chama o core)
- Verify: add/ls/rm via CLI; erros claros (repo desconhecido, sessão inexistente).

### Fase 3 — Web API
- `POST /api/sessions/[id]/siblings` (add), `DELETE` (remove), `GET` (list) → chamam o core.
- `siblings` flui pra `DashboardSession` via `serialize.ts` (igual a `prs`).
- Verify: rotas add/list/remove; `DashboardSession.siblings` populado.

### Fase 4 — Sidebar UI
- Sob cada **sessão**: lista os siblings montados (repo + branch + estado).
- Botão **"+ sibling"** na sessão → picker do catálogo disponível → `POST .../siblings`.
- Sob o **orchestrator**: visualização do **catálogo** de siblings disponíveis (o que dá pra montar).
- Verify: botão monta sibling e ele aparece sob a sessão; catálogo listado; remove via UI.

### Fase 5 — `ao start` (catálogo, não worktree compartilhado)
- No `ao start`, estabelecer/detectar o **catálogo** de siblings disponíveis (declaração/config) — NÃO criar um worktree compartilhado (isso recriaria a colisão do #1095).
- (Opcional) montar siblings **read-only** pro orchestrator (leitura estável, a dor "orchestrator lê checkout stale" do #1095).
- Verify: catálogo disponível após start; nenhum worktree de worker criado no start.

## Fora do V1 (explícito)
- **Lifecycle de PR multi-repo (#1477)**: o PR aberto no sibling NÃO é trackeado automaticamente ainda. (`prs[]` do #1821 guarda múltiplos PRs, mas o matching cross-repo do lifecycle é o #1477.) Mencionar a relação.
- (Adjacency `../sibling` está EM ESCOPO — ver Decisão 3.)

## Arquivos tocados
- `packages/core/src/types.ts` (`SiblingRef`, `Session.siblings`)
- `packages/core/src/session-manager.ts` + `utils/session-from-metadata.ts` (persistência + add/removeSibling)
- `packages/plugins/workspace-worktree/src/index.ts` (reuso de criação/limpeza de worktree)
- `packages/cli/src/commands/session.ts` (subcomando `sibling`)
- `packages/web/src/app/api/sessions/[id]/siblings/route.ts` (novo)
- `packages/web/src/lib/types.ts` + `serialize.ts` (`DashboardSession.siblings`)
- `packages/web/src/components/ProjectSidebar.tsx` (+ `SessionCard`/`SessionDetail`) (viz + botão)
- Testes em cada pacote.

## Decisões (aprovadas 2026-06-10)
1. **Catálogo de siblings** = **projetos registrados** (o `path` de cada projeto é a fonte do `git worktree add`).
2. **Namespace CLI** = **`ao session sibling …`**.
3. **Symlink de adjacência `../sibling` = SIM (em escopo).** Todo sibling em `mode: worktree` ganha, além do worktree isolado, uma adjacência por-sessão de modo que ferramentas (pattern-library) o encontrem como `../{name}` relativo ao cwd da sessão — sem colisão entre sessões paralelas. `mode: readonly-symlink` = só symlink (sem worktree), pra refs read-only (ex: ca-starters-front).
4. **`ao start`** = só estabelece o catálogo disponível (não cria worktree de worker no start).

## Entrega
É a **implementação do #1095** (linkar lá). Independente do PR do SDLC → **PR próprio**. Via worker(s) — sugiro Fase 0+1 num worker, Fase 2 noutro, Fase 3+4 noutro, com review entre eles.

---

## Status de implementação (esta PR — Fases 0 + 1)

Esta PR entrega a **fundação** do #1095: o modelo de dados e o núcleo (core). CLI, Web e `ao start` (Fases 2–5) ficam para PRs subsequentes.

**Entregue:**
- **Fase 0 (modelo & metadata):** `SiblingRef` + `Session.siblings` em `types.ts`; persistência metadata-backed espelhando `prs` (#1821) — `siblings` é um único campo de metadata JSON-encoded (`SiblingRef` é estruturado, então JSON em vez do CSV de `prs`), parseado no load (`utils/siblings.ts` → `parseSiblings`/`serializeSiblings`) e gravado junto. Back-compat total: sessões antigas sem `siblings` carregam como `[]`.
- **Fase 1 (core add/remove):**
  - `addSibling(sessionId, repoOrProjectId, opts?)` — resolve a fonte no catálogo (projetos registrados, por id ou `owner/name`); `mode: "worktree"` (default) faz `git worktree add` num caminho isolado por sessão `{worktreeDir}/{sessionId}__sib__{name}` reusando o plugin `workspace-worktree` (stale-path cleanup, base-ref, fetch, recovery). Branch default = branch única por sessão (`sib/{sessionId}/{name}`) baseada no defaultBranch da fonte — necessária porque o git recusa um segundo worktree na mesma branch já checada-out, e garante zero colisão entre sessões paralelas. `opts.branch` sobrescreve. `mode: "readonly-symlink"` cria só um symlink (junction no Windows) pro repo fonte.
  - `removeSibling(sessionId, repo)` — `workspace.destroy` (worktree) ou unlink (symlink) + remove da metadata.
  - **Cleanup no kill** — `kill()` remove os worktrees/symlinks de sibling da sessão (best-effort), igual ao worktree primário; metadata é preservada (sessão é terminada, não editada).

**Testes (TDD):** round-trip de metadata + back-compat; `addSibling` cria worktree isolado no caminho por-sessão; duas sessões paralelas montando o mesmo repo recebem worktrees DIFERENTES (sem colisão); `removeSibling` limpa; kill remove os siblings; `readonly-symlink` cria symlink e não worktree.

**EM ABERTO — bifurcação de layout da adjacência (Decisão 3):** a adjacência `../{name}` ainda NÃO foi implementada. O worktree primário da AO vive em `{worktreeDir}/{sessionId}/` cujo PARENT é compartilhado entre sessões, então um `../{name}` ingênuo colidiria. As opções de layout (per-session sibling-root de symlinks vs. cwd montado vs. symlink dentro do primário) estão sob decisão antes de implementar essa parte.
