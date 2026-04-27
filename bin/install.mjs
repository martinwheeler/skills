#!/usr/bin/env node
import { readdir, mkdir, lstat, readlink, unlink, symlink, rename, rm } from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const skillsTarget = join(homedir(), ".claude", "skills");
const sourceCache = join(homedir(), ".claude", "skills-source");

const REPO = process.env.SKILLS_REPO || "martinwheeler/skills";
const REF = process.env.SKILLS_REF || "HEAD";

const SKIP = new Set(["bin", "node_modules", ".git", ".github", ".vscode", ".idea"]);

const rawArgs = process.argv.slice(2);
const flags = new Set(rawArgs.filter((a) => a.startsWith("-")));
const requested = rawArgs.filter((a) => !a.startsWith("-"));
const force = flags.has("--force") || flags.has("-f");
const dryRun = flags.has("--dry-run") || flags.has("-n");
const showHelp = flags.has("--help") || flags.has("-h");
const forceFetch = flags.has("--fetch");
const forceLocal = flags.has("--local");

if (showHelp) {
  console.log(`Usage: install-skills [skill...] [--fetch|--local] [--dry-run] [--force]

Symlinks skills into ~/.claude/skills. Source = local repo if running from a
clone, else downloads tarball from github.com/${REPO} into ~/.claude/skills-source.

Args:
  [skill...]   One or more skill names to install. Default: all skills.

Flags:
  --fetch         Force download from GitHub even if running from a clone.
  --local         Force use of the local repo (skip download).
  -n, --dry-run   Show what would happen, change nothing.
  -f, --force     Back up and replace existing non-symlink skills.
  -h, --help      Show this help.

Env:
  SKILLS_REPO=owner/repo   Override repo (default: ${REPO}).
  SKILLS_REF=branch|sha    Override ref (default: ${REF}).`);
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

function isEphemeralPath(p) {
  const lower = p.toLowerCase();
  if (lower.includes(`${"/"}_npx${"/"}`) || lower.includes(`\\_npx\\`)) return true;
  if (lower.startsWith(tmpdir().toLowerCase())) return true;
  return false;
}

function hasGit(p) {
  return existsSync(join(p, ".git"));
}

async function listSkillsIn(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && isSkillDir(e.name, join(dir, e.name)))
    .map((e) => e.name);
}

async function fetchTarballSource() {
  const url = `https://codeload.github.com/${REPO}/tar.gz/${REF}`;
  console.log(`Fetching ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  await ensureDir(sourceCache);
  const tmp = join(sourceCache, `.tmp-${Date.now()}-${process.pid}`);
  await mkdir(tmp, { recursive: true });

  const tar = spawn("tar", ["-xzf", "-", "-C", tmp, "--strip-components=1"], {
    stdio: ["pipe", "inherit", "inherit"],
  });
  const exit = new Promise((r, j) => {
    tar.on("error", j);
    tar.on("exit", (code) => (code === 0 ? r() : j(new Error(`tar exited ${code}`))));
  });
  await pipeline(Readable.fromWeb(res.body), tar.stdin);
  await exit;

  const skills = await listSkillsIn(tmp);
  for (const name of skills) {
    const dest = join(sourceCache, name);
    if (existsSync(dest)) await rm(dest, { recursive: true, force: true });
    await rename(join(tmp, name), dest);
  }
  await rm(tmp, { recursive: true, force: true });
  console.log(`Cached ${skills.length} skill(s) at ${sourceCache}`);
  return sourceCache;
}

async function resolveSource() {
  if (forceLocal) {
    if (!hasGit(repoRoot)) {
      console.warn(`Warning: --local set but ${repoRoot} has no .git`);
    }
    return repoRoot;
  }
  if (forceFetch) return await fetchTarballSource();
  if (hasGit(repoRoot) && !isEphemeralPath(repoRoot)) return repoRoot;
  return await fetchTarballSource();
}

async function linkSkill(sourceDir, name) {
  const src = join(sourceDir, name);
  const dest = join(skillsTarget, name);

  const info = await lstat(dest).catch(() => null);
  if (info) {
    if (info.isSymbolicLink()) {
      const current = await readlink(dest);
      const resolved = resolve(skillsTarget, current);
      if (resolved === src) {
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
  const sourceDir = await resolveSource();
  const available = await listSkillsIn(sourceDir);

  if (available.length === 0) {
    console.error(`No skills found at ${sourceDir} (need SKILL.md inside each skill dir).`);
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
  for (const name of skills) await linkSkill(sourceDir, name);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
