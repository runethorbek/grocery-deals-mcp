import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { zipSync, type Zippable } from "fflate";

/** Lists all files below `dir` as forward-slash paths relative to `dir`, sorted. */
function listFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) return listFiles(join(dir, entry.name), `${relative}/`);
      return entry.isFile() ? [relative] : [];
    });
}

/**
 * Writes `<outDir>/<name>.zip` for every folder in `skillsDir` that contains a `SKILL.md`.
 * Each archive has the skill folder as its root entry, e.g. `<name>/SKILL.md`.
 * Returns the paths of the zips written; throws if there are no skills.
 */
export function packageSkills(skillsDir: string, outDir: string): string[] {
  const names = existsSync(skillsDir)
    ? readdirSync(skillsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(skillsDir, entry.name, "SKILL.md")))
        .map((entry) => entry.name)
        .sort()
    : [];
  if (names.length === 0) {
    throw new Error(`No skills found in ${skillsDir} (expected folders containing SKILL.md).`);
  }

  mkdirSync(outDir, { recursive: true });
  return names.map((name) => {
    const skillDir = join(skillsDir, name);
    const entries: Zippable = {};
    for (const file of listFiles(skillDir)) {
      entries[`${name}/${file}`] = readFileSync(join(skillDir, ...file.split("/")));
    }
    const zipPath = join(outDir, `${name}.zip`);
    writeFileSync(zipPath, zipSync(entries));
    return zipPath;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    for (const zipPath of packageSkills(resolve("skills"), resolve("dist", "skills"))) {
      console.log(zipPath);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
