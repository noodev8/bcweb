'use client';
/*
=======================================================================================================================================
Component: OrderStageSwitch
=======================================================================================================================================
Purpose: The ON ORDER | TO PLACE switch at the top of the Order Status module. Like the Pricing module's WINNERS | LOSERS control this
         isn't a minor toggle — it flips between two genuinely different jobs — but here the two sides are also two halves of one
         lifecycle (Chosen -> Placed -> Arrived).

  ON ORDER — genuinely with the supplier. Waiting/chasing. Sits LEFT: the module's original, everyday view.
  TO PLACE — chosen but not yet bought. Nothing is on its way; someone has to act.

ONE COLOUR (sky) for both panels, not a colour per stage (owner): the selected panel is already obvious from the ring/fill, so tinting
the stages differently only adds noise — and an alarm-coloured TO PLACE reads as a warning when it's really just the other half of a
normal day's work. Colour here means "selected", nothing more; the amber/red urgency signals stay on the AGE chips (orderStatusUi.ts),
where they actually track something.

Counts live ON the chips so the module home answers "how much is sitting un-ordered, and what will it cost" before you click anything —
that headline is the whole reason the TO PLACE stage exists. The cost line is only shown when there's something to place.
=======================================================================================================================================
*/

import { ClipboardDocumentListIcon, TruckIcon } from '@heroicons/react/24/outline';
import { money } from '@/lib/orderStatusUi';

export type OrderStage = 'place' | 'order';

interface Props {
  stage: OrderStage;
  onChange: (s: OrderStage) => void;
  toPlaceUnits?: number | null;
  toPlaceCost?: number | null;
  onOrderUnits?: number | null;
}

export default function OrderStageSwitch({ stage, onChange, toPlaceUnits, toPlaceCost, onOrderUnits }: Props) {
  return (
    <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <StagePanel
        active={stage === 'order'}
        onClick={() => onChange('order')}
        icon={<TruckIcon className="h-6 w-6" />}
        title="On order"
        subtitle="Placed with the supplier — waiting to arrive"
        count={onOrderUnits}
        detail={null}
      />
      <StagePanel
        active={stage === 'place'}
        onClick={() => onChange('place')}
        icon={<ClipboardDocumentListIcon className="h-6 w-6" />}
        title="To place"
        subtitle="Chosen, not yet ordered from the supplier"
        count={toPlaceUnits}
        // The money is the decision ("can I place this today?"), so it sits alongside the count rather than buried in the subtitle.
        detail={toPlaceUnits ? money(toPlaceCost) : null}
      />
    </div>
  );
}

// The one selected-state palette, shared by both panels — deliberately not a per-stage prop, so the two can't drift back into
// meaning-by-colour. Muted sky: enough to read as "this one", not enough to shout.
const ACTIVE = 'border-sky-400 bg-sky-50/70 text-slate-900 ring-1 ring-sky-400';
const ACTIVE_ACCENT = 'text-sky-700';

function StagePanel({
  active, onClick, icon, title, subtitle, count, detail,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  count?: number | null;
  detail?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'flex items-center gap-4 rounded-xl border px-5 py-4 text-left transition ' +
        (active ? ACTIVE + ' shadow-sm' :'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50')
      }
    >
      <span className={'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ' + (active ? 'bg-white/70 ' + ACTIVE_ACCENT : 'bg-slate-100 text-slate-400')}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className={'text-lg font-semibold ' + (active ? '' : 'text-slate-700')}>{title}</span>
          {count !== null && count !== undefined && (
            <span className={'rounded-full px-2 py-0.5 text-xs font-medium ' + (active ? 'bg-white/70 ' + ACTIVE_ACCENT : 'bg-slate-100 text-slate-500')}>
              {count}
            </span>
          )}
          {detail && (
            <span className={'text-sm font-semibold ' + (active ? ACTIVE_ACCENT : 'text-slate-500')}>{detail}</span>
          )}
        </span>
        <span className={'block text-sm ' + (active ? 'opacity-80' : 'text-slate-400')}>{subtitle}</span>
      </span>
    </button>
  );
}
