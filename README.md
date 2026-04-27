# skills

Personal collection of [Claude Code](https://docs.claude.com/en/docs/claude-code/skills) skills.

Each top-level directory containing a `SKILL.md` is a skill. The install script symlinks every such directory into `~/.claude/skills/`, so edits in the repo are picked up immediately by Claude Code.

## Skills

- **syncing-shopping-cart** — sync a markdown shopping list to a Woolworths online cart via Playwright MCP.

## Install

One-shot via npx (no clone needed for runtime, but recommended to clone first so symlinks point at a stable path):

```bash
git clone git@github.com:martinwheeler/skills.git ~/code/skills
cd ~/code/skills
npx . # or: node bin/install.mjs
```

Or fetch + run directly:

```bash
npx github:martinwheeler/skills
```

Install just one skill (or several) by name:

```bash
npx github:martinwheeler/skills syncing-shopping-cart
```

Flags:

- `--dry-run` / `-n` — show what would happen, change nothing.
- `--force` / `-f` — back up and replace any existing non-symlink skill of the same name.
- `--help` / `-h` — show usage.

The script:

1. Ensures `~/.claude/skills/` exists.
2. For each skill dir at the repo root (containing `SKILL.md`), creates a symlink at `~/.claude/skills/<name>` pointing back into the repo.
3. Skips entries that already point at the right target. Refuses to clobber a real directory unless `--force`.

## Adding a new skill

1. Create `<skill-name>/SKILL.md` at the repo root with required frontmatter (`name`, `description`).
2. Drop any supporting files alongside (`scripts/`, `reference/`, `assets/`, etc.).
3. Commit + run `node bin/install.mjs` on each machine that should pick it up.
