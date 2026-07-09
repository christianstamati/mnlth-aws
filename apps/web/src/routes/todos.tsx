import { convexQuery, useConvexMutation } from "@convex-dev/react-query"
import { useMutation, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { api } from "@workspace/backend/convex/_generated/api"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import { Separator } from "@workspace/ui/components/separator"
import { ArrowLeft, Plus, Trash2 } from "lucide-react"
import { useState } from "react"

const todosQuery = convexQuery(api.todos.list, {})

export const Route = createFileRoute("/todos")({
  loader: ({ context }) => context.queryClient.ensureQueryData(todosQuery),
  component: TodosPage,
})

function TodosPage() {
  const { data: todos } = useSuspenseQuery(todosQuery)
  const [text, setText] = useState("")

  const add = useMutation({ mutationFn: useConvexMutation(api.todos.add) })
  const remove = useMutation({
    mutationFn: useConvexMutation(api.todos.remove),
  })
  const toggle = useMutation({
    mutationFn: useConvexMutation(api.todos.toggle),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    add.mutate({ text: trimmed })
    setText("")
  }

  return (
    <div className="flex min-h-svh items-start justify-center bg-muted/40 p-6 pt-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Todos</CardTitle>
          <CardDescription>
            Stored in Convex — live across tabs.
          </CardDescription>
          <CardAction>
            <Badge variant={todos.length === 0 ? "secondary" : "default"}>
              {todos.length}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What needs doing?"
              aria-label="New todo"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!text.trim() || add.isPending}
              aria-label="Add todo"
            >
              <Plus />
            </Button>
          </form>

          <Separator />

          {todos.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground text-sm">
              No todos yet — add one above.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {todos.map((todo) => (
                <li
                  key={todo._id}
                  className="group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Checkbox
                      checked={todo.completed ?? false}
                      onCheckedChange={() => toggle.mutate({ id: todo._id })}
                      aria-label={
                        todo.completed
                          ? `Mark "${todo.text}" as not done`
                          : `Mark "${todo.text}" as done`
                      }
                    />
                    <span
                      className={`min-w-0 break-words text-sm ${
                        todo.completed
                          ? "text-muted-foreground line-through"
                          : ""
                      }`}
                    >
                      {todo.text}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => remove.mutate({ id: todo._id })}
                    aria-label={`Remove "${todo.text}"`}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <Separator />

          <Link
            to="/"
            className="flex items-center gap-1 text-muted-foreground text-sm hover:underline"
          >
            <ArrowLeft className="size-3.5" />
            Back to counter
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
