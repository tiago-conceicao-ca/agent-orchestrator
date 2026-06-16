import type { Complexity, SdlcModel } from "../plan/types.js";

/**
 * Graduated implement-lens passes, modelled on taskmaster's
 * `workflow_config.yaml` (`implement.passes` + `implement.complexity`). Each
 * logical task expands at plan time into a sequence of these passes: an
 * `initial` implementation followed by complexity-gated review lenses that each
 * read the previous pass's work and apply their specific concern.
 *
 * Fidelity to taskmaster:
 * - the five pass roles and their order,
 * - the per-pass prompt template id + model tier (initial=sonnet, reviews=opus),
 * - the complexity→passes gating (LOW=3, MEDIUM=4, HIGH=5).
 */
export const PASS_ROLES = [
  "initial",
  "correctness",
  "edge_cases",
  "simplicity",
  "excellence",
] as const;

export type PassRole = (typeof PASS_ROLES)[number];

/**
 * Static definition of one pass role: a display name, the prompt-template id
 * (resolved to `gates/prompts/<template>.md` by the lens runner), and the model
 * tier the worker launches with. `initial` implements with sonnet; every review
 * lens runs on opus — mirroring taskmaster's `model_family` assignment.
 */
export interface PassDef {
  role: PassRole;
  name: string;
  template: string;
  model: SdlcModel;
}

/** The canonical pass catalog (taskmaster `implement.passes`). */
export const PASS_DEFS: Record<PassRole, PassDef> = {
  initial: {
    role: "initial",
    name: "Initial Implementation",
    template: "implement-lens-initial",
    model: "sonnet",
  },
  correctness: {
    role: "correctness",
    name: "Correctness Review",
    template: "implement-lens-correctness",
    model: "opus",
  },
  edge_cases: {
    role: "edge_cases",
    name: "Edge Case Review",
    template: "implement-lens-edge-cases",
    model: "opus",
  },
  simplicity: {
    role: "simplicity",
    name: "Simplicity Review",
    template: "implement-lens-simplicity",
    model: "opus",
  },
  excellence: {
    role: "excellence",
    name: "Production Hardening",
    template: "implement-lens-excellence",
    model: "opus",
  },
};

/**
 * Complexity gating (taskmaster `implement.complexity`): which review lenses a
 * task earns. LOW gets the safety floor; MEDIUM adds simplicity; HIGH adds
 * production hardening on top.
 */
export const COMPLEXITY_PASSES: Record<Complexity, PassRole[]> = {
  LOW: ["initial", "correctness", "edge_cases"],
  MEDIUM: ["initial", "correctness", "edge_cases", "simplicity"],
  HIGH: ["initial", "correctness", "edge_cases", "simplicity", "excellence"],
};

/** Resolve the ordered pass definitions a task of `complexity` expands into. */
export function passesForComplexity(complexity: Complexity): PassDef[] {
  return COMPLEXITY_PASSES[complexity].map((role) => PASS_DEFS[role]);
}

/** True for the implementation pass; review lenses read its (and prior) output. */
export function isReviewPass(role: PassRole): boolean {
  return role !== "initial";
}
