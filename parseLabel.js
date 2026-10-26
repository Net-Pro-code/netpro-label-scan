// Turns the text lines read from a shelf-label photo into { name, price, code }.
// `lines` is a list of strings (top to bottom) or objects { text, top, left, width, height }.
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

// a price number: 4160 | 15695 | 12,100.00 | 2.550 .00  (stops before dates like 09/10/2026)
const NUM = '(\\d+(?:[,.]\\s?\\d{3})*(?:\\s?[.,]\\s?\\d{2})?)';
const PRICE_RES = [
  new RegExp('\\b(?:MK|MWK)\\b\\s*[.:;]?\\s*' + NUM, 'i'), // MK 4160 | MK: 6695 | MK. 2,550.00
  new RegExp('M[KXI(\\[]\\s*[.:;]\\s*' + NUM), // a misread K, but only with a colon or dot after it
];

// barcode check digit (EAN-8, UPC-A, EAN-13, GTIN-14). A misread digit almost always fails this.
export function gtinValid(s) {
  if (!/^\d+$/.test(s) || ![8, 12, 13, 14].includes(s.length)) return false;
  const d = s.split('').map(Number);
  const check = d.pop();
  const sum = d.reverse().reduce((t, v, i) => t + v * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const norm = (l) =>
  typeof l === 'string'
    ? { text: l, top: null, height: null, left: null, width: null }
    : { top: null, height: null, left: null, width: null, ...l };

// words that stay in capitals
const KEEP_UPPER = new Set(['GF', 'BBQ', 'UHT', 'PVC']);

function prettyToken(tok) {
  const u = tok.toUpperCase();
  if (KEEP_UPPER.has(u)) return u;
  const unit = tok.match(/^(\d+)(g|kg|ml|l)([,.)]*)$/i);
  if (unit) return unit[1] + unit[2].toLowerCase() + unit[3];
  return tok.toLowerCase().replace(/(^|[/(-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

function titleCase(s) {
  // ALL CAPS shop labels -> Nicer Case (leave mixed-case text alone)
  if (s !== s.toUpperCase()) return s;
  return s.split(/\s+/).map(prettyToken).join(' ');
}

function cleanName(s) {
  return s
    .replace(/^[^A-Za-z0-9]+/, '') // junk at the start ("5|", "[|", "»")
    .replace(/^\d{1,2}\s*[|\]\[]\s*/, '') // shelf-number box read as "15|"
    .replace(/[|_~`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^A-Za-z0-9)%]+$/, (m) => (/[&-]/.test(m) ? ' ' + m.replace(/[^&-]/g, '') : '')) // keep & and -
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

// the barcode number printed on the label, accepted only when its check digit is right
function findCode(lines, priceLine) {
  let best = null;
  lines.forEach((l, idx) => {
    const dist =
      l.top != null && priceLine.top != null ? Math.abs(l.top - priceLine.top) : Math.abs(idx - priceLine.idx) * 50;
    for (const m of l.text.matchAll(/\d(?:\s?\d){6,13}/g)) {
      const digits = m[0].replace(/\s/g, '');
      if (gtinValid(digits) && (!best || dist < best.dist)) best = { code: digits, dist, pri: 0 };
    }
    const star = l.text.match(/\*\s*(\d{5,8})\s*\*/); // Code 39 labels print *800765*
    if (star && !best) best = { code: star[1], dist, pri: 1 };
  });
  return best ? best.code : '';
}

export function parseLabel(rawLines, imageHeight) {
  const lines = (rawLines || []).map(norm).filter((l) => l.text && l.text.trim());
  if (lines.length === 0) return { name: '', price: null, code: '', ok: false };

  // 1. find the price line(s): "MK" followed by a number
  const cands = [];
  lines.forEach((l, idx) => {
    for (const re of PRICE_RES) {
      const m = l.text.match(re);
      const price = m && parsePrice(m[1]);
      if (price) {
        cands.push({ idx, price, line: l });
        return;
      }
    }
  });
  let guessed = false;
  if (cands.length === 0) {
    // "MK" may be unreadable ("We 15695", "Mh. 6695"): accept a short number line next to a name
    // (never a barcode or a date), and tell the user it is a guess
    const hasName = lines.some((l) => looksLikeName(l.text));
    if (hasName) {
      lines.forEach((l, idx) => {
        const m = l.text.trim().match(/^[^\d\n]{1,5}?[.:;\s]*(\d{3,6}(?:\s?[.,]\s?\d{2})?)\s*[*|]?$/);
        const price = m && parsePrice(m[1]);
        if (price && !/\d{7,}/.test(l.text.replace(/\s/g, ''))) cands.push({ idx, price, line: l });
      });
      guessed = cands.length > 0;
    }
  }
  if (cands.length === 0) {
    // no price found: maybe just the name was read
    const first = lines.find((l) => looksLikeName(l.text));
    return { name: first ? titleCase(cleanName(first.text)) : '', price: null, code: '', ok: false };
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
  const P = best.line;
  const hasGeo = P.top != null && P.left != null;
  const ph = P.height || 30;

  // 3a. white-style labels: the name is the closest name-like line ABOVE the price (and overlapping it
  //     sideways, so a neighbouring label is ignored), plus the line above that when it clearly carries
  //     on (ends with & or -, or sits right on top at the same text size)
  let picked = [];
  const overlaps = (l) =>
    !hasGeo || l.left == null || (l.left <= P.left + (P.width || 9999) && l.left + (l.width || 0) >= P.left);
  let nearest = -1;
  for (let i = best.idx - 1; i >= 0 && best.idx - i <= 4; i--) {
    const l = lines[i];
    if (P.top != null && l.top != null && P.top - l.top > ph * (hasGeo ? 2.4 : 3.2)) break;
    if (looksLikeName(l.text) && overlaps(l)) {
      nearest = i;
      break;
    }
  }
  if (nearest >= 0) {
    picked.push(lines[nearest]);
    const prev = lines[nearest - 1];
    if (prev && looksLikeName(prev.text) && overlaps(prev)) {
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

  // 3b. yellow-style labels: nothing above, the name (one to three lines) sits to the LEFT of the price
  if (picked.length === 0 && hasGeo) {
    picked = lines
      .filter((l) => {
        if (l === P || l.top == null || l.left == null || !looksLikeName(l.text)) return false;
        const gap = P.left - (l.left + (l.width || 0));
        return gap >= -4 && gap <= ph * 6 && l.top >= P.top - ph * 1.6 && l.top <= P.top + ph * 2.6;
      })
      .sort((a, b) => a.top - b.top)
      .slice(0, 3);
  }

  const name = titleCase(cleanName(picked.map((l) => cleanName(l.text)).join(' ')));
  const code = findCode(lines, { top: P.top, idx: best.idx });
  return { name, price: best.price, code, ok: !!name, guessed };
}

export { parsePrice };
