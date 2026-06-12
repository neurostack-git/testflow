import { cn } from "@/lib/utils";

const sizes = { xs: "w-3.5 h-3.5", sm: "w-4 h-4", md: "w-5 h-5", lg: "w-7 h-7" } as const;

export function Spinner({ size = "md", className }: { size?: keyof typeof sizes; className?: string }) {
  return (
    <div className={cn(sizes[size], "rounded-full border-2 border-primary border-t-transparent animate-spin", className)} />
  );
}
