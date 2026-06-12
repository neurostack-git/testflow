import { cn } from "@/lib/utils";

export function ErrorAlert({ message, className }: { message?: string | null; className?: string }) {
  if (!message) return null;
  return (
    <p className={cn("text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg", className)}>
      {message}
    </p>
  );
}
