#!/usr/bin/env node
import { readdir, mkdir, lstat, readlink, unlink, symlink, rename, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const skillsTarget = join(homedir(), ".claude", "skills");

const SKIP = new Set([
  "bin",
  "node_modules",
  ".git",
  ".github",
  ".vscode",
  ".idea",
]);

const rawArgs = process.argv.slice(2);
const flags = new Set(rawArgs.filter((a) => a.startsWith("-")));
const requested = rawArgs.filter((a) => !a.startsWith("-"));
const force = flags.has("--force") || flags.has("-f");
const dryRun = flags.has("--dry-run") || flags.has("-n");
const showHelp = flags.has("--help") || flags.has("-h");

if (showHelp) {
  console.log(`Usage: install-skills [skill...] [--dry-run] [--force]

Symlinks skills from this repo into ~/.claude/skills.

Args:
  [skill...]   One or more skill names to install. Default: all skills.

Flags:
  -n, --dry-run   Show what would happen, change nothing.
  -f, --force     Back up and replace existing non-symlink skills.
  -h, --help      Show this help.`);
  process.exit(0);
}

function isSkillDir(name, fullPath) {
  if (name.startsWith(".")) return false;
  if (SKIP.has(name)) return false;
  return existsSync(join(fullPath, "SKILL.md"));
}

async function ensureDir(p) {
  if (!existsSync(p)) await mkdir(p, { recursive: true });
}

async function linkSkill(name) {
  const src = join(repoRoot, name);
  const dest = join(skillsTarget, name);

  if (existsSync(dest) || (await lstat(dest).catch(() => null))) {
    const info = await lstat(dest);
    if (info.isSymbolicLink()) {
      const current = await readlink(dest);
      if (resolve(skillsTarget, current) === src) {
        console.log(`= ${name} (already linked)`);
        return;
      }
      if (dryRun) {
        console.log(`~ ${name} (would replace symlink -> ${current})`);
        return;
      }
      await unlink(dest);
    } else {
      if (!force) {
        console.warn(`! ${name} exists at ${dest} (not a symlink). Use --force to back up and replace.`);
        return;
      }
      const backup = `${dest}.backup-${Date.now()}`;
      if (dryRun) {
        console.log(`~ ${name} (would back up to ${backup})`);
        return;
      }
      await rename(dest, backup);
      console.log(`  backed up existing ${name} -> ${backup}`);
    }
  }

  if (dryRun) {
    console.log(`+ ${name} (would symlink ${src} -> ${dest})`);
    return;
  }
  await symlink(src, dest, "dir");
  console.log(`+ ${name}`);
}

async function main() {
  await ensureDir(skillsTarget);
  const entries = await readdir(repoRoot, { withFileTypes: true });
  const available = entries
    .filter((e) => e.isDirectory() && isSkillDir(e.name, join(repoRoot, e.name)))
    .map((e) => e.name);

  if (available.length === 0) {
    console.error("No skills found at repo root (need SKILL.md inside each skill dir).");
    process.exit(1);
  }

  let skills = available;
  if (requested.length > 0) {
    const unknown = requested.filter((n) => !available.includes(n));
    if (unknown.length > 0) {
      console.error(`Unknown skill(s): ${unknown.join(", ")}`);
      console.error(`Available: ${available.join(", ")}`);
      process.exit(1);
    }
    skills = requested;
  }

  console.log(`Installing ${skills.length} skill(s) -> ${skillsTarget}${dryRun ? " (dry run)" : ""}`);
  for (const name of skills) await linkSkill(name);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
