/**
 * Orchestrator Prompt Generator - generates orchestrator prompt content.
 *
 * This is injected via `ao start` to provide orchestrator-specific context
 * when the orchestrator agent runs.
 */

import orchestratorTemplate from "./prompts/orchestrator.md";
import type { OrchestratorConfig, ProjectConfig } from "./types.js";
import { resolveSiblingAdjacency } from "./utils/siblings.js";

export interface OrchestratorPromptConfig {
  config: OrchestratorConfig;
  projectId: string;
  project: ProjectConfig;
}

interface OrchestratorPromptRenderData {
  projectId: string;
  projectName: string;
  projectRepo: string;
  projectDefaultBranch: string;
  projectSessionPrefix: string;
  projectPath: string;
  dashboardPort: string;
  automatedReactionsSection: string;
  projectSpecificRulesSection: string;
  siblingsSection: string;
  repoConfiguredSection: string;
  repoNotConfiguredSection: string;
}

type OrchestratorPromptRenderKey = keyof OrchestratorPromptRenderData;

function buildAutomatedReactionsSection(project: ProjectConfig): string {
  const markdownBold = String.fromCharCode(42).repeat(2);
  const bold = (text: string): string => `${markdownBold}${text}${markdownBold}`;

  const reactionLines: string[] = [];

  for (const [event, reaction] of Object.entries(project.reactions ?? {})) {
    if (reaction.auto && reaction.action === "send-to-agent") {
      reactionLines.push(
        `- ${bold(event)}: Auto-sends instruction to agent (retries: ${reaction.retries ?? "none"}, escalates after: ${reaction.escalateAfter ?? "never"})`,
      );
      continue;
    }

    if (reaction.auto && reaction.action === "notify") {
      reactionLines.push(
        `- ${bold(event)}: Notifies human (priority: ${reaction.priority ?? "info"})`,
      );
    }
  }

  if (reactionLines.length === 0) {
    return "";
  }

  return reactionLines.join("\n");
}

function buildSiblingsSection(
  config: OrchestratorConfig,
  projectId: string,
  project: ProjectConfig,
): string {
  const markdownBold = String.fromCharCode(42).repeat(2);
  const bold = (text: string): string => `${markdownBold}${text}${markdownBold}`;

  const configured = resolveSiblingAdjacency(config.projects, project.siblings, projectId);
  const catalog = Object.entries(config.projects)
    .filter(([id]) => id !== projectId)
    .map(([, proj]) => proj.name);

  const lines: string[] = [];

  if (configured.length > 0) {
    lines.push(
      `${bold("Configured siblings")} (auto-mounted read-only into every ${project.name} session at \`../{name}\`):`,
    );
    for (const sibling of configured) {
      lines.push(`- ${sibling.displayName} → \`../${sibling.name}\``);
    }
  }

  if (catalog.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(
      `${bold("Available projects")} — to *write* into one of these, spawn a worker under that project (not this one):`,
    );
    for (const name of catalog) {
      lines.push(`- ${name}`);
    }
  }

  if (lines.length === 0) {
    return "No sibling repos are configured, and no other projects are registered.";
  }

  return lines.join("\n");
}

function buildProjectSpecificRulesSection(project: ProjectConfig): string {
  const rules = project.orchestratorRules?.trim();
  if (!rules) {
    return "";
  }

  return rules;
}

function removeOptionalSectionBlocks(
  template: string,
  data: OrchestratorPromptRenderData,
): string {
  const templates = [
    ["REPO_CONFIGURED_SECTION_START", "REPO_CONFIGURED_SECTION_END", data.repoConfiguredSection],
    ["REPO_NOT_CONFIGURED_SECTION_START", "REPO_NOT_CONFIGURED_SECTION_END", data.repoNotConfiguredSection],
    ["AUTOMATED_REACTIONS_SECTION_START", "AUTOMATED_REACTIONS_SECTION_END", data.automatedReactionsSection],
    ["PROJECT_SPECIFIC_RULES_SECTION_START", "PROJECT_SPECIFIC_RULES_SECTION_END", data.projectSpecificRulesSection],
  ] as const;

  let interpolated = template;
  for (const [startKey, endKey, section] of templates) {
    const startMarker = `{{${startKey}}}`;
    const endMarker = `{{${endKey}}}`;

    while (true) {
      const start = interpolated.indexOf(startMarker);
      const end = interpolated.indexOf(endMarker);

      if (start === -1 && end === -1) {
        break;
      }

      if (start === -1 || end === -1 || end < start) {
        throw new Error(
          `Malformed optional section block: expected ${startMarker} before ${endMarker}`,
        );
      }

      const fullStart = start;
      const fullEnd = end + endMarker.length;
      const blockContent = interpolated.slice(start + startMarker.length, end);
      // Optional sections are flat by design. Reject nesting of the same block
      // type so future template edits fail loudly instead of matching ambiguously.
      if (blockContent.includes(startMarker)) {
        throw new Error(
          `Nested optional section blocks are not supported: ${startMarker} before ${endMarker}`,
        );
      }

      const replacement = section ? blockContent : "";
      const before = interpolated.slice(0, fullStart);
      const after = interpolated.slice(fullEnd);

      interpolated = replacement
        ? before + replacement + after
        : collapseOptionalGap(before, after);
    }
  }

  return interpolated;
}

function collapseOptionalGap(before: string, after: string): string {
  const trailingNewlines = before.match(/\n*$/)?.[0] ?? "";
  const leadingNewlines = after.match(/^\n*/)?.[0] ?? "";
  const totalNewlines = trailingNewlines.length + leadingNewlines.length;
  const boundary = totalNewlines >= 2 ? "\n\n" : trailingNewlines + leadingNewlines;

  return (
    before.slice(0, before.length - trailingNewlines.length) +
    boundary +
    after.slice(leadingNewlines.length)
  );
}

function hasRenderDataKey(
  data: OrchestratorPromptRenderData,
  key: string,
): key is OrchestratorPromptRenderKey {
  return Object.prototype.hasOwnProperty.call(data, key);
}

function createRenderData(opts: OrchestratorPromptConfig): OrchestratorPromptRenderData {
  const { config, projectId, project } = opts;
  const hasRepo = Boolean(project.repo);

  return {
    projectId,
    projectName: project.name,
    projectRepo: project.repo ?? "not configured",
    projectDefaultBranch: project.defaultBranch,
    projectSessionPrefix: project.sessionPrefix,
    projectPath: project.path,
    dashboardPort: String(config.port ?? 3000),
    automatedReactionsSection: buildAutomatedReactionsSection(project),
    projectSpecificRulesSection: buildProjectSpecificRulesSection(project),
    siblingsSection: buildSiblingsSection(config, projectId, project),
    repoConfiguredSection: hasRepo ? "true" : "",
    repoNotConfiguredSection: hasRepo ? "" : "true",
  };
}

function renderTemplate(template: string, data: OrchestratorPromptRenderData): string {
  const unresolvedPlaceholder = template
    .replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, "")
    .match(/\{\{[^}]+\}\}/);
  if (unresolvedPlaceholder) {
    throw new Error(`Unresolved template placeholder: ${unresolvedPlaceholder[0]}`);
  }

  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, rawKey: string) => {
    if (!hasRenderDataKey(data, rawKey)) {
      throw new Error(`Unresolved template placeholder: ${rawKey}`);
    }

    return data[rawKey];
  });
}

function finalizeRenderedPrompt(prompt: string): string {
  return prompt.trim();
}

/**
 * Generate orchestrator prompt content.
 * Provides orchestrator agent with context about available commands,
 * session management workflows, and project configuration.
 */
export function generateOrchestratorPrompt(opts: OrchestratorPromptConfig): string {
  const data = createRenderData(opts);
  const templateWithOptionalSections = removeOptionalSectionBlocks(
    orchestratorTemplate.trim(),
    data,
  );

  return finalizeRenderedPrompt(
    renderTemplate(templateWithOptionalSections, data),
  );
}
