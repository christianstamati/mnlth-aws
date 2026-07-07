# MNLTH

TanStack Start + Convex monorepo.

- `apps/web` — TanStack Start app (Vite), deployed to Vercel
- `packages/backend` — Convex backend (schema + functions + tests)
- `packages/ui` — shared shadcn/ui components

## Stack

| Concern                 | Tool                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Build / monorepo        | [Turborepo](https://turborepo.com) + [Bun](https://bun.sh) workspaces                                                                        |
| Web app                 | [TanStack Start](https://tanstack.com/start) (React 19, Vite, SSR) + React Compiler                                                          |
| Backend & database      | [Convex](https://convex.dev) (`packages/backend`)                                                                                            |
| Data fetching           | [TanStack Query](https://tanstack.com/query) with the [Convex adapter](https://docs.convex.dev/client/tanstack-query) (live, real-time)      |
| Design system           | [shadcn/ui](https://ui.shadcn.com) on [Base UI](https://base-ui.com) + Tailwind CSS v4 (`packages/ui`)                                       |
| Testing                 | [Vitest](https://vitest.dev) + [convex-test](https://docs.convex.dev/testing/convex-test) (edge-runtime)                                     |
| Lint / format           | [Biome](https://biomejs.dev)                                                                                                                 |
| Pre-commit              | [lefthook](https://github.com/evilmartians/lefthook) (Biome on staged files)                                                                 |
| CI                      | GitHub Actions (lint, typecheck, test)                                                                                                       |
| Code review             | [Greptile](https://greptile.com) (AI review on every PR, configured in `greptile.json`)                                                      |
| Versioning / changelog  | [Changesets](https://github.com/changesets/changesets) (version PR → tags + GitHub Releases)                                                 |
| Deployment              | [Vercel](https://vercel.com) (web) + Convex preview/production deployments                                                                   |

## Getting started (new developer)

Prerequisites: [Bun](https://bun.sh) ≥ 1.3, Node ≥ 20, and an invite to the
`chridev` Convex team (ask a teammate).

```bash
git clone <repo-url> && cd mnlth
bun run setup   # installs deps, logs you into Convex, provisions a LOCAL deployment, writes env files
bun dev         # starts Convex (local) + the web app on http://localhost:3000
```

`bun run setup` does three things:

1. `bun install`
2. `convex dev --once --configure existing --dev-deployment local` in
   `packages/backend` — on first run this opens a browser to log in to Convex,
   then creates a **local deployment** (the Convex backend runs entirely on your
   machine) and writes `packages/backend/.env.local`
3. `bun run env:sync` — copies the local deployment URL into
   `apps/web/.env.local` as `VITE_CONVEX_URL`

After that, day-to-day is just `bun dev`. Nothing you do locally can touch
production — your Convex deployment is local to your machine.

If the web app ever complains about a missing/incorrect `VITE_CONVEX_URL`, run
`bun run env:sync` again.

## Branch & deploy flow

1. Branch off `main` (e.g. `feat/thing`), commit, push, open a PR.
2. GitHub Actions runs **CI** (Biome lint/format + typecheck + tests) and
   **Greptile** posts an automatic AI review with inline comments.
3. Vercel builds a **preview deployment**; during the build, `convex deploy`
   (with the *preview* deploy key) creates a matching **Convex preview
   deployment** named after the branch, and the preview frontend is pointed at
   it. Each PR gets its own isolated full-stack environment.
4. Fix review findings, merge.
5. On merge to `main`, Vercel builds production; `convex deploy` (with the
   *production* deploy key) pushes functions/schema to the production Convex
   deployment.

## Releases (Changesets)

- In any PR that changes behavior, run `bun changeset`, pick the affected
  packages and bump type, write a one-line summary, and commit the generated
  file. Pure chores don't need one.
- When changesets land on `main`, the **Release** workflow keeps a
  **"chore: version packages"** PR up to date with the pending bumps and
  changelog entries.
- Merging that PR tags each bumped package (e.g. `@workspace/backend@0.1.0`),
  updates the `CHANGELOG.md` files, and creates GitHub Releases.

## Testing

Backend unit tests live next to the functions as
`packages/backend/convex/*.test.ts` and run against an in-memory Convex via
`convex-test`:

```bash
bun run test                              # all packages (turbo)
bun run --cwd packages/backend test:watch # watch mode
```

New test files import the module map from `convex/test.setup.ts`
(`convexTest(schema, modules)`), which keeps module discovery reliable under
Bun's isolated linker.

## Adding UI components

Run at the repo root:

```bash
bunx shadcn@latest add button -c apps/web
```

Components land in `packages/ui/src/components` and are imported as:

```tsx
import { Button } from "@workspace/ui/components/button"
```

## One-time project configuration

### Vercel

- **Root Directory**: `apps/web`
- **Install Command**: `bun install`
- **Build Command**:

  ```bash
  cd ../../packages/backend && bunx convex deploy --cmd-url-env-var-name VITE_CONVEX_URL --cmd 'cd ../../apps/web && bun run build'
  ```

- **Environment variables**:
  - Production scope: `CONVEX_DEPLOY_KEY` = production deploy key
    (Convex dashboard → project → Settings → Deploy keys → *Production*)
  - Preview scope: `CONVEX_DEPLOY_KEY` = preview deploy key
    (same page → *Preview* — requires the Convex Pro plan)

`convex deploy` reads the key to decide where to deploy: a preview key makes it
create/update a preview deployment named after the git branch; the production
key deploys to production. In both cases it injects the right
`VITE_CONVEX_URL` into the frontend build.

### GitHub

- Install the [Greptile GitHub App](https://github.com/apps/greptile) and
  enable the repo at [app.greptile.com](https://app.greptile.com); per-repo
  review behavior lives in `greptile.json`.
- Settings → Actions → General: enable **"Allow GitHub Actions to create and
  approve pull requests"** (required by the Changesets release workflow).
- `main` is protected and requires the CI `check` status. Note: version PRs
  are pushed by the Actions bot, whose pushes don't trigger workflows — merge
  those with admin privileges, or switch the release workflow to a PAT/App
  token if you want CI to run on them.
