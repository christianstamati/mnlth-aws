import { convexTest } from "convex-test"
import { expect, test } from "vitest"
import { api } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

test("add then list returns the todo newest-first", async () => {
  const t = convexTest(schema, modules)
  const firstId = await t.mutation(api.todos.add, { text: "first" })
  const secondId = await t.mutation(api.todos.add, { text: "  second  " })
  const todos = await t.query(api.todos.list, {})
  expect(todos).toHaveLength(2)
  expect(todos[0]._id).toBe(secondId)
  expect(todos[0].text).toBe("second")
  expect(todos[1]._id).toBe(firstId)
  expect(todos[1].text).toBe("first")
})

test("add with empty or whitespace text throws", async () => {
  const t = convexTest(schema, modules)
  await expect(t.mutation(api.todos.add, { text: "" })).rejects.toThrow()
  await expect(t.mutation(api.todos.add, { text: "   " })).rejects.toThrow()
  expect(await t.query(api.todos.list, {})).toHaveLength(0)
})

test("remove deletes the todo", async () => {
  const t = convexTest(schema, modules)
  const id = await t.mutation(api.todos.add, { text: "delete me" })
  await t.mutation(api.todos.remove, { id })
  expect(await t.query(api.todos.list, {})).toHaveLength(0)
})

test("toggle flips undefined to true, then true to false", async () => {
  const t = convexTest(schema, modules)
  const id = await t.mutation(api.todos.add, { text: "toggle me" })

  const [before] = await t.query(api.todos.list, {})
  expect(before.completed).toBeUndefined()

  await t.mutation(api.todos.toggle, { id })
  const [afterFirst] = await t.query(api.todos.list, {})
  expect(afterFirst.completed).toBe(true)

  await t.mutation(api.todos.toggle, { id })
  const [afterSecond] = await t.query(api.todos.list, {})
  expect(afterSecond.completed).toBe(false)
})

test("toggle on a deleted todo throws", async () => {
  const t = convexTest(schema, modules)
  const id = await t.mutation(api.todos.add, { text: "gone" })
  await t.mutation(api.todos.remove, { id })
  await expect(t.mutation(api.todos.toggle, { id })).rejects.toThrow()
})
