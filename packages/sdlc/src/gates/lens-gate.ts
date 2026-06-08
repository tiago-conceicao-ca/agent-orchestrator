import { type Gate, parseLensVerdict } from "./types.js";

/** A function that runs an agent with a prompt over an artifact and returns its raw text. */
export type AgentRunner = (prompt: string, artifactRef: string) => Promise<string>;

/** Extract the last {...} JSON object from agent output (agents often wrap prose around it). */
function extractJsonBlob(text: string): string {
  const matches = text.match(/\{[\s\S]*\}/g);
  if (!matches) throw new Error("No JSON verdict found in agent output.");
  return matches[matches.length - 1];
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
