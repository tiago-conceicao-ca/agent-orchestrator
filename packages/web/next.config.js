import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const homeDir = os.homedir().replace(/\\/g, "/");
const nextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: [
    "@contaazul/cahi-plugin-agent-claude-code",
    "@contaazul/cahi-plugin-agent-codex",
    "@contaazul/cahi-plugin-agent-opencode",
    "@contaazul/cahi-plugin-runtime-tmux",
    "@contaazul/cahi-plugin-scm-github",
    "@contaazul/cahi-plugin-tracker-github",
    "@contaazul/cahi-plugin-tracker-linear",
    "@contaazul/cahi-plugin-workspace-worktree",
  ],
  serverExternalPackages: [
    "yaml",
    "zod",
    "@contaazul/cahi-core",
    // Kept external so @contaazul/cahi-sdlc's loadLensPrompt() can resolve its
    // dist/gates/prompts/*.md via import.meta.url at runtime (bundling would
    // rewrite the module URL and break the prompt path).
    "@contaazul/cahi-sdlc",
    "better-sqlite3",
  ],
  webpack: (config, { isServer }) => {
    if (process.platform === "win32") {
      config.snapshot = {
        ...config.snapshot,
        managedPaths: [/^(.+?[\\/]node_modules[\\/])/],
      };
      // Prevent nft from globbing the home directory during server file tracing.
      // ao-core resolves paths like ~/.agent-orchestrator at runtime; nft tries to
      // scan them at build time and hits EPERM on Windows junction points
      // (e.g. C:\Users\<user>\Application Data).
      if (isServer) {
        const tracePlugin = config.plugins.find(
          (p) => p.constructor?.name === "TraceEntryPointsPlugin"
        );
        if (tracePlugin) {
          tracePlugin.traceIgnores = [
            ...(tracePlugin.traceIgnores ?? []),
            `${homeDir}/**`,
          ];
        }
      }
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

// Only load bundle analyzer when ANALYZE=true (dev-only dependency)
let config = nextConfig;
if (process.env.ANALYZE === "true") {
  const { default: bundleAnalyzer } = await import("@next/bundle-analyzer");
  config = bundleAnalyzer({ enabled: true })(nextConfig);
}

export default config;
