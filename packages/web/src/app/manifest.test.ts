import { describe, expect, it } from "vitest";

describe("app manifest", () => {
  it("builds the PWA manifest with cahi naming and icons", async () => {
    const { default: manifest } = await import("./manifest");

    expect(manifest()).toMatchObject({
      name: "cahi | Orchestrator",
      short_name: "cahi",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "portrait-primary",
      background_color: "#121110",
      theme_color: "#121110",
      icons: [
        { src: "/apple-icon", sizes: "180x180", type: "image/png" },
        { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    });
  });
});
