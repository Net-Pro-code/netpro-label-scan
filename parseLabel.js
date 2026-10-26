// Turns the text lines read from a shelf-label photo into { name, price }.
// `lines` is a list of strings (top to bottom) or objects { text, top, height, left }.
// Nothing here depends on React or the phone, so it can be tested on its own.

// "MK 12,100.00" / "MK 4160" / "MK. 2.550 .00" -> number (or null)
function parsePrice(raw) {
  let s = String(raw).replace(/\s+/g, '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  // last separator followed by exactly 2 digits = decimals; every other . or , = thousands
  const m = s.match(/^(.*)[.,](\d{2})$/);
  let whole = s;
  let dec = '';
  if (m && /\d/.test(m[1])) {
    whole = m[1];
    dec = m[2];
  }
  whole = whole.replace(/[.,]/g, '');
  if (!/^\d+$/.test(whole)) return null;
  const n = parseFloat(dec ? whole + '.' + dec : whole);
  return n > 0 && n < 10000000 ? n : null;
}

const norm = (l) =>
  typeof l === 'string' ? { text: l, top: null, height: null, left: 0 } : { left: 0, ...l };

function titleCase(s) {
  // ALL CAPS shop labels -> Nicer Case (leave mixed-case text alone)
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .replace(/(^|[\s/(-])([a-z])/g, (_, a, b) => a + b.toUpperCase())
    .replace(/\b(\d+)(g|kg|ml|l)\b/gi, (_, n, u) => n + u.toLowerCase());
}

function cleanName(s) {
  return s
    .replace(/^[^A-Za-z0-9]+/, '') // junk at the start ("5|", "[|", "»")
    .replace(/^\d{1,2}\s*[|\]\[]\s*/, '') // shelf-number box read as "15|"
    .replace(/[|_~`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^A-Za-z0-9)%]+$/, (m) => (/[&-]/.test(m) ? ' ' + m.replace(/[^&-]/g, '') : '')) // trailing junk, keep & and -
    .trim();
}

function looksLikeName(t) {
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  if (letters < 4) return false;
  if (letters / t.replace(/\s/g, '').length < 0.55) return false; // mostly digits/symbols
  if (/\b(MK|MWK)\b/i.test(t)) return false;
  if (/^\W*\/?\s*PC\W*$/i.test(t)) return false;
  if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t)) return false; // dates
  return true;
}

export function parseLabel(rawLines, imageHeight) {
  const lines = (rawLines || []).map(norm).filter((l) => l.text && l.text.trim());
  if (lines.length === 0) return { name: '', price: null, ok: false };

  // 1. find the price line(s): a line with "MK" followed by digits
  const cands = [];
  lines.forEach((l, idx) => {
    const m = l.text.match(/\b(?:MK|MWK)\b\.?\s*([\d][\d\s.,]*)/i) || l.text.match(/\bM[KX]\s*([\d][\d\s.,]*)/);
    if (!m) return;
    const price = parsePrice(m[1]);
    if (price) cands.push({ idx, price, line: l });
  });
  if (cands.length === 0) {
    // no MK found: maybe just the name was read
    const first = lines.find((l) => looksLikeName(l.text));
    return { name: first ? titleCase(cleanName(first.text)) : '', price: null, ok: false };
  }

  // 2. several labels in one photo -> the one the user is aiming at: biggest text wins
  //    (closest to the camera); if sizes are alike, the one nearest the middle
  let best = cands[0];
  if (cands.length > 1) {
    const maxH = Math.max(...cands.map((c) => c.line.height || 0));
    const big = cands.filter((c) => (c.line.height || 0) >= maxH * 0.85);
    best = big[0];
    if (big.length > 1 && imageHeight) {
      best = big.reduce((a, b) =>
        Math.abs((a.line.top || 0) - imageHeight / 2) <= Math.abs((b.line.top || 0) - imageHeight / 2) ? a : b
      );
    }
  }

  // 3. name = the closest name-like line above the price, plus the line above that
  //    when it clearly carries on (ends with & or -, or sits right on top at the same text size)
  const h0 = best.line.height || 30;
  let nearest = -1;
  for (let i = best.idx - 1; i >= 0 && best.idx - i <= 4; i--) {
    const l = lines[i];
    if (best.line.top != null && l.top != null && best.line.top - l.top > h0 * 3.2) break;
    if (looksLikeName(l.text)) { nearest = i; break; }
  }
  const picked = [];
  if (nearest >= 0) {
    picked.push(lines[nearest]);
    const prev = lines[nearest - 1];
    if (prev && looksLikeName(prev.text)) {
      const endsOn = /[&-]\s*$/.test(prev.text.trim());
      let sameBlock = false;
      if (prev.top != null && lines[nearest].top != null) {
        const h = lines[nearest].height || 30;
        const gap = lines[nearest].top - prev.top;
        const ratio = (prev.height || h) / h;
        sameBlock = gap <= h * 1.8 && ratio > 0.75 && ratio < 1.33;
      }
      if (endsOn || sameBlock) picked.unshift(prev);
    }
  }
  const name = titleCase(cleanName(picked.map((l) => cleanName(l.text)).join(' ')));
  return { name, price: best.price, ok: !!name };
}

export { parsePrice };
