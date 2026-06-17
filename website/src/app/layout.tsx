import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: ["400", "500"],
});

const siteUrl = "https://aoagents.dev";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    template: "%s | CAHI",
    default: "CAHI — Conta Azul Hub for Intelligence",
  },
  description:
    "AI-native platform for running parallel coding agents. CAHI (formerly CAHI) combines orchestration and Taskmaster planning behind Conta Azul's AI-native initiative — spawn Claude Code, Codex, Aider, and more in isolated worktrees, all managed from one dashboard.",
  keywords: ["AI agents", "coding agents", "Claude Code", "agent orchestration", "parallel agents", "open source"],
  authors: [{ name: "Conta Azul", url: "https://github.com/contaazul" }],
  creator: "Conta Azul",
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "CAHI",
    title: "CAHI — Conta Azul Hub for Intelligence",
    description:
      "AI-native platform for running parallel coding agents. CAHI (formerly CAHI) combines orchestration and Taskmaster planning behind Conta Azul's AI-native initiative — spawn Claude Code, Codex, Aider, and more in isolated worktrees, all managed from one dashboard.",
    images: [{ url: "/og-image.png", width: 1024, height: 1024, alt: "CAHI" }],
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: siteUrl,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#121110",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body className="bg-[var(--color-bg-base)] text-[var(--color-text-primary)] antialiased">{children}</body>
    </html>
  );
}