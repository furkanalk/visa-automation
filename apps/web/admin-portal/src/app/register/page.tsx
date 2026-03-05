"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { staffApi } from "@/lib/api";
import { Lock, Eye, EyeOff, Loader2, CheckCircle, ShieldAlert } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [invite, setInvite] = useState<{ email: string; name: string } | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setFetching(false);
      setError("Invalid link. No token provided.");
      return;
    }
    staffApi
      .getInviteByToken(token)
      .then((data) => {
        setInvite(data);
        setError("");
      })
      .catch(() => {
        setError("Invite link is invalid or expired.");
        setInvite(null);
      })
      .finally(() => setFetching(false));
  }, [token]);

  const passwordStrength = (() => {
    if (password.length === 0) return null;
    if (password.length < 8) return { level: 0, label: "Too short", color: "bg-red-400" };
    let score = 0;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    if (score === 0) return { level: 1, label: "Weak", color: "bg-orange-400" };
    if (score === 1) return { level: 2, label: "Fair", color: "bg-yellow-400" };
    if (score === 2) return { level: 3, label: "Good", color: "bg-blue-400" };
    return { level: 4, label: "Strong", color: "bg-green-500" };
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await staffApi.completeRegistration(token, password);
      setDone(true);
      setTimeout(() => router.push("/login?registered=1"), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed. The link may have expired.");
    } finally {
      setLoading(false);
    }
  };

  // ── Loading state ──────────────────────────────────────────────────
  if (fetching) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-950 dark:to-slate-900">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Verifying invite link…</p>
        </div>
      </div>
    );
  }

  // ── Invalid token ──────────────────────────────────────────────────
  if (!token || !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-950 dark:to-slate-900 p-4">
        <Card className="w-full max-w-sm border-0 shadow-xl">
          <CardContent className="pt-10 pb-8 flex flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <ShieldAlert className="h-7 w-7 text-red-500" />
            </div>
            <div>
              <p className="font-semibold text-slate-900 dark:text-white text-lg">Invalid invite link</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{error || "This link is invalid or has already been used."}</p>
            </div>
            <Link
              href="/login"
              className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
            >
              Go to sign in
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Success state ──────────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-950 dark:to-slate-900 p-4">
        <Card className="w-full max-w-sm border-0 shadow-xl">
          <CardContent className="pt-10 pb-8 flex flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <CheckCircle className="h-7 w-7 text-green-500" />
            </div>
            <div>
              <p className="font-semibold text-slate-900 dark:text-white text-lg">Account activated!</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Your password has been set. Redirecting to sign in…</p>
            </div>
            <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1 overflow-hidden">
              <div className="h-full bg-indigo-500 animate-[shrink_2.5s_linear_forwards] rounded-full" style={{ animation: "progress 2.5s linear forwards" }} />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Main form ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-950 dark:to-slate-900 p-4">
      <div className="w-full max-w-sm">
        {/* Logo / brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-200 dark:shadow-indigo-900/40 mb-4">
            <Lock className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Set your password</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Complete your Vizeself Manager account</p>
        </div>

        <Card className="border-0 shadow-xl">
          <CardContent className="pt-6 pb-6">
            {/* Account info */}
            <div className="mb-5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-4 py-3">
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-0.5">Signing up as</p>
              <p className="font-semibold text-slate-800 dark:text-slate-100 text-sm">{invite.name}</p>
              <p className="text-slate-500 dark:text-slate-400 text-sm">{invite.email}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Error */}
              {error && (
                <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">
                  {error}
                </div>
              )}

              {/* Email read-only */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email</label>
                <Input
                  type="email"
                  value={invite.email}
                  readOnly
                  className="bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-default select-none"
                  tabIndex={-1}
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  New password
                </label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    className="pr-10"
                    required
                    minLength={8}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {/* Strength bar */}
                {passwordStrength && (
                  <div className="mt-2">
                    <div className="flex gap-1 mb-1">
                      {[1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-colors ${
                            i <= passwordStrength.level ? passwordStrength.color : "bg-slate-200 dark:bg-slate-700"
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-slate-400">{passwordStrength.label}</p>
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Confirm password
                </label>
                <div className="relative">
                  <Input
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    className={`pr-10 ${
                      confirmPassword.length > 0 && confirmPassword !== password
                        ? "border-red-400 focus-visible:ring-red-400"
                        : confirmPassword.length > 0 && confirmPassword === password
                        ? "border-green-400 focus-visible:ring-green-400"
                        : ""
                    }`}
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    tabIndex={-1}
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {confirmPassword.length > 0 && confirmPassword !== password && (
                  <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold h-11 mt-2"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Activating account…
                  </>
                ) : (
                  "Activate my account"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-slate-400 dark:text-slate-500 mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
