import { convexTest } from "convex-test"
import { expect, test } from "vitest"
import { api } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

test("greet returns hello world by default", async () => {
  const t = convexTest(schema, modules)
  expect(await t.query(api.hello.greet, {})).toBe("Hello, world!")
})

test("greet greets by name", async () => {
  const t = convexTest(schema, modules)
  expect(await t.query(api.hello.greet, { name: "Chris" })).toBe(
    "Hello, Chris!"
  )
})
