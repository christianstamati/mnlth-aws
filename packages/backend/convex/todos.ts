import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("todos"),
      _creationTime: v.number(),
      text: v.string(),
      completed: v.optional(v.boolean()),
    })
  ),
  handler: async (ctx) => {
    // Newest-first via the built-in by_creation_time index; bounded so the
    // read stays within limits as the table grows.
    return await ctx.db.query("todos").order("desc").take(1000)
  },
})

export const add = mutation({
  args: { text: v.string() },
  returns: v.id("todos"),
  handler: async (ctx, args) => {
    const text = args.text.trim()
    if (text === "") {
      throw new Error("Todo text cannot be empty")
    }
    return await ctx.db.insert("todos", { text })
  },
})

export const remove = mutation({
  args: { id: v.id("todos") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id)
    return null
  },
})

export const toggle = mutation({
  args: { id: v.id("todos") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const todo = await ctx.db.get(args.id)
    if (todo === null) {
      throw new Error("Todo not found")
    }
    // `completed` is optional on pre-existing docs; undefined counts as false.
    await ctx.db.patch(args.id, { completed: !(todo.completed ?? false) })
    return null
  },
})

export const count = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const todos = await ctx.db.query("todos").take(1000)
    return todos.length
  },
})
