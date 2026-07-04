'use client';
/*
 * Root index page. Pure router: send authenticated users to /dashboard, everyone else to /login (CLAUDE.md folder layout note:
 * "page.tsx -> redirect to /login or /dashboard"). We wait for AuthContext.ready so we don't redirect during hydration.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function Home() {
  const router = useRouter();
  const { ready, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!ready) return;
    router.replace(isAuthenticated ? '/dashboard' : '/login');
  }, [ready, isAuthenticated, router]);

  // Minimal splash while we decide where to go.
  return (
    <div className="flex min-h-screen items-center justify-center text-slate-400">
      Loading…
    </div>
  );
}
