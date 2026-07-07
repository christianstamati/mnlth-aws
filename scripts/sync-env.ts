// Copies the Convex deployment URL from packages/backend/.env.local
// (written by `convex dev`) into apps/web/.env.local as VITE_CONVEX_URL,
// preserving any other variables already present in the web env file.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const backendEnvPath = join(root, "packages/backend/.env.local")
const webEnvPath = join(root, "apps/web/.env.local")

if (!existsSync(backendEnvPath)) {
  console.error(
    "packages/backend/.env.local not found. Run `bun run setup` first — it starts Convex and writes the deployment env file."
  )
  process.exit(1)
}

const backendEnv = readFileSync(backendEnvPath, "utf8")
const match = backendEnv.match(/^CONVEX_URL=(.+)$/m)
if (!match) {
  console.error(`CONVEX_URL not found in ${backendEnvPath}`)
  process.exit(1)
}
const convexUrl = match[1].trim()

const line = `VITE_CONVEX_URL=${convexUrl}`
let webEnv = existsSync(webEnvPath) ? readFileSync(webEnvPath, "utf8") : ""
if (/^VITE_CONVEX_URL=.*$/m.test(webEnv)) {
  webEnv = webEnv.replace(/^VITE_CONVEX_URL=.*$/m, line)
} else {
  webEnv =
    webEnv.length && !webEnv.endsWith("\n")
      ? `${webEnv}\n${line}\n`
      : `${webEnv}${line}\n`
}
writeFileSync(webEnvPath, webEnv)
console.log(`apps/web/.env.local → ${line}`)
