import { describe, it, expect } from "vitest";
import { SDLC_MODELS } from "@aoagents/ao-sdlc";
import { SDLC_MODEL_OPTIONS } from "@/lib/sdlc-board";

describe("SDLC_MODEL_OPTIONS", () => {
  it("stays in sync with the source SDLC_MODELS constant", () => {
    // Client-safe mirror — drift would offer the modal a model the engine
    // doesn't accept (or hide one it does).
    expect([...SDLC_MODEL_OPTIONS]).toEqual([...SDLC_MODELS]);
  });
});
