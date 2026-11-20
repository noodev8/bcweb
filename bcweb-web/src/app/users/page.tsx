'use client';
/*
=======================================================================================================================================
Page: /users  (Admin -> Users)
=======================================================================================================================================
Purpose: Switch each login between ADMIN (every screen) and NOT ADMIN (only the five warehouse screens — Customer Orders, Goods In,
         AMZ Shipment, Pick, Location; the list is lib/userAccess.ts). Owner, 2026-11-20.

         Hidden on screen only: a non-admin's dashboard is the five buttons, and any other screen sends them back to it. The API refuses
         nothing on it apart from this screen's own write.

         One switch per login, saved on the click (POST /user-set-admin, logged in bclog under 'Users'). It applies on that person's
         next page load — no new login needed. Your own row has no switch: an admin can't lock themselves out (ask another admin).
         A non-admin never sees this screen (AppShell sends them to the dashboard), and the server answers NOT_ADMIN anyway.

Adding a login is still `node scripts/seed-user.js` (it starts as admin) — no signup here.
=======================================================================================================================================
*/

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getUsers, setUserAdmin, type AppUserRow } from '@/lib/api';
import { NON_ADMIN_SCREENS } from '@/lib/userAccess';

export default function UsersPage() {
  const { data: users, error, isLoading, mutate } = useApiQuery('users-list', () => getUsers());
  const [savingId, setSavingId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function change(u: AppUserRow, toAdmin: boolean) {
    if (u.is_admin === toAdmin || savingId !== null) return;
    setSavingId(u.id);
    setMessage(null);
    const res = await setUserAdmin(u.id, toAdmin);
    if (res.success && res.data) {
      const saved = res.data;
      await mutate((rows) => rows?.map((r) => (r.id === saved.id ? { ...r, is_admin: saved.is_admin } : r)), { revalidate: false });
      setMessage({ ok: true, text: `${saved.display_name} is now ${saved.is_admin ? 'an admin — every screen' : 'not admin — the warehouse screens only'}. It applies on their next page load.` });
    } else {
      setMessage({ ok: false, text: res.error || 'Could not change the user' });
    }
    setSavingId(null);
  }

  return (
    <AppShell>
      <p className="mb-4 max-w-3xl text-sm text-slate-500">
        <span className="font-medium text-slate-700">Admin</span> sees every screen.{' '}
        <span className="font-medium text-slate-700">Not admin</span> sees only {NON_ADMIN_SCREENS.map((s) => s.label).join(', ')}.
      </p>

      {message && (
        <div className={'mb-4 rounded-lg px-4 py-2.5 text-sm ' + (message.ok ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' : 'bg-red-50 text-red-800 ring-1 ring-red-200')}>
          {message.text}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error.message}</p>}
      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}

      {users && (
        <div className="max-w-3xl overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Login</th>
                <th className="px-4 py-2.5">Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {u.display_name}
                    {u.is_you && <span className="ml-2 text-xs font-normal text-slate-400">(you)</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{u.username}</td>
                  <td className="px-4 py-3">
                    {u.is_you ? (
                      <span className="text-slate-500" title="You can’t change your own access — ask another admin">Admin</span>
                    ) : (
                      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5" role="group" aria-label={`Access for ${u.display_name}`}>
                        {[true, false].map((val) => (
                          <button
                            key={String(val)}
                            type="button"
                            disabled={savingId !== null}
                            onClick={() => change(u, val)}
                            aria-pressed={u.is_admin === val}
                            className={
                              'rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-wait ' +
                              (u.is_admin === val ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')
                            }
                          >
                            {val ? 'Admin' : 'Not admin'}
                          </button>
                        ))}
                      </div>
                    )}
                    {savingId === u.id && <span className="ml-2 text-xs text-slate-400">Saving…</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
