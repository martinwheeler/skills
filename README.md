# skills

Personal collection of [Claude Code](https://docs.claude.com/en/docs/claude-code/skills) skills.

Each top-level directory containing a `SKILL.md` is a skill. The install script symlinks every such directory into `~/.claude/skills/`, so edits in the repo are picked up immediately by Claude Code.

## Skills

- **syncing-shopping-cart** — sync a markdown shopping list to a Woolworths online cart via Playwright MCP.

## Install

No clone required — fetch and install in one shot:

```bash
npx github:martinwheeler/skills                          # all skills
npx github:martinwheeler/skills syncing-shopping-cart    # one
npx github:martinwheeler/skills a b c                    # several
```

The script downloads a tarball from GitHub, extracts only the skills it needs into `~/.claude/skills-source/`, then symlinks each into `~/.claude/skills/`. Re-run any time to update — it overwrites the cached source and refreshes symlinks.

For development, clone and run from the working tree (script auto-detects `.git` and uses the local clone as the symlink source):

```bash
git clone git@github.com:martinwheeler/skills.git ~/code/skills
cd ~/code/skills
node bin/install.mjs
```

Flags:

- `--fetch` — force download from GitHub even when run from a clone.
- `--local` — force use of the local repo (skip download).
- `--dry-run` / `-n` — show what would happen, change nothing.
- `--force` / `-f` — back up and replace any existing non-symlink skill of the same name.
- `--help` / `-h` — show usage.

Env:

- `SKILLS_REPO=owner/repo` — override the source repo.
- `SKILLS_REF=branch|sha` — override the ref (default `HEAD`).

The script:

1. Ensures `~/.claude/skills/` exists.
2. For each skill dir at the repo root (containing `SKILL.md`), creates a symlink at `~/.claude/skills/<name>` pointing back into the repo.
3. Skips entries that already point at the right target. Refuses to clobber a real directory unless `--force`.

## Adding a new skill

1. Create `<skill-name>/SKILL.md` at the repo root with required frontmatter (`name`, `description`).
2. Drop any supporting files alongside (`scripts/`, `reference/`, `assets/`, etc.).
3. Commit + run `node bin/install.mjs` on each machine that should pick it up.
