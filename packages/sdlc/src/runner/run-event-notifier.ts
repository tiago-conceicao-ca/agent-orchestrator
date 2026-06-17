/**
 * Wiring for the engine's pure `onRunEvent` seam: turn a RUN-level
 * {@link SdlcRunEvent} into the same three side-effects a worker session's
 * lifecycle transition produces, so the orchestrator no longer has to poll.
 *
 *   1. Notify the orchestrator session over the `cahi send` back-channel.
 *   2. Record an activity event (source `sdlc`) for the dashboard feed.
 *   3. Route an OrchestratorEvent to the project's notifiers by priority.
 *
 * All three are independent and best-effort: one failing never blocks the
 * others or the run. The engine stays pure — this lives in the app wiring
 * (shared by the CLI and the web dashboard) and pulls in the CAHI internals.
 */

import { randomUUID } from "node:crypto";
import {
  notifyOrchestrator,
  recordActivityEvent,
  resolveNotifierTarget,
  type ActivityEventLevel,
  type EventPriority,
  type EventType,
  type Notifier,
  type OrchestratorConfig,
  type OrchestratorEvent,
  type PluginRegistry,
  type ProjectConfig,
  type SessionManager,
} from "@contaazul/cahi-core";
import type { SdlcRunEvent } from "../workflow/types.js";

type RunEventKind = SdlcRunEvent["kind"];

/** awaiting_approval/needs_fixes need a decision → action; failures → warning. */
const KIND_PRIORITY: Record<RunEventKind, EventPriority> = {
  awaiting_approval: "action",
  needs_fixes: "action",
  completed: "info",
  failed: "warning",
  stalled: "warning",
};

const KIND_EVENT_TYPE: Record<RunEventKind, EventType> = {
  awaiting_approval: "sdlc.awaiting_approval",
  needs_fixes: "sdlc.needs_fixes",
  completed: "sdlc.completed",
  failed: "sdlc.failed",
  stalled: "sdlc.stalled",
};

const PRIORITY_LEVEL: Record<EventPriority, ActivityEventLevel> = {
  urgent: "warn",
  warning: "warn",
  action: "info",
  info: "info",
};

export interface SdlcRunEventNotifierDeps {
  /** Minimal SessionManager surface — only `send` is used (real manager satisfies it). */
  sessionManager: Pick<SessionManager, "send">;
  config: OrchestratorConfig;
  registry: PluginRegistry;
  projectId: string;
  project: Pick<ProjectConfig, "sessionPrefix">;
  /** Where session metadata lives — used to detect the orchestrator session. */
  sessionsDir: string;
}

/** Concise orchestrator-facing line: `[sdlc <runId>] <kind>: <detail> — /sdlc/<runId>`. */
function formatMessage(event: SdlcRunEvent): string {
  const detail = event.detail ? `: ${event.detail}` : "";
  return `[sdlc ${event.runId}] ${event.kind}${detail} — /sdlc/${event.runId}`;
}

/** Route an OrchestratorEvent to the notifiers configured for its priority. */
async function routeToNotifiers(
  deps: SdlcRunEventNotifierDeps,
  event: OrchestratorEvent,
): Promise<void> {
  const names = deps.config.notificationRouting[event.priority] ?? deps.config.defaults.notifiers;
  for (const name of names) {
    const target = resolveNotifierTarget(deps.config, name);
    const notifier =
      deps.registry.get<Notifier>("notifier", target.reference) ??
      deps.registry.get<Notifier>("notifier", target.pluginName);
    if (!notifier) continue;
    try {
      await notifier.notify(event);
    } catch {
      // Best-effort: a single notifier failure must not block the others.
    }
  }
}

/**
 * Build an `onRunEvent` handler for {@link EngineDeps}. Each of the three
 * channels is wrapped independently so one throwing never short-circuits the
 * rest, and the handler as a whole never throws back into the engine.
 */
export function makeSdlcRunEventHandler(
  deps: SdlcRunEventNotifierDeps,
): (event: SdlcRunEvent) => Promise<void> {
  return async (event: SdlcRunEvent): Promise<void> => {
    const message = formatMessage(event);
    const priority = KIND_PRIORITY[event.kind];

    // 1. Notify the orchestrator (the headline ask). Already best-effort.
    await notifyOrchestrator(deps.sessionManager, deps.project, deps.sessionsDir, message);

    // 2. Record an activity event for the dashboard feed.
    try {
      recordActivityEvent({
        projectId: deps.projectId,
        source: "sdlc",
        kind: `sdlc.${event.kind}`,
        level: PRIORITY_LEVEL[priority],
        summary: message,
        data: { runId: event.runId, phase: event.phase, detail: event.detail },
      });
    } catch {
      // recordActivityEvent is itself best-effort, but guard anyway.
    }

    // 3. Route to the project's human notifiers by priority.
    const orchestratorEvent: OrchestratorEvent = {
      id: randomUUID(),
      type: KIND_EVENT_TYPE[event.kind],
      priority,
      sessionId: event.runId, // SDLC runs aren't sessions; the run id correlates the feed.
      projectId: deps.projectId,
      timestamp: new Date(),
      message,
      data: { runId: event.runId, phase: event.phase, detail: event.detail },
    };
    await routeToNotifiers(deps, orchestratorEvent);
  };
}
