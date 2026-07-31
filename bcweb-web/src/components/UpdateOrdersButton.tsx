'use client';
/*
=======================================================================================================================================
Component: UpdateOrdersButton
=======================================================================================================================================
Purpose: The "Update orders" control — pull unfulfilled orders from Shopify and run the whole order pipeline now, rather than waiting
         for cron. Rendered on more than one screen, which is the reason this file exists.

IT IS CALLED "UPDATE ORDERS" (owner): the legacy PowerBuilder term the team already uses and understands. It shipped briefly as "Sync
orders", which was our word, not theirs. The PLUMBING under it keeps the older naming — the route is POST /order-sync, the client fn
is runOrderSync(), the server module is utils/orderSync.js — and that split is deliberate. Renaming a live route and its server module
to chase a label is churn with a deployment risk attached, and "sync" is the accurate word for what the code does. The LABEL is the
part that has to speak the team's language. (Note the cron job that duplicates the pipeline is already called update_orders.py, so the
legacy term was never actually absent from the codebase — only from the screen.)

WHERE IT APPEARS, AND WHY IN TWO PLACES:

  Analytics -> Sales   you're looking at today's takings, they look light, and you want to know whether that's the truth or an update
                       that hasn't run yet.
  Customer Orders      a customer says they've ordered and you can't see it, or you've just been told to pick something that isn't
                       on the list. Same button, different question.

Those are two genuinely different reasons to press it, reached from two screens that nobody would think to leave for the other. One
button in one place would mean the operator on the fulfilment screen has to know that the answer lives under Analytics — which is
exactly the kind of "you just have to know" that this platform is replacing.

WHAT IS ACTUALLY SHARED, AND WHAT ISN'T (this is the important part):

  The PIPELINE — orders -> orderstatus, sales, archive, pick allocation, housekeeping — is not in this file and never will be. It is
  one server-side transaction behind POST /order-sync (bcweb-server/utils/orderSync.js). Every caller, on every screen, runs the same
  code on the server because there is only one copy of it. Adding a second button did not duplicate a single line of that logic.

  What this component shares is the CLIENT-SIDE HANDLING of a run, which is where a second copy would actually have rotted: expired
  session -> logout, the archive.skipped outcome (a success that still has to be said out loud), the headline, the in-flight lock,
  and refreshing whatever the pressing screen was showing. Copy-pasted onto a second page, that's the sort of thing where one site
  gets a new outcome handled and the other quietly doesn't.

  !! THE REAL DUPLICATION IS ELSEWHERE AND IS NOT SOLVED BY THIS FILE. The same pipeline also runs unattended from cron as
     C:\scripts\orders\update_orders.py, a second implementation of the same rules in a different language. Pressing this button does
     not replace that job and does not conflict with it — it is a "do it now". Read the banner at the top of
     bcweb-server/utils/orderSync.js before changing what a run does. !!

ERRORS ARE THE HOST'S TO RENDER. This component reports through `onError` instead of drawing its own banner, because both screens
already have somewhere errors belong (Sales folds it into the ledger's banner so a failed run can't blank a ledger that loaded fine).
A component that drew its own would put a second, differently-styled error box on a page that already had one.
=======================================================================================================================================
*/

import { useCallback, useState } from 'react';
import { CloudArrowDownIcon } from '@heroicons/react/24/outline';
import { useAuth } from '@/contexts/AuthContext';
import { runOrderSync } from '@/lib/api';

interface Props {
  /** Refetch whatever the host screen shows — a run changes both the sales ledger and the customer order list. Awaited. */
  onDone?: () => void | Promise<void>;
  /** Called with a message on failure, and with null at the start of each run to clear the last one. The host renders it. */
  onError: (message: string | null) => void;
  /** Extra classes on the wrapper, so a host can place it (e.g. `ml-auto` at the end of a filter row). */
  className?: string;
}

export default function UpdateOrdersButton({ onDone, onError, className }: Props) {
  const { logout } = useAuth();
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const onRun = useCallback(async () => {
    setRunning(true);
    setNote(null);
    onError(null);

    const res = await runOrderSync();

    if (res.success && res.data) {
      setNote(res.data.headline);
      // The one outcome that is a success but still needs saying out loud: too many open orders for a single fetch, so the archive
      // phase stood down rather than archive orders it never read. Everything else in the run happened.
      if (res.data.summary.archive.skipped) {
        onError('Shopify had more open orders than one fetch could read — archiving was skipped this run. Everything else ran.');
      }
      await onDone?.();
    } else if (res.return_code === 'UNAUTHORIZED') {
      logout();
      return;                       // page is redirecting; leave `running` set so the button can't be pressed again on the way out
    } else {
      onError(res.error || 'Update orders failed');
    }

    setRunning(false);
  }, [onDone, onError, logout]);

  return (
    <div className={'flex items-center gap-2 ' + (className ?? '')}>
      {/* The result of a run, as a transient one-line chip beside the button. Cleared on the next press. */}
      {note && (
        <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
          {note}
        </span>
      )}
      <button
        type="button"
        onClick={onRun}
        disabled={running}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <CloudArrowDownIcon className={`h-4 w-4 ${running ? 'animate-pulse' : ''}`} />
        {running ? 'Updating…' : 'Update orders'}
      </button>
    </div>
  );
}
