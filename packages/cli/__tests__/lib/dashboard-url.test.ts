import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { dashboardUrl } from "../../src/lib/dashboard-url.js";

describe("dashboardUrl", () => {
  const original = process.env.CAHI_PUBLIC_URL;

  beforeEach(() => {
    delete process.env.CAHI_PUBLIC_URL;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CAHI_PUBLIC_URL;
    } else {
      process.env.CAHI_PUBLIC_URL = original;
    }
  });

  it("falls back to localhost when CAHI_PUBLIC_URL is unset", () => {
    expect(dashboardUrl(3000)).toBe("http://localhost:3000");
  });

  it("falls back to localhost when CAHI_PUBLIC_URL is empty", () => {
    process.env.CAHI_PUBLIC_URL = "";
    expect(dashboardUrl(8094)).toBe("http://localhost:8094");
  });

  it("falls back to localhost when CAHI_PUBLIC_URL is whitespace only", () => {
    process.env.CAHI_PUBLIC_URL = "   ";
    expect(dashboardUrl(8094)).toBe("http://localhost:8094");
  });

  it("uses CAHI_PUBLIC_URL when set", () => {
    process.env.CAHI_PUBLIC_URL = "https://cahi.example.com";
    expect(dashboardUrl(3000)).toBe("https://cahi.example.com");
  });

  it("ignores the port argument when CAHI_PUBLIC_URL is set", () => {
    process.env.CAHI_PUBLIC_URL = "https://cahi.example.com";
    expect(dashboardUrl(3000)).toBe("https://cahi.example.com");
    expect(dashboardUrl(8094)).toBe("https://cahi.example.com");
  });

  it("strips a trailing slash from CAHI_PUBLIC_URL", () => {
    process.env.CAHI_PUBLIC_URL = "https://cahi.example.com/";
    expect(dashboardUrl(3000)).toBe("https://cahi.example.com");
  });

  it("strips multiple trailing slashes from CAHI_PUBLIC_URL", () => {
    process.env.CAHI_PUBLIC_URL = "https://cahi.example.com///";
    expect(dashboardUrl(3000)).toBe("https://cahi.example.com");
  });

  it("preserves a sub-path in CAHI_PUBLIC_URL", () => {
    process.env.CAHI_PUBLIC_URL = "https://example.com/cahi";
    expect(dashboardUrl(3000)).toBe("https://example.com/cahi");
  });

  it("trims surrounding whitespace from CAHI_PUBLIC_URL", () => {
    process.env.CAHI_PUBLIC_URL = "  https://cahi.example.com  ";
    expect(dashboardUrl(3000)).toBe("https://cahi.example.com");
  });

  it("supports a non-default port in CAHI_PUBLIC_URL", () => {
    process.env.CAHI_PUBLIC_URL = "http://192.168.1.5:9000";
    expect(dashboardUrl(3000)).toBe("http://192.168.1.5:9000");
  });
});
