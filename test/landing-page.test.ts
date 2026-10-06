import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const releaseBase = "https://github.com/runethorbek/grocery-deals-mcp/releases/download/skills-latest";

describe("landing page", () => {
  it("is Danish and mobile-friendly", () => {
    expect(html).toContain('<html lang="da">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("offers the connector URL for copying and the claude.ai setup path", () => {
    expect(html).toContain('data-copy="https://grocery-deals-mcp.vercel.app/mcp"');
    expect(html).toContain("Settings → Connectors → Add custom connector");
  });

  it("links both skill zips from the skills-latest release", () => {
    expect(html).toContain(`href="${releaseBase}/weekly-meal-plan.zip"`);
    expect(html).toContain(`href="${releaseBase}/wine-deals.zip"`);
    expect(html).toContain("Customize → Skills");
  });

  it("offers at least two example prompts for copying", () => {
    const prompts = [...html.matchAll(/data-copy="([^"]+)"/g)].map((match) => match[1]);
    expect(prompts.filter((text) => !text.startsWith("https://")).length).toBeGreaterThanOrEqual(2);
  });

  it("loads no external scripts, stylesheets or cookies", () => {
    expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(html).not.toMatch(/<link[^>]*rel="?stylesheet/i);
    expect(html).not.toContain("@import");
    expect(html).not.toContain("document.cookie");
  });
});
