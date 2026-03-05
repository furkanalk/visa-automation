"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/stores/auth";
import { useThemeStore } from "@/stores/theme";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Lock, ShieldX, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((state) => state.login);
  const { theme, setTheme } = useThemeStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setTheme(theme);
  }, [theme, setTheme]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setErrorCode("");
    setLoading(true);

    try {
      const success = await login(email, password);
      if (success) {
        router.push("/");
      } else {
        setError("Invalid email or password");
      }
    } catch (err) {
      const code = (err as any).code ?? "";
      setErrorCode(code);
      setError(err instanceof Error ? err.message : "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f0f7ff] dark:bg-slate-900 transition-colors duration-300 relative">
      {/* Theme toggle in corner */}
      <div className="absolute top-6 right-6">
        <ThemeToggle size="md" />
      </div>

      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 dark:bg-primary/20">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl text-gray-900 dark:text-white">Welcome</CardTitle>
          <CardDescription>
            Sign in to Vizeself Manager
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className={`flex gap-3 rounded-md p-3 text-sm ${
                errorCode === "ACCOUNT_SUSPENDED"
                  ? "bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800"
                  : errorCode === "ACCOUNT_PENDING"
                  ? "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
                  : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800"
              }`}>
                {errorCode === "ACCOUNT_SUSPENDED" ? (
                  <ShieldX className="h-4 w-4 mt-0.5 shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                )}
                <div>
                  <p className="font-medium">{error}</p>
                  {errorCode === "ACCOUNT_SUSPENDED" && (
                    <p className="text-xs mt-1 opacity-80">Contact your administrator to restore access.</p>
                  )}
                </div>
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@visa-automation.local"
                className="mt-1"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
          <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
            <p>Use your admin credentials.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
