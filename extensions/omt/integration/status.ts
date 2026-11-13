export function withFallback(message: string, issues: string[]): string {
    return issues.length ? `${message} Native fallback: ${issues.join(" ")}` : message;
  }

