'use client';
/*
=======================================================================================================================================
Page: /login
=======================================================================================================================================
Purpose: Username + password form -> AuthContext.login() -> on success go to /dashboard (CLAUDE.md). Uses react-hook-form for the
         form and surfaces API-level errors inline (the API client never throws; we read result.error). No public signup (CLAUDE.md).
=======================================================================================================================================
*/

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

interface LoginForm { username: string; password: string; }

export default function LoginPage() {
  const router = useRouter();
  const { login, ready, isAuthenticated } = useAuth();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>();
  const [apiError, setApiError] = useState<string | null>(null);

  // If already logged in, skip the form.
  useEffect(() => {
    if (ready && isAuthenticated) router.replace('/dashboard');
  }, [ready, isAuthenticated, router]);

  async function onSubmit(values: LoginForm) {
    setApiError(null);
    const result = await login(values.username, values.password);
    if (result.success) {
      router.replace('/dashboard');
    } else {
      // Inline error — the caller decides how to present API errors (API-RULES).
      setApiError(result.error || 'Login failed');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Brookfield Comfort</h1>
          <p className="mt-1 text-sm text-slate-500">Internal platform — sign in</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Username</label>
            <input
              type="text"
              autoComplete="username"
              autoFocus
              {...register('username', { required: 'Username is required' })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            {errors.username && <p className="mt-1 text-xs text-red-600">{errors.username.message}</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              {...register('password', { required: 'Password is required' })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
          </div>

          {apiError && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{apiError}</div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
