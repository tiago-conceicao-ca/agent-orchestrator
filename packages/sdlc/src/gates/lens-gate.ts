import { type Gate, parseLensVerdict } from "./types.js";

/** A function that runs an agent with a prompt over an artifact and returns its raw text. */
export type AgentRunner = (prompt: string, artifactRef: string) => Promise<string>;

/**
 * Extract the last balanced top-level `{...}` object from agent output. Agents
 * wrap prose around the verdict and may echo earlier JSON examples from the
 * prompt, so we scan leftward from the final `}` tracking brace depth and return
 * the slice once depth returns to zero (the matching opening brace).
 */
function extractJsonBlob(text: string): string {
  const end = text.lastIndexOf("}");
  if (end === -1) throw new Error("No JSON verdict found in agent output.");
  let depth = 0;
  for (let i = end; i >= 0; i--) {
    const ch = text[i];
    if (ch === "}") depth++;
    else if (ch === "{" && --depth === 0) return text.slice(i, end + 1);
  }
  throw new Error("No JSON verdict found in agent output.");
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
