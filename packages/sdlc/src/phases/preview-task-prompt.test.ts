import { describe, it, expect } from "vitest";
import { previewTaskPrompt, GERAR_BACKEND_INSTRUCTION } from "./generate-backend";
import type { WorkflowTask } from "../plan/types";

const task: WorkflowTask = {
  id: "epic-1__migration",
  title: "Migration V21",
  summary: "V21 ALTER product_kit_composition ADD unit_value/total_value nullable",
  complexity: "LOW",
  tdd: true,
  acceptanceCriteria: ["adds two nullable columns", "ProductKitRestApiIntegrationTest"],
  status: "backlog",
};

describe("previewTaskPrompt", () => {
  it("defaults to the canonical /gerar-backend wording", () => {
    const prompt = previewTaskPrompt(task);
    expect(prompt.startsWith(GERAR_BACKEND_INSTRUCTION)).toBe(true);
    expect(GERAR_BACKEND_INSTRUCTION).toContain("/gerar-backend");
  });

  it("renders title, summary, acceptance criteria (bulleted), and the PR footer", () => {
    const prompt = previewTaskPrompt(task);
    expect(prompt).toContain("Task: Migration V21");
    expect(prompt).toContain(
      "Summary: V21 ALTER product_kit_composition ADD unit_value/total_value nullable",
    );
    expect(prompt).toContain("- adds two nullable columns");
    expect(prompt).toContain("- ProductKitRestApiIntegrationTest");
    expect(prompt.trimEnd().endsWith("When done, open a PR.")).toBe(true);
  });

  it("uses an injected generation instruction verbatim and drops the default", () => {
    const prompt = previewTaskPrompt(task, "NODE: implement as plain Node.js");
    expect(prompt.startsWith("NODE: implement as plain Node.js")).toBe(true);
    expect(prompt).not.toContain("/gerar-backend");
  });

  it("is the same prompt the generate-backend executor dispatches (single source of truth)", () => {
    // The executor's default promptFor is previewTaskPrompt, so a no-arg render
    // equals what a spawned session receives for this task.
    expect(previewTaskPrompt(task)).toBe(previewTaskPrompt(task, GERAR_BACKEND_INSTRUCTION));
  });
});
