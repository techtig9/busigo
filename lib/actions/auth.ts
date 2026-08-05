"use server";

import { createServerSupabase, createServiceRoleSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PLAN_CREDITS } from "@/lib/plans";

export interface ActionResult {
  error?: string;
}

export async function signUpAction(formData: FormData): Promise<ActionResult> {
  const name = String(formData.get("name") || "");
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");

  if (!name || !email || !password) return { error: "All fields are required." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const supabase = createServerSupabase();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || ""}/auth/callback`,
    },
  });

  if (error) return { error: error.message };
  if (!data.user) return { error: "Sign up failed — please try again." };

  // Mirror the auth user into public.users and give them a Free subscription row.
  // Uses the service-role client because RLS on `users`/`subscriptions` restricts writes
  // to the row owner, and at this instant the session cookie may not be set yet.
  const admin = createServiceRoleSupabase();
  await admin.from("users").insert({ id: data.user.id, name, email, role: "user" });
  await admin.from("subscriptions").insert({
    user_id: data.user.id,
    plan: "free",
    status: "active",
    credits_remaining: PLAN_CREDITS.free,
  });

  // Deliberately does NOT call redirect() here: the caller (SignupForm) awaits this inside a
  // try/catch, and redirect()'s internal NEXT_REDIRECT signal would be caught there as a
  // normal error instead of triggering navigation. The client navigates on success instead.
  return {};
}

export async function signInAction(formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");

  const supabase = createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  // See the comment in signUpAction — no redirect() here; the client navigates on success.
  return {};
}

export async function signInWithGoogleAction() {
  const supabase = createServerSupabase();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || ""}/auth/callback` },
  });
  if (error || !data.url) return;
  redirect(data.url);
}

export async function signOutAction() {
  const supabase = createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordResetAction(formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") || "");
  const supabase = createServerSupabase();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || ""}/reset-password`,
  });
  if (error) return { error: error.message };
  return {};
}

export async function updatePasswordAction(formData: FormData): Promise<ActionResult> {
  const password = String(formData.get("password") || "");
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const supabase = createServerSupabase();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  // See the comment in signUpAction — no redirect() here; the client navigates on success.
  return {};
}
