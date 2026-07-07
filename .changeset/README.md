# Changesets

This folder is used by [Changesets](https://github.com/changesets/changesets) to version packages and generate changelogs.

## Workflow

1. In any PR that changes behavior, run `bun changeset` and follow the prompts: pick the affected packages, the bump type (`patch`/`minor`/`major`), and write a short human-readable summary. Commit the generated file in `.changeset/`.
2. When PRs with changesets land on `main`, the release workflow opens (or updates) a **"chore: version packages"** PR that accumulates the pending bumps and changelog entries.
3. Merging that PR tags each bumped package (e.g. `@workspace/backend@0.1.0`), updates the `CHANGELOG.md` files, and creates the corresponding GitHub Releases.

Pure chores (CI tweaks, docs) don't need a changeset.
