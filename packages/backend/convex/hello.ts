import { v } from "convex/values"
import { query } from "./_generated/server"

export const greet = query({
  args: { name: v.optional(v.string()) },
  returns: v.string(),
  handler: async (_ctx, args) => {
    return `Hello, ${args.name ?? "world"}!`
  },
})
