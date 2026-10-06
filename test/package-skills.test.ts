import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packageSkills } from "../scripts/package-skills.js";

let root: string;
let skillsDir: string;
let outDir: string;

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function zipEntries(zipPath: string): Record<string, string> {
  const files = unzipSync(readFileSync(zipPath));
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "package-skills-"));
  skillsDir = join(root, "skills");
  outDir = join(root, "dist", "skills");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("packageSkills", () => {
  it("writes one zip per skill with the skill folder as root and forward-slash paths", () => {
    writeFile(join(skillsDir, "weekly-meal-plan", "SKILL.md"), "meal plan");
    writeFile(join(skillsDir, "weekly-meal-plan", "references", "nested", "notes.md"), "notes");
    writeFile(join(skillsDir, "wine-deals", "SKILL.md"), "wine");

    const written = packageSkills(skillsDir, outDir);

    expect(written).toEqual([join(outDir, "weekly-meal-plan.zip"), join(outDir, "wine-deals.zip")]);
    expect(readdirSync(outDir).sort()).toEqual(["weekly-meal-plan.zip", "wine-deals.zip"]);
    expect(zipEntries(join(outDir, "weekly-meal-plan.zip"))).toEqual({
      "weekly-meal-plan/SKILL.md": "meal plan",
      "weekly-meal-plan/references/nested/notes.md": "notes",
    });
    expect(zipEntries(join(outDir, "wine-deals.zip"))).toEqual({ "wine-deals/SKILL.md": "wine" });
  });

  it("skips folders without SKILL.md and files directly in the skills folder", () => {
    writeFile(join(skillsDir, "weekly-meal-plan", "SKILL.md"), "meal plan");
    writeFile(join(skillsDir, "draft", "notes.md"), "not a skill");
    writeFile(join(skillsDir, "README.md"), "readme");

    expect(packageSkills(skillsDir, outDir)).toEqual([join(outDir, "weekly-meal-plan.zip")]);
    expect(readdirSync(outDir)).toEqual(["weekly-meal-plan.zip"]);
  });

  it("overwrites an existing zip", () => {
    writeFile(join(skillsDir, "weekly-meal-plan", "SKILL.md"), "old");
    packageSkills(skillsDir, outDir);
    writeFileSync(join(skillsDir, "weekly-meal-plan", "SKILL.md"), "new");
    packageSkills(skillsDir, outDir);

    expect(zipEntries(join(outDir, "weekly-meal-plan.zip"))).toEqual({ "weekly-meal-plan/SKILL.md": "new" });
  });

  it("fails clearly when there are no skills", () => {
    mkdirSync(join(skillsDir, "empty"), { recursive: true });
    expect(() => packageSkills(skillsDir, outDir)).toThrow(/No skills found/);
    expect(() => packageSkills(join(root, "missing"), outDir)).toThrow(/No skills found/);
  });
});
