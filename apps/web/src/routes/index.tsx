import { createFileRoute, Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { ButtonGroup } from "@workspace/ui/components/button-group"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Minus, Plus, RotateCcw } from "lucide-react"
import { useState } from "react"

export const Route = createFileRoute("/")({ component: App })

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-muted/40 p-6">
      <Card className="w-full max-w-xs">
        <CardHeader>
          <CardTitle>Counter</CardTitle>
          <CardDescription>Project ready — start building.</CardDescription>
          <CardAction>
            <Badge
              variant={
                count === 0
                  ? "secondary"
                  : count > 0
                    ? "default"
                    : "destructive"
              }
            >
              {count === 0 ? "zero" : count > 0 ? "positive" : "negative"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex justify-center py-8">
          <span className="font-heading font-semibold text-6xl tabular-nums tracking-tight">
            {count}
          </span>
        </CardContent>
        <CardFooter className="justify-between">
          <ButtonGroup>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCount((c) => c - 1)}
              aria-label="Decrement"
            >
              <Minus />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCount((c) => c + 1)}
              aria-label="Increment"
            >
              <Plus />
            </Button>
          </ButtonGroup>
          <Button variant="ghost" size="sm" onClick={() => setCount(0)}>
            <RotateCcw />
            Reset
          </Button>
        </CardFooter>
      </Card>
      <Link
        to="/todos"
        className="text-muted-foreground text-sm hover:underline"
      >
        Todos →
      </Link>
    </div>
  )
}
