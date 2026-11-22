// Fast csv-reader 1.0.0 drop-in: single-pass, native-scan-driven parser.
//
// Reproduces make.fun's csv-reader 1.0.0 exactly (BOM drop, CRLF/LF records,
// empty lines are no record, stray CR dropped + error, quoted fields with ""
// doubling, CR/CRLF inside quotes -> LF, quote junk appended + error,
// unterminated quote re-read as unquoted + error, short/long row pad/cut +
// errors, header -> columns). Hot paths use native scans (regex char-class
// exec, indexOf) + slice instead of the reference's character-at-a-time
// loop with string concatenation. Every scan is bounded: no indexOf is ever
// asked to run past the field it serves.

const DELIM = /[,\r\n]/g;
const SPAN_BREAK = /[\r\n]/g;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // Every error carries the record's start line and its index in rows
  // (null for the header).
  let recordLine = 1;
  let recordRow = null;

  // Out-params of readUnquoted/readQuoted (avoids one array per field).
  let fValue = '';
  let fEnded = 0;
  let fAdded = 0;

  // Unquoted field starting at pos, with `prefix` already in the value
  // (quote-junk and unterminated-quote paths; normally '').
  // Returns [value, ended, added]: ended 0=comma, 1=line break, 2=end;
  // added counts the characters kept from the scanned text (dropped CRs
  // excluded), for the quote-junk check.
  function readUnquoted(prefix) {
    let value = prefix;
    let added = 0;
    for (;;) {
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      if (m === null) {
        value += text.slice(pos, n);
        added += n - pos;
        pos = n;
        fValue = value; fEnded = 2; fAdded = added;
        return;
      }
      const at = m.index;
      const c = m[0];
      if (c === ',') {
        value += text.slice(pos, at);
        added += at - pos;
        pos = at + 1;
        fValue = value; fEnded = 0; fAdded = added;
        return;
      }
      if (c === '\n') {
        value += text.slice(pos, at);
        added += at - pos;
        pos = at + 1;
        line += 1;
        fValue = value; fEnded = 1; fAdded = added;
        return;
      }
      // CR: CRLF ends the record, a lone CR is a stray (dropped, error)
      // and the field goes on.
      if (at + 1 < n && text.charCodeAt(at + 1) === 10) {
        value += text.slice(pos, at);
        added += at - pos;
        pos = at + 2;
        line += 1;
        fValue = value; fEnded = 1; fAdded = added;
        return;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      value += text.slice(pos, at);
      added += at - pos;
      pos = at + 1;
    }
  }

  // Quoted field whose opening quote is at pos. Returns [value, ended]
  // with the same `ended` codes as readUnquoted.
  function readQuoted() {
    const open = pos;
    let start = pos + 1;
    let doubled = false;
    let close = -1;
    for (;;) {
      const q = text.indexOf('"', start);
      if (q === -1) break;
      if (q + 1 < n && text.charCodeAt(q + 1) === 34) {
        doubled = true;
        start = q + 2;
        continue;
      }
      close = q;
      break;
    }
    if (close === -1) {
      // Never closes: the quote is literal and the rest is re-read
      // as an unquoted field starting with '"'.
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      pos = open + 1;
      readUnquoted('"');
      return;
    }
    // Value of the span (open+1, close): fast slice when nothing in it
    // needs rewriting (no "" doubling, no CR, no LF).
    let value;
    let hasLf = false;
    let hasCr = false;
    SPAN_BREAK.lastIndex = open + 1;
    for (;;) {
      const b = SPAN_BREAK.exec(text);
      if (b === null || b.index >= close) break;
      if (b[0] === '\n') hasLf = true;
      else { hasCr = true; break; }
    }
    if (!doubled && !hasLf && !hasCr) {
      value = text.slice(open + 1, close);
    } else if (!doubled && !hasCr) {
      // Only LFs: slice as-is, count the lines.
      value = text.slice(open + 1, close);
      let c = 0;
      for (let i = open + 1; i < close; i++) if (text.charCodeAt(i) === 10) c++;
      line += c;
    } else {
      // Doubling and/or CRs: rewrite the span (CR/CRLF -> LF, "" -> ").
      let span = text.slice(open + 1, close);
      if (hasCr) span = span.replace(/\r\n?/g, '\n');
      if (doubled) span = span.replaceAll('""', '"');
      value = span;
      let c = 0;
      for (let i = 0; i < span.length; i++) if (span.charCodeAt(i) === 10) c++;
      line += c;
    }
    const next = close + 1;
    if (next >= n) {
      pos = n;
      fValue = value; fEnded = 2; fAdded = 0;
      return;
    }
    const c = text.charCodeAt(next);
    if (c === 44) {
      pos = next + 1;
      fValue = value; fEnded = 0; fAdded = 0;
      return;
    }
    if (c === 10) {
      pos = next + 1;
      line += 1;
      fValue = value; fEnded = 1; fAdded = 0;
      return;
    }
    if (c === 13 && next + 1 < n && text.charCodeAt(next + 1) === 10) {
      pos = next + 2;
      line += 1;
      fValue = value; fEnded = 1; fAdded = 0;
      return;
    }
    // Junk after the closing quote: appended as it stands.
    pos = next;
    readUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended;
    let firstQuoted = false;
    let first = true;
    do {
      const quoted = text.charCodeAt(pos) === 34;
      if (first) firstQuoted = quoted;
      first = false;
      if (quoted) readQuoted(); else readUnquoted('');
      fields.push(fValue);
      ended = fEnded;
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !firstQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
