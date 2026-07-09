'use client';
/*
=======================================================================================================================================
Component: CopyButton
=======================================================================================================================================
Purpose: A tiny icon-only button that copies a piece of text (typically a groupid) to the clipboard, so the operator can paste it
         into another screen/tool (e.g. searching Shopify or the master spreadsheet) without hand-retyping it. Flashes a checkmark for
         a moment as confirmation, then reverts — no other UI state, nothing persisted.
=======================================================================================================================================
*/

import { useState } from 'react';
import { ClipboardDocumentIcon, CheckIcon } from '@heroicons/react/24/outline';

export default function CopyButton({ value, label, className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return; // clipboard blocked (permissions/insecure context) — silently do nothing rather than throw in the UI
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      title={label ? `Copy ${label}` : 'Copy'}
      aria-label={label ? `Copy ${label}` : 'Copy'}
      className={
        'inline-flex items-center justify-center rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 ' +
        (className || '')
      }
    >
      {copied ? <CheckIcon className="h-4 w-4 text-green-600" /> : <ClipboardDocumentIcon className="h-4 w-4" />}
    </button>
  );
}
