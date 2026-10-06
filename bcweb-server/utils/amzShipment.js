// Shared by the AMZ Shipment write routes (amz-shipment-line, amz-shipment-dims).

// A box's measurements as the screen sends them → the strings amzshipment stores (its weight/length/width/height are character
// varying). Anything that isn't a plain positive number becomes '' (stored as NULL), so junk never reaches the table.
function cleanDims(raw) {
  const out = { length: '', width: '', height: '', weight: '' };
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(out)) {
    const v = String(raw[k] ?? '').trim();
    if (/^\d{1,4}([.]\d{1,3})?$/.test(v) && Number(v) > 0) out[k] = v;
  }
  return out;
}

module.exports = { cleanDims };
