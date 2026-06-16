import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CAHI — Conta Azul Hub for Intelligence",
  description:
    "AI-native platform for running parallel coding agents. CAHI (formerly Agent Orchestrator) combines orchestration and Taskmaster planning behind Conta Azul's AI-native initiative — spawn Claude Code, Codex, Aider, and more in isolated worktrees, all managed from one dashboard.",
  openGraph: {
    type: "website",
    url: "https://aoagents.dev/landing",
    siteName: "CAHI",
    title: "CAHI — Conta Azul Hub for Intelligence",
    description:
      "AI-native platform for running parallel coding agents. CAHI (formerly Agent Orchestrator) combines orchestration and Taskmaster planning behind Conta Azul's AI-native initiative — spawn Claude Code, Codex, Aider, and more in isolated worktrees, all managed from one dashboard.",
    images: [{ url: "/og-image.png", width: 1024, height: 1024, alt: "CAHI" }],
  },
  alternates: {
    canonical: "https://aoagents.dev/",
  },
};

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
