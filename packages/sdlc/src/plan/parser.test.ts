import { describe, it, expect } from "vitest";
import { extractTaskGraphYaml, parseTaskGraph } from "./parser";

const PLAN = `# Feature Implementation Plan
## Overview
Build it.
## Task: Repo layer
### Acceptance Criteria
- [ ] persists rows
## Task: Service layer
## Task Graph
\`\`\`yaml
tasks:
  - name: "Repo layer"
    complexity: LOW
    tdd: true
    depends_on: []
    summary: "DB access"
    acceptance_criteria: ["persists rows"]
  - name: "Service layer"
    complexity: MEDIUM
    tdd: true
    depends_on: ["Repo layer"]
    summary: "business logic"
\`\`\`
`;

describe("extractTaskGraphYaml", () => {
  it("pulls the yaml body out of the Task Graph block", () => {
    const yaml = extractTaskGraphYaml(PLAN);
    expect(yaml).toContain("Repo layer");
    expect(yaml).toContain("Service layer");
  });
  it("throws when there is no Task Graph block", () => {
    expect(() => extractTaskGraphYaml("# no graph here")).toThrow(/Task Graph/i);
  });
});

describe("parseTaskGraph", () => {
  it("parses entries with defaults for optional fields", () => {
    const g = parseTaskGraph(extractTaskGraphYaml(PLAN));
    expect(g.tasks).toHaveLength(2);
    expect(g.tasks[0]).toMatchObject({
      name: "Repo layer",
      complexity: "LOW",
      tdd: true,
      dependsOn: [],
    });
    expect(g.tasks[1].dependsOn).toEqual(["Repo layer"]);
    expect(g.tasks[1].acceptanceCriteria).toEqual([]); // defaulted
  });
  it("throws on a task missing a required field", () => {
    const bad = `tasks:\n  - complexity: LOW\n    tdd: true\n    summary: x\n`;
    expect(() => parseTaskGraph(bad)).toThrow(/name/i);
  });
  it("throws on invalid complexity", () => {
    const bad = `tasks:\n  - name: a\n    complexity: EPIC\n    tdd: true\n    summary: x\n`;
    expect(() => parseTaskGraph(bad)).toThrow(/complexity/i);
  });
});
