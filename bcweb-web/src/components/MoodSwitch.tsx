'use client';
/*
=======================================================================================================================================
Component: MoodSwitch — the Buy Box mood: Fierce · Chilled · Climb (2026-11-12, PLAN.md decision 15)
=======================================================================================================================================
Three buttons with the owner's cartoon faces (Fierce = a red angry face with a broom, Chilled = sunglasses, Climb = gold, reaching for a
star — drawn as in the staff guide), Chilled in the middle. The mood is chosen A LEVEL ABOVE THE CARDS (owner, 2026-11-13: "fierce,
chilled, climb should be a level above the cards. We should drill down into the cards with a mood already chosen"): MoodSwitch sits on
the Buy Box screen, held in plain React state there (every load starts on Chilled, nothing stored), and Pricing (the cards) is opened with the
chosen mood in its link (?mood=) and shows it with MoodBadge — no switch beside the cards. The mood changes raises everywhere and cuts
outside New (rules in utils/amzBuyBoxDeck.js); the hover says what it does.
=======================================================================================================================================
*/

import type { AmzMood } from '@/lib/api';
import { MOODS } from '@/lib/buyboxAnswers';

const RING: Record<AmzMood, string> = { fierce: 'ring-red-500', chilled: 'ring-blue-500', climb: 'ring-amber-500' };

function Face({ mood, size = 'h-7 w-8' }: { mood: AmzMood; size?: string }) {
  const ink = '#16191d';
  if (mood === 'fierce') {
    return (
      <svg viewBox="0 0 120 100" className={size} aria-hidden="true">
        <circle cx="48" cy="56" r="34" fill="#d6392f" />
        <path d="M26 43 l17 8 M70 43 l-17 8" stroke={ink} strokeWidth="5" strokeLinecap="round" />
        <circle cx="36" cy="57" r="4" fill={ink} /><circle cx="60" cy="57" r="4" fill={ink} />
        <rect x="31" y="68" width="34" height="11" rx="3" fill="#fff" stroke={ink} strokeWidth="3" />
        <path d="M39.5 68v11M48 68v11M56.5 68v11" stroke={ink} strokeWidth="2" />
        <path d="M110 12 L97 76" stroke={ink} strokeWidth="4" strokeLinecap="round" />
        <path d="M87 74 h20 l6 18 h-32 z" fill="#c9a24a" stroke={ink} strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
    );
  }
  if (mood === 'climb') {
    return (
      <svg viewBox="0 0 120 100" className={size} aria-hidden="true">
        <circle cx="48" cy="60" r="34" fill="#e0a21b" />
        <path d="M31 44 q7 -6 14 0 M51 44 q7 -6 14 0" fill="none" stroke={ink} strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="39" cy="52" r="4.5" fill={ink} /><circle cx="59" cy="52" r="4.5" fill={ink} />
        <path d="M34 70 q14 12 28 0" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" />
        <path d="M76 44 L96 28" stroke={ink} strokeWidth="4" strokeLinecap="round" />
        <circle cx="99" cy="25" r="6" fill="#e0a21b" stroke={ink} strokeWidth="2.5" />
        <path d="M110 3 L112 8.25 L117.6 8.5 L113.2 12.05 L114.7 17.5 L110 14.4 L105.3 17.5 L106.8 12.05 L102.4 8.5 L108 8.25 Z" fill="#ffd23f" stroke={ink} strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 120 100" className={size} aria-hidden="true">
      <circle cx="60" cy="54" r="36" fill="#3b7dd8" />
      <rect x="34" y="44" width="22" height="14" rx="6" fill={ink} /><rect x="64" y="44" width="22" height="14" rx="6" fill={ink} />
      <path d="M56 49 h8" stroke={ink} strokeWidth="3" />
      <path d="M44 70 q16 10 32 0" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/** The chosen mood, read only — Pricing (the cards) shows it (the mood is picked a level above, on the Buy Box screen). */
export function MoodBadge({ mood }: { mood: AmzMood }) {
  const m = MOODS.find((x) => x.key === mood)!;
  return (
    <span title={`${m.label} — ${m.sub}. Raise: ${m.raise}. Cut: ${m.cut}.`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md bg-white px-2 py-0.5 text-sm font-medium text-slate-900 shadow-sm ring-2 ${RING[mood]}`}>
      <Face mood={mood} /> {m.label}
    </span>
  );
}

export default function MoodSwitch({ mood, onChange, disabled }: { mood: AmzMood; onChange: (m: AmzMood) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex shrink-0 gap-1 rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm" role="group" aria-label="Mood">
      {MOODS.map((m) => {
        const on = m.key === mood;
        return (
          <button key={m.key} type="button" onClick={() => onChange(m.key)} disabled={disabled} aria-pressed={on}
            title={`${m.label} — ${m.sub}. Raise: ${m.raise}. Cut: ${m.cut}.`}
            className={'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm disabled:opacity-50 ' +
              (on ? `bg-slate-50 font-medium text-slate-900 ring-2 ${RING[m.key]}` : 'text-slate-500 hover:bg-slate-50')}>
            <Face mood={m.key} /> {m.label}
          </button>
        );
      })}
    </div>
  );
}

// The mood colour as text (the chosen card's name) — full class names for Tailwind's scanner.
const TEXT: Record<AmzMood, string> = { fierce: 'text-red-600', chilled: 'text-blue-600', climb: 'text-amber-600' };

/** STEP 1 on the Buy Box screen (2026-11-13, owner: the faces "should be nice size here as well rather than tucked away"): three big
 *  cards as in the staff guide — a large face, the name, the short line and what it does to raises and cuts. The chosen one gets a
 *  ring in its own colour. Three across on every width; the words under the name drop on a phone. */
export function MoodCards({ mood, onChange, disabled }: { mood: AmzMood; onChange: (m: AmzMood) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3" role="radiogroup" aria-label="Mood">
      {MOODS.map((m) => {
        const on = m.key === mood;
        return (
          <button key={m.key} type="button" role="radio" aria-checked={on} onClick={() => onChange(m.key)} disabled={disabled}
            title={`${m.label} — ${m.sub}. Raise: ${m.raise}. Cut: ${m.cut}.`}
            className={'relative flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-center transition disabled:opacity-50 sm:flex-row sm:items-center sm:gap-4 sm:px-4 sm:text-left ' +
              (on ? `border-transparent bg-white shadow-sm ring-2 ${RING[m.key]}` : 'border-slate-200 bg-slate-50 hover:bg-white')}>
            <Face mood={m.key} size="h-12 w-14 shrink-0 sm:h-16 sm:w-20" />
            <span className="min-w-0">
              <span className={'block text-base font-bold sm:text-lg ' + (on ? TEXT[m.key] : 'text-slate-900')}>{m.label}</span>
              <span className="hidden text-sm text-slate-600 sm:block">{m.sub}</span>
              <span className="hidden text-xs leading-snug text-slate-400 sm:block">{m.short}</span>
            </span>
            {on && <span className={'absolute right-3 top-2 hidden text-[11px] font-semibold sm:block ' + TEXT[m.key]}>✓ Chosen</span>}
          </button>
        );
      })}
    </div>
  );
}
