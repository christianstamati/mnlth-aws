# MNLTH

TanStack Start + Convex monorepo.

- `apps/web` — TanStack Start app (Vite), deployed to AWS
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
| Deployment              | AWS via [SST](https://sst.dev) — web on Lambda+CloudFront, self-hosted Convex on ECS Fargate + RDS Postgres + S3                             |

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
3. The SST Console autodeploys an **isolated preview stage** (`pr-<number>`):
   its own web deployment **and its own Convex backend** (dedicated Fargate
   task, own database on the shared RDS server, own S3 buckets and CloudFront
   URLs). The preview URL is commented on the PR automatically.
4. Fix review findings, merge. Closing the PR tears the preview stage down
   (the preview's database on RDS is left behind — drop it manually if you
   care; they're tiny).
5. On merge to `main`, the SST Console deploys the `production` stage:
   infrastructure, Convex functions (pushed automatically during the deploy),
   and the web app.

## Deployment (AWS via SST)

Everything is defined in `sst.config.ts` and deployed with:

```bash
bunx sst deploy --stage production
```

The production stage runs:

- **Web**: TanStack Start on Lambda (nitro `aws-lambda` preset) behind
  CloudFront, assets on S3
- **Convex (self-hosted)**: `ghcr.io/get-convex/convex-backend` on ECS
  Fargate (1 vCPU / 2 GB) behind an ALB, RDS Postgres (`db.t4g.micro`,
  database `mnlth`), five S3 buckets for storage, and two CloudFront
  distributions for HTTPS (API on origin port 80 → 3210, HTTP actions on
  origin port 3211)
- Convex functions are pushed automatically during every production deploy

Preview stages (`pr-<n>`, or any non-production stage such as a personal
`bunx sst deploy --stage chris`) run the same shape at ~$0.70/day: a
0.5 vCPU / 1 GB Convex task that reuses production's VPC and ALB. Preview
traffic is routed by an `x-mnlth-stage` header that each preview's CloudFront
distribution adds and ALB listener rules match; the stage database
(`mnlth_pr_<n>`) is created on the shared RDS server by an in-VPC Lambda at
deploy time, and functions are deployed with an admin key derived via Docker.

Secrets (set once per stage with `bunx sst secret set <name> <value>`):

- `ConvexInstanceSecret` — 64-char hex; the backend's root secret
- `ConvexAdminKey` — derived from the instance secret; regenerate with:
  `docker run --rm --entrypoint ./generate_admin_key.sh -e INSTANCE_NAME=mnlth -e INSTANCE_SECRET=<secret> ghcr.io/get-convex/convex-backend:latest`

To target the self-hosted backend with the Convex CLI:

```bash
CONVEX_DEPLOYMENT="" \
CONVEX_SELF_HOSTED_URL=<convexApi url> \
CONVEX_SELF_HOSTED_ADMIN_KEY=<admin key> \
bunx convex <command>
```

Gotchas encoded in `sst.config.ts` (don't "clean them up"):

- RDS connects with `?sslmode=disable` + `rds.force_ssl=0` because the
  Convex backend can't verify Amazon's private RDS CA (VPC-internal traffic)
- The ALB DNS name is hardcoded to break a CloudFront↔ECS env circular
  dependency — update it if the ALB is ever recreated
- CloudFront can't reach origins on ports 81–1023, hence listener 3211
- The site-proxy health check accepts 404 (no HTTP action at `/`)
- Preview stages hardcode production's VPC/ALB/listener/subnet IDs — update
  the `prod` constants in the preview branch if production plumbing is ever
  recreated
- The GitHub deployment reporting in the autodeploy workflow needs
  `GITHUB_TOKEN` in the SST Console runner env (both environments); it
  no-ops silently without it

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
