import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Gate, parseLensVerdict } from "./types.js";

/** A function that runs an agent with a prompt over an artifact and returns its raw text. */
export type AgentRunner = (prompt: string, artifactRef: string) => Promise<string>;

export type LensName = "tactical" | "architectural" | "adversarial";

/**
 * Read a ported lens prompt body (`prompts/<name>.md`). Resolved relative to this
 * compiled module so it works from `src/` under vitest and from `dist/` at runtime
 * (the build copies `src/gates/prompts` → `dist/gates/prompts`). The body still
 * contains the `{artifact}` placeholder, which `makeLensGate` substitutes.
 */
export function loadLensPrompt(name: LensName): string {
  const promptsDir = join(dirname(fileURLToPath(import.meta.url)), "prompts");
  return readFileSync(join(promptsDir, `${name}.md`), "utf-8");
}

/**
 * Extract the last balanced top-level `{...}` object from agent output. Agents
 * wrap prose around the verdict and may echo earlier JSON examples from the
 * prompt. We scan forward tracking brace depth — but only OUTSIDE JSON strings,
 * so braces inside string values (e.g. an issue `detail` containing `}` or `{`)
 * don't unbalance the walk — collecting each complete top-level object and
 * returning the last. An unmatched trailing `}` in prose (depth already 0) is
 * ignored because it never opens a balanced object.
 */
function extractJsonBlob(text: string): string {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  if (objects.length === 0) throw new Error("No JSON verdict found in agent output.");
  return objects[objects.length - 1];
}

export function makeLensGate(name: string, promptTemplate: string, runner: AgentRunner): Gate {
  return {
    name,
    async evaluate(artifactRef: string, lens: string) {
      const prompt = promptTemplate.replace("{artifact}", artifactRef);
      const raw = await runner(prompt, artifactRef);
      return parseLensVerdict(extractJsonBlob(raw), lens);
    },
  };
}
