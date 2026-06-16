#!/usr/bin/env bash
#
# migrate-ao-to-cahi.sh — migrate an existing Agent Orchestrator (ao) install to CAHI.
#
# CAHI (Conta Azul Hub for Intelligence) is the rebrand of Agent Orchestrator.
# The rebrand is a hard rename with no in-code backward compatibility, so this
# script moves and rewrites your on-disk data:
#
#   ~/.agent-orchestrator        -> ~/.cahi            (sessions, worktrees, archive,
#                                                       running.json, last-stop.json,
#                                                       config.yaml, hash dirs)
#   ~/.config/agent-orchestrator -> ~/.config/cahi     (XDG global config)
#   ~/.ao/bin                    -> ~/.cahi/bin         (gh/git PATH wrappers)
#
# It also renames each registered project's `agent-orchestrator.yaml` -> `cahi.yaml`
# and rewrites old home-path references inside CAHI's own config/metadata files.
#
# The script is idempotent: re-running it after a successful migration is a no-op.
# It always takes a backup before changing anything. Run with --dry-run first to
# preview every action without touching the filesystem.
#
# Usage:
#   scripts/migrate-ao-to-cahi.sh [--dry-run] [--yes] [--no-backup]
#
# Options:
#   --dry-run     Print what would happen without modifying anything.
#   --yes, -y     Do not prompt for confirmation.
#   --no-backup   Skip the pre-migration backup (not recommended).
#   --help, -h    Show this help.

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────

HOME_DIR="${HOME:?HOME is not set}"

AO_DATA="${HOME_DIR}/.agent-orchestrator"
CAHI_DATA="${HOME_DIR}/.cahi"

XDG_BASE="${XDG_CONFIG_HOME:-${HOME_DIR}/.config}"
AO_XDG="${XDG_BASE}/agent-orchestrator"
CAHI_XDG="${XDG_BASE}/cahi"

AO_BIN="${HOME_DIR}/.ao/bin"
CAHI_BIN="${CAHI_DATA}/bin"

DRY_RUN=0
ASSUME_YES=0
DO_BACKUP=1

# ─── Logging helpers ──────────────────────────────────────────────────────────

log() { printf '  %s\n' "$*"; }
info() { printf '\033[36m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*" >&2; }
err() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; }
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }

# run <description> <command...> — execute (or, in dry-run, only print) a mutation.
run() {
  local desc="$1"
  shift
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    log "[dry-run] ${desc}"
  else
    log "${desc}"
    "$@"
  fi
}

usage() {
  sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
}

# ─── Argument parsing ─────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    -y | --yes) ASSUME_YES=1 ;;
    --no-backup) DO_BACKUP=0 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      err "Unknown argument: $1"
      usage
      exit 2
      ;;
  esac
  shift
done

# ─── Portable in-place sed ────────────────────────────────────────────────────
# BSD (macOS) and GNU sed disagree on `-i`; write through a temp file instead.

sed_inplace() {
  local expr="$1" file="$2" tmp
  tmp="$(mktemp)"
  sed "${expr}" "${file}" > "${tmp}"
  if ! cmp -s "${tmp}" "${file}"; then
    cat "${tmp}" > "${file}"
  fi
  rm -f "${tmp}"
}

# ─── Pre-flight ───────────────────────────────────────────────────────────────

info "CAHI migration (Agent Orchestrator -> CAHI)"
if [[ "${DRY_RUN}" -eq 1 ]]; then
  warn "Running in --dry-run mode: no files will be changed."
fi

# Refuse to run while a dashboard/orchestrator may still be live, to avoid moving
# data out from under a running process. running.json marks an active install.
for running_marker in "${AO_DATA}/running.json" "${CAHI_DATA}/running.json"; do
  if [[ -f "${running_marker}" ]]; then
    warn "Found ${running_marker} — an instance may be running."
    warn "Stop it first (\`ao stop\` / \`cahi stop\`, or quit \`ao start\`) before migrating."
  fi
done

NOTHING_TO_DO=1
[[ -e "${AO_DATA}" ]] && NOTHING_TO_DO=0
[[ -e "${AO_XDG}" ]] && NOTHING_TO_DO=0
[[ -e "${AO_BIN}" ]] && NOTHING_TO_DO=0

if [[ "${NOTHING_TO_DO}" -eq 1 ]]; then
  ok "No legacy Agent Orchestrator data found — nothing to migrate."
  log "Looked for: ${AO_DATA}, ${AO_XDG}, ${AO_BIN}"
  exit 0
fi

info "Planned moves:"
[[ -e "${AO_DATA}" ]] && log "${AO_DATA}  ->  ${CAHI_DATA}"
[[ -e "${AO_XDG}" ]] && log "${AO_XDG}  ->  ${CAHI_XDG}"
[[ -e "${AO_BIN}" ]] && log "${AO_BIN}  ->  ${CAHI_BIN}"

if [[ "${DRY_RUN}" -eq 0 && "${ASSUME_YES}" -eq 0 ]]; then
  printf '\nProceed with migration? [y/N] '
  read -r reply
  case "${reply}" in
    y | Y | yes | YES) ;;
    *)
      err "Aborted."
      exit 1
      ;;
  esac
fi

# ─── Backup ───────────────────────────────────────────────────────────────────

if [[ "${DO_BACKUP}" -eq 1 ]]; then
  STAMP="$(date +%Y%m%d-%H%M%S)"
  BACKUP_DIR="${HOME_DIR}/.cahi-migration-backup-${STAMP}"
  info "Backing up legacy data to ${BACKUP_DIR}"
  run "create ${BACKUP_DIR}" mkdir -p "${BACKUP_DIR}"
  for src in "${AO_DATA}" "${AO_XDG}" "${HOME_DIR}/.ao"; do
    if [[ -e "${src}" ]]; then
      base="$(basename "${src}")"
      run "archive ${src}" tar -czf "${BACKUP_DIR}/${base}.tar.gz" -C "$(dirname "${src}")" "${base}"
    fi
  done
  ok "Backup complete (delete ${BACKUP_DIR} once you've verified CAHI works)."
else
  warn "Skipping backup (--no-backup)."
fi

# ─── Move a tree, merging into an existing destination ──────────────────────────
# move_tree <src> <dest>: if dest does not exist, rename; otherwise copy contents
# in (without clobbering newer dest files) and remove the source.

# merge_dir <src> <dest>: copy src contents into dest without overwriting existing
# dest files (so a partial CAHI install wins), including dotfiles.
merge_dir() {
  local src="$1" dest="$2"
  mkdir -p "${dest}"
  cp -Rn "${src}/." "${dest}/" 2>/dev/null || cp -R "${src}/." "${dest}/"
}

move_tree() {
  local src="$1" dest="$2"
  if [[ ! -e "${src}" ]]; then
    return 0
  fi
  if [[ -e "${dest}" ]]; then
    warn "${dest} already exists — merging ${src} into it."
    run "merge ${src} -> ${dest}" merge_dir "${src}" "${dest}"
    run "remove ${src}" rm -rf "${src}"
  else
    run "mkdir -p $(dirname "${dest}")" mkdir -p "$(dirname "${dest}")"
    run "move ${src} -> ${dest}" mv "${src}" "${dest}"
  fi
}

# ─── 1. Move the main data directory ────────────────────────────────────────────

info "Migrating data directory"
move_tree "${AO_DATA}" "${CAHI_DATA}"

# ─── 2. Move the XDG global config ──────────────────────────────────────────────

info "Migrating XDG config directory"
move_tree "${AO_XDG}" "${CAHI_XDG}"

# ─── 3. Move the PATH-wrapper bin directory ─────────────────────────────────────

info "Migrating PATH-wrapper bin directory"
move_tree "${AO_BIN}" "${CAHI_BIN}"

# ─── 4. Rewrite old home-path references inside CAHI config/metadata ─────────────
# Rewrites ~/.agent-orchestrator -> ~/.cahi and ~/.ao/bin -> ~/.cahi/bin inside
# CAHI's own config and session-metadata files. The worktrees/ subtree is skipped
# (those are live git checkouts; their working files must not be touched).

rewrite_paths_in() {
  local root="$1"
  [[ -d "${root}" ]] || return 0
  info "Rewriting path references under ${root}"
  while IFS= read -r -d '' file; do
    if [[ "${DRY_RUN}" -eq 1 ]]; then
      if grep -qE '\.agent-orchestrator|/\.ao/bin' "${file}" 2>/dev/null; then
        log "[dry-run] rewrite paths in ${file}"
      fi
    else
      sed_inplace 's#/\.ao/bin#/.cahi/bin#g; s#\.agent-orchestrator#.cahi#g' "${file}"
    fi
  done < <(
    find "${root}" \
      -type d -name worktrees -prune -o \
      -type f \( -name '*.json' -o -name '*.yaml' -o -name '*.yml' \) -print0
  )
}

rewrite_paths_in "${CAHI_DATA}"
rewrite_paths_in "${CAHI_XDG}"

# ─── 5. Rename each registered project's config file ────────────────────────────
# Project checkout paths live under `path:` keys in the global config. For each,
# rename agent-orchestrator.yaml/.yml -> cahi.yaml/.yml if present.

rename_project_configs() {
  local global_config="$1"
  [[ -f "${global_config}" ]] || return 0
  info "Renaming registered project config files (from ${global_config})"
  local raw expanded ao_yaml ao_yml
  # Extract `path:` values; tolerate quotes and surrounding whitespace.
  while IFS= read -r raw; do
    [[ -n "${raw}" ]] || continue
    # Expand a leading ~ to $HOME.
    expanded="${raw/#\~/${HOME_DIR}}"
    ao_yaml="${expanded}/agent-orchestrator.yaml"
    ao_yml="${expanded}/agent-orchestrator.yml"
    if [[ -f "${ao_yaml}" ]]; then
      run "rename ${ao_yaml} -> ${expanded}/cahi.yaml" mv "${ao_yaml}" "${expanded}/cahi.yaml"
    fi
    if [[ -f "${ao_yml}" ]]; then
      run "rename ${ao_yml} -> ${expanded}/cahi.yml" mv "${ao_yml}" "${expanded}/cahi.yml"
    fi
  done < <(
    grep -E '^[[:space:]]+path:[[:space:]]*' "${global_config}" 2>/dev/null \
      | sed -E 's/^[[:space:]]+path:[[:space:]]*//; s/^["'"'"']//; s/["'"'"']$//' \
      | sort -u
  )
}

rename_project_configs "${CAHI_XDG}/config.yaml"
rename_project_configs "${CAHI_DATA}/config.yaml"

# ─── 6. Git worktree note ───────────────────────────────────────────────────────

if [[ -d "${CAHI_DATA}" ]] && find "${CAHI_DATA}" -type d -name worktrees -print -quit | grep -q .; then
  warn "Moved git worktrees may need their gitdir links repaired."
  log "If the dashboard cannot find a session's worktree, either re-spawn the"
  log "session, or run \`git worktree repair\` inside the project's main checkout."
fi

# ─── 7. Shell-rc hints (documented, not auto-edited) ────────────────────────────

info "Shell configuration"
log "If you export any AO_* environment variables in your shell rc"
log "(~/.zshrc, ~/.bashrc, ~/.config/fish/config.fish, …), rename them to CAHI_*:"
log "    AO_SHELL      -> CAHI_SHELL"
log "    AO_CONFIG_PATH-> CAHI_CONFIG_PATH"
log "    AO_PORT       -> CAHI_PORT"
log "    AO_*          -> CAHI_*   (every AO_ prefix becomes CAHI_)"
log "Also update any PATH entry that points at ~/.ao/bin to ~/.cahi/bin."
warn "This script does not edit your shell rc — make these changes by hand."

# ─── 8. Reinstall the CLI ────────────────────────────────────────────────────────

info "Reinstall the CLI"
log "The command is now \`cahi\` (was \`ao\`). Reinstall it:"
log "    npm install -g @contaazul/cahi"
log "Then verify:    cahi --version  &&  cahi start"
log "The default dashboard port is now 4000 (was 3000)."

# ─── Done ───────────────────────────────────────────────────────────────────────

if [[ "${DRY_RUN}" -eq 1 ]]; then
  ok "Dry run complete. Re-run without --dry-run to apply."
else
  ok "Migration complete. Your CAHI data lives under ${CAHI_DATA}."
fi
