"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signInAction, signInWithGoogleAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import Link from "next/link";

export function LoginForm({ justVerified }: { justVerified?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await signInAction(formData);
          if (result?.error) setError(result.error);
          else router.push("/dashboard");
        });
      }}
    >
      {justVerified && (
        <p className="rounded border border-pulse/30 bg-pulse/10 px-3 py-2 text-sm text-ink">
          Check your inbox to verify your email, then log in below.
        </p>
      )}
      {error && <p className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div>
        <Label>Email</Label>
        <Input name="email" type="email" required autoComplete="email" />
      </div>
      <div>
        <Label>Password</Label>
        <Input name="password" type="password" required autoComplete="current-password" />
      </div>
      <div className="flex items-center justify-between text-sm">
        <Link href="/forgot-password" className="text-signal hover:underline">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Logging in..." : "Log In"}
      </Button>
      <form action={signInWithGoogleAction}>
        <Button type="submit" variant="secondary" className="w-full">
          Continue with Google
        </Button>
      </form>
      <p className="text-center text-sm text-slate">
        No account?{" "}
        <Link href="/signup" className="text-signal hover:underline">
          Sign up
        </Link>
      </p>
    </form>
  );
}
