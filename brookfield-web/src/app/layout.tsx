import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';

// Root layout for the whole platform. Wraps everything in AuthProvider so any page/component can read auth state and guard itself.
export const metadata: Metadata = {
  title: 'Brookfield Comfort — Platform',
  description: 'Internal platform for Brookfield Comfort',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
