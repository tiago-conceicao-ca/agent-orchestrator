import type { Command } from "commander";
import chalk from "chalk";
import {
  createPluginRegistry,
  findConfigFile,
  loadConfig,
  resolveNotifierTarget,
  type OrchestratorConfig,
  type PluginRegistry,
  type PluginSlot,
} from "@contaazul/cahi-core";
import { runNotifyTest } from "../lib/notify-test.js";
import { runRepoScript } from "../lib/script-runner.js";
import { importPluginModuleFromSource } from "../lib/plugin-store.js";
import {
  detectInstallMethod,
  getCurrentVersion,
  getUpdateCommand,
  isVersionOutdated,
  readCachedUpdateInfo,
} from "../lib/update-check.js";

// ---------------------------------------------------------------------------
// Helpers — match the PASS / WARN / FAIL style of cahi-doctor.sh
// ---------------------------------------------------------------------------

function pass(msg: string): void {
  console.log(`${chalk.green("PASS")} ${msg}`);
}

function warn(msg: string): void {
  console.log(`${chalk.yellow("WARN")} ${msg}`);
}

/** Returns a fail() recorder and a count() getter — local per invocation, no shared state. */
function makeFailCounter(): { fail: (msg: string) => void; count: () => number } {
  let n = 0;
  return {
    fail(msg: string): void {
      n++;
      console.log(`${chalk.red("FAIL")} ${msg}`);
    },
    count(): number {
      return n;
    },
  };
}

type CheckedPluginSlot = Extract<
  PluginSlot,
  "runtime" | "agent" | "workspace" | "tracker" | "scm" | "notifier"
>;

interface PluginReference {
  slot: CheckedPluginSlot;
  pluginName: string;
  source: string;
}

async function loadPluginRegistry(config: OrchestratorConfig): Promise<PluginRegistry> {
  const registry = createPluginRegistry();
  await registry.loadFromConfig(config, importPluginModuleFromSource);
  return registry;
}

function addPluginReference(
  refs: PluginReference[],
  slot: CheckedPluginSlot,
  pluginName: string | undefined,
  source: string,
): void {
  if (!pluginName) return;
  refs.push({ slot, pluginName, source });
}

function collectPluginReferences(config: OrchestratorConfig): PluginReference[] {
  const refs: PluginReference[] = [];

  addPluginReference(refs, "runtime", config.defaults.runtime, "defaults.runtime");
  addPluginReference(refs, "agent", config.defaults.agent, "defaults.agent");
  addPluginReference(refs, "workspace", config.defaults.workspace, "defaults.workspace");
  addPluginReference(
    refs,
    "agent",
    config.defaults.orchestrator?.agent,
    "defaults.orchestrator.agent",
  );
  addPluginReference(refs, "agent", config.defaults.worker?.agent, "defaults.worker.agent");

  for (const notifierName of config.defaults.notifiers ?? []) {
    const target = resolveNotifierTarget(config, notifierName);
    addPluginReference(
      refs,
      "notifier",
      target.pluginName,
      `defaults.notifiers: ${target.reference} (plugin: ${target.pluginName})`,
    );
  }

  for (const [priority, notifierNames] of Object.entries(config.notificationRouting ?? {})) {
    for (const notifierName of notifierNames) {
      const target = resolveNotifierTarget(config, notifierName);
      addPluginReference(
        refs,
        "notifier",
        target.pluginName,
        `notificationRouting.${priority}: ${target.reference} (plugin: ${target.pluginName})`,
      );
    }
  }

  for (const [name, notifierConfig] of Object.entries(config.notifiers ?? {})) {
    addPluginReference(
      refs,
      "notifier",
      notifierConfig.plugin,
      `notifiers.${name} (plugin: ${notifierConfig.plugin})`,
    );
  }

  for (const [projectId, project] of Object.entries(config.projects)) {
    addPluginReference(refs, "runtime", project.runtime, `projects.${projectId}.runtime`);
    addPluginReference(refs, "agent", project.agent, `projects.${projectId}.agent`);
    addPluginReference(refs, "workspace", project.workspace, `projects.${projectId}.workspace`);
    addPluginReference(
      refs,
      "agent",
      project.orchestrator?.agent,
      `projects.${projectId}.orchestrator.agent`,
    );
    addPluginReference(refs, "agent", project.worker?.agent, `projects.${projectId}.worker.agent`);
    addPluginReference(
      refs,
      "tracker",
      project.tracker?.plugin,
      `projects.${projectId}.tracker.plugin`,
    );
    addPluginReference(refs, "scm", project.scm?.plugin, `projects.${projectId}.scm.plugin`);
  }

  return refs;
}

async function checkPluginResolution(
  config: OrchestratorConfig,
  fail: (msg: string) => void,
): Promise<PluginRegistry> {
  console.log("");
  console.log("Plugin resolution:");

  const registry = await loadPluginRegistry(config);
  const loadedBySlot = new Map<CheckedPluginSlot, Set<string>>();
  const slots: CheckedPluginSlot[] = [
    "runtime",
    "agent",
    "workspace",
    "tracker",
    "scm",
    "notifier",
  ];

  for (const slot of slots) {
    loadedBySlot.set(slot, new Set(registry.list(slot).map((manifest) => manifest.name)));
  }

  const references = collectPluginReferences(config);
  if (references.length === 0) {
    warn("No plugin references found in config.");
    return registry;
  }

  for (const ref of references) {
    const loaded = loadedBySlot.get(ref.slot);
    if (loaded?.has(ref.pluginName)) {
      pass(`${ref.source} -> ${ref.slot} plugin "${ref.pluginName}"`);
    } else {
      fail(
        `${ref.source} references ${ref.slot} plugin "${ref.pluginName}", but it could not be loaded. ` +
          `Fix: install the plugin or correct the config value.`,
      );
    }
  }

  return registry;
}

// ---------------------------------------------------------------------------
// Notifier connectivity checks (Gap 2)
// ---------------------------------------------------------------------------

async function checkNotifierConnectivity(config: OrchestratorConfig): Promise<void> {
  console.log(""); // blank line before notifier section
  console.log("Notifier connectivity:");

  const configuredNotifiers = Object.keys(config.notifiers ?? {});
  if (configuredNotifiers.length === 0) {
    warn("No notifiers are configured. Fix: add notifiers to your cahi.yaml");
    return;
  }

  // Report configured notifiers as present (we can't health-check Slack/desktop/webhook without sending)
  for (const [name, notifierConfig] of Object.entries(config.notifiers ?? {})) {
    const plugin = notifierConfig.plugin;
    pass(`${name} notifier is configured (plugin: ${plugin})`);
  }
}

// ---------------------------------------------------------------------------
// Test-notify (Gap 3)
// ---------------------------------------------------------------------------

async function sendTestNotifications(
  config: OrchestratorConfig,
  registry: PluginRegistry,
  fail: (msg: string) => void,
): Promise<void> {
  const result = await runNotifyTest(config, registry, {
    templateName: "basic",
    all: true,
    message: "Test notification from cahi doctor --test-notify",
    sessionId: "doctor-test",
    projectId: "doctor",
    data: { source: "cahi-doctor" },
  });

  if (result.targets.length === 0) {
    warn("No notifiers to test. Fix: configure notifiers in your cahi.yaml");
    return;
  }

  console.log(`\nSending test notification to ${result.targets.length} notifier(s)...\n`);

  for (const delivery of result.deliveries) {
    if (delivery.status === "sent") {
      pass(`${delivery.reference}: test notification sent`);
    } else if (delivery.status === "unresolved") {
      warn(`${delivery.reference}: plugin "${delivery.pluginName}" not loaded (may not be installed)`);
    } else if (delivery.error) {
      fail(delivery.error);
    }
  }

  for (const warning of result.warnings) {
    warn(warning);
  }
}

// ---------------------------------------------------------------------------
// Version freshness (cache-only — no network call)
// ---------------------------------------------------------------------------

function checkVersionFreshness(): void {
  console.log("");
  console.log("Version:");

  const current = getCurrentVersion();
  const installMethod = detectInstallMethod();
  const cached = readCachedUpdateInfo(installMethod);

  if (!cached) {
    pass(`cahi v${current} installed (run any cahi command to check for updates)`);
    return;
  }

  const isOutdated =
    installMethod === "git"
      ? cached.isOutdated === true
      : isVersionOutdated(current, cached.latestVersion);

  if (isOutdated) {
    const latest = installMethod === "git" ? cached.latestVersion : `v${cached.latestVersion}`;
    warn(`cahi v${current} is outdated (latest: ${latest}). Run: ${getUpdateCommand(installMethod)}`);
  } else {
    pass(`cahi v${current} is the latest version`);
  }
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Run install, environment, and runtime health checks")
    .option("--fix", "Apply safe fixes for launcher and stale temp issues")
    .option("--test-notify", "Send a test notification through each configured notifier")
    .action(async (opts: { fix?: boolean; testNotify?: boolean }) => {
      const { fail, count: failCount } = makeFailCounter();

      // 1. Run shell checks
      const scriptArgs: string[] = [];
      if (opts.fix) {
        scriptArgs.push("--fix");
      }

      let shellExitCode: number;
      try {
        shellExitCode = await runRepoScript("cahi-doctor.sh", scriptArgs);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        shellExitCode = 1;
      }

      // 2. Version freshness (cache-only, no network dependency)
      checkVersionFreshness();

      // 3. Run TypeScript-based notifier checks if a config file exists
      const configPath = findConfigFile();
      if (configPath) {
        let config: ReturnType<typeof loadConfig> | undefined;
        let registry: PluginRegistry | undefined;
        try {
          config = loadConfig(configPath);
          registry = await checkPluginResolution(config, fail);
          await checkNotifierConnectivity(config);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          fail(`Config-aware doctor checks failed: ${message}`);
        }

        // 4. Send test notifications if requested (separate catch for accurate errors)
        if (opts.testNotify && config && registry) {
          try {
            await sendTestNotifications(config, registry, fail);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            fail(`Sending test notifications failed: ${message}`);
          }
        }
      } else if (opts.testNotify) {
        fail("No config file found. Cannot test notifiers without cahi.yaml");
      }

      // Exit non-zero if shell checks or notifier checks failed
      if (shellExitCode !== 0 || failCount() > 0) {
        process.exit(shellExitCode || 1);
      }
    });
}
