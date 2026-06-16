import { readFile } from "node:fs/promises";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "raw-markdown",
      enforce: "pre",
      async load(id) {
        if (!id.endsWith(".md")) {
          return null;
        }

        return `export default ${JSON.stringify(await readFile(id, "utf8"))};`;
      },
    },
  ],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["lcov"],
      include: ["src/**/*.{ts,tsx}", "server/**/*.ts"],
    },
  },
  resolve: {
    alias: [
      { find: "@contaazul/cahi-core/types", replacement: resolve(__dirname, "../core/src/types.ts") },
      {
        find: "@contaazul/cahi-core",
        replacement: resolve(__dirname, "../core/src/index.ts"),
      },
      {
        find: "@contaazul/cahi-sdlc",
        replacement: resolve(__dirname, "../sdlc/src/index.ts"),
      },
      {
        find: "@contaazul/cahi-plugin-runtime-tmux",
        replacement: resolve(__dirname, "../plugins/runtime-tmux/src/index.ts"),
      },
      {
        find: "@contaazul/cahi-plugin-agent-claude-code",
        replacement: resolve(__dirname, "../plugins/agent-claude-code/src/index.ts"),
      },
      {
        find: "@contaazul/cahi-plugin-agent-codex",
        replacement: resolve(__dirname, "../plugins/agent-codex/src/index.ts"),
      },
      {
        find: "@contaazul/cahi-plugin-agent-opencode",
        replacement: resolve(__dirname, "../plugins/agent-opencode/src/index.ts"),
      },
      {
        find: "@contaazul/cahi-plugin-workspace-worktree",
        replacement: resolve(__dirname, "../plugins/workspace-worktree/src/index.ts"),
      },
      {
        find: "@contaazul/cahi-plugin-scm-github",
        replacement: resolve(__dirname, "../plugins/scm-github/src/index.ts"),
      },
      {
        find: "@contaazul/cahi-plugin-tracker-github",
        replacement: resolve(__dirname, "../plugins/tracker-github/src/index.ts"),
      },
      {
        find: "@contaazul/cahi-plugin-tracker-linear",
        replacement: resolve(__dirname, "../plugins/tracker-linear/src/index.ts"),
      },
      { find: "server-only", replacement: resolve(__dirname, "./src/__tests__/server-only-mock.ts") },
      {
        find: "next/font/local",
        replacement: resolve(__dirname, "./src/__tests__/next-font-mock.ts"),
      },
      { find: "@", replacement: resolve(__dirname, "./src") },
    ],
  },
});
