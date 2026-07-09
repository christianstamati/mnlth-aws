import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  todos: defineTable({
    text: v.string(),
    // Optional: production has documents created before this field existed.
    completed: v.optional(v.boolean()),
  }),
})
