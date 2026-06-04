"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    // Surface to the console for debugging; replace with a logger if added later.
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="w-14 h-14 bg-destructive/10 rounded-2xl flex items-center justify-center mb-4">
        <AlertTriangle className="w-7 h-7 text-destructive" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">
        An unexpected error occurred while loading this page. You can try again,
        or head back to your dashboard.
      </p>
      <div className="flex items-center gap-3 mt-6">
        <Button onClick={reset} className="gap-2 bg-primary hover:bg-primary/90">
          <RotateCcw className="w-4 h-4" />
          Try again
        </Button>
        <Button variant="outline" onClick={() => router.push("/dashboard")}>
          Go to dashboard
        </Button>
      </div>
    </div>
  );
}
