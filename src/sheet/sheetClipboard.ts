/**
 * Clipboard interchange with real spreadsheets.
 *
 * Excel and Google Sheets both put TSV on `text/plain`, so a tab anywhere means
 * TSV. Otherwise it's CSV, and CSV needs the full RFC-4180 treatment — quoted
 * fields, doubled quotes, embedded newlines and CRLF — because the moment
 * someone pastes a company name with a comma in it, a naive `split(',')`
 * silently shifts every column right.
 */

export function parseClipboardTable(text: string): string[][] {
  if (!text) return [];
  // A tab outside quotes is the reliable TSV tell; do the cheap check first.
  return text.includes('\t') ? parseDelimited(text, '\t') : parseDelimited(text, ',');
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"' && field === '') {
      quoted = true;
      i++;
      continue;
    }
    if (c === delimiter) {
      endField();
      i++;
      continue;
    }
    if (c === '\r') {
      // Swallow CRLF as one break; a lone CR is still a break.
      if (text[i + 1] === '\n') i++;
      endRow();
      i++;
      continue;
    }
    if (c === '\n') {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }

  // A trailing newline shouldn't manufacture an empty final row.
  if (field !== '' || row.length) endRow();

  return rows;
}

/**
 * Copy out in both plain text and HTML. The HTML table is what makes pasting
 * back INTO Excel keep its shape instead of landing in one cell.
 */
export function serializeTable(rows: string[][]): { text: string; html: string } {
  const text = rows.map((r) => r.map(escapeTsv).join('\t')).join('\n');
  const html = `<table>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('')}</table>`;
  return { text, html };
}

/** A field containing a tab or newline has to be quoted or it splits the row. */
function escapeTsv(s: string): string {
  return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
}

/**
 * Does the first pasted row look like headers rather than data?
 *
 * Used to offer "use the first row as series names" — offered, never assumed.
 * A silent guess here either invents series names from real data or drops a
 * real data row, and both are hard to notice until the numbers are wrong.
 */
export function looksLikeHeaderRow(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const [head, ...rest] = rows;
  // Skip the key column: a category label is text in every row.
  const headTail = head.slice(1);
  const bodyTail = rest.flatMap((r) => r.slice(1));
  if (!headTail.length || !bodyTail.length) return false;

  const numeric = (s: string) => /^[-(]?[$£€¥]?[\d,]*\.?\d+\)?%?$/.test(s.trim()) && /\d/.test(s);
  const headNumeric = headTail.filter(numeric).length / headTail.length;
  const bodyNumeric = bodyTail.filter(numeric).length / bodyTail.length;
  return headNumeric < 0.3 && bodyNumeric > 0.6;
}
