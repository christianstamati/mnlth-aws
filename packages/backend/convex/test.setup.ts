/**
 * Explicit module map for convex-test.
 *
 * convex-test's zero-arg default resolves the convex/ directory relative to
 * its own install location inside node_modules, which is unreliable in a
 * monorepo (hoisting can move the package). Passing the glob from inside
 * convex/ makes module discovery deterministic: `convexTest(schema, modules)`.
 *
 * The `!./**\/*.*.*` negation excludes multi-dot files (*.test.ts, *.d.ts,
 * this file) — the same rule the Convex CLI bundler uses to skip them on
 * deploy. (The `!(*.*.*)` extglob shown in older convex-test docs matches
 * nothing under Vite >= 6, whose glob engine dropped extglob support.)
 */

declare global {
  interface ImportMeta {
    /** Provided by Vite at test time; typed here so `tsc -p convex` passes. */
    glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>
  }
}

export const modules = import.meta.glob([
  "./**/*.ts",
  "./**/*.js",
  "!./**/*.*.*",
])
