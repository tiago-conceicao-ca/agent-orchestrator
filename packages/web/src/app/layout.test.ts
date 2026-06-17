import { describe, expect, it } from "vitest";

describe("app layout metadata", () => {
  it("exports the themed mobile viewport colors", async () => {
    const { viewport } = await import("./layout");

    expect(viewport.themeColor).toEqual([
      { media: "(prefers-color-scheme: light)", color: "#f5f3f0" },
      { media: "(prefers-color-scheme: dark)", color: "#0a0b0d" },
    ]);
  });

  it("builds metadata with the cahi title and apple web app settings", async () => {
    const { generateMetadata } = await import("./layout");

    await expect(generateMetadata()).resolves.toMatchObject({
      title: {
        template: "%s | cahi | Orchestrator",
        default: "cahi | Orchestrator",
      },
      appleWebApp: {
        capable: true,
        statusBarStyle: "black-translucent",
        title: "cahi | Orchestrator",
      },
    });
  });
});
