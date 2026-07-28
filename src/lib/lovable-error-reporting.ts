// Error reporting utility — reports errors to the console in development.
export function reportLovableError(error: unknown, context: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === "development") {
    console.error("[Error Boundary]", error, context);
  }
}
