/*
=======================================================================================================================================
printPdf — print a PDF (the Royal Mail label from Click & Drop) from the browser, no download, no new tab.
=======================================================================================================================================
The PDF goes into a hidden iframe and that iframe is printed. On the packing PC Chrome runs with --kiosk-printing
(docs/label-printer-shortcut.txt), which skips the dialog and sends it to the Windows default printer — the Zebra. Anywhere else the
normal print dialog opens. The label's size is the PDF's own page size, set by Click & Drop's label format setting, so the Zebra's
driver paper must match it (6 × 4 in).

The iframe is left in the page for a minute, not removed on afterprint: Chrome's PDF viewer prints asynchronously and removing the frame
too soon cancels the job. Each print replaces the previous frame.
=======================================================================================================================================
*/

const FRAME_ID = 'pdf-print-frame';

export function printPdfBase64(base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));

  document.getElementById(FRAME_ID)?.remove();
  const frame = document.createElement('iframe');
  frame.id = FRAME_ID;
  frame.setAttribute('aria-hidden', 'true');
  // Off-screen rather than display:none — a display:none frame never loads the PDF viewer, so there is nothing to print.
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';
  frame.onload = () => {
    // The PDF viewer needs a moment after load before print() catches the document rather than a blank page.
    setTimeout(() => {
      try { frame.contentWindow?.focus(); frame.contentWindow?.print(); } catch { /* cross-origin viewer quirks: the PDF is still open */ }
    }, 300);
  };
  frame.src = url;
  document.body.appendChild(frame);
  setTimeout(() => { if (frame.isConnected) frame.remove(); URL.revokeObjectURL(url); }, 60000);
}
