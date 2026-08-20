/**
 * Big pasted text, kept out of the conversation.
 *
 * A refresh CSV is hundreds of rows of numbers, and the one thing that must not
 * happen to it is a transcription error. So it never travels through the model
 * at all: the paste is stashed here, the message carries a one-line marker, and
 * the tools take the id. Devin decides what to do with the file; the bytes it
 * decides about are the bytes the user pasted.
 *
 * Session-scoped and in memory — an attachment belongs to the conversation on
 * screen, and a page reload starts both again.
 */
export interface Attachment {
  id: string;
  kind: 'refresh-csv' | 'text';
  text: string;
  /** Data lines, excluding the header — what the marker line reports. */
  rows: number;
}

const store = new Map<string, Attachment>();
let seq = 0;

/** True when a paste looks like an answer to the deck-refresh prompt. */
export function looksLikeRefreshCsv(text: string): boolean {
  return /^\s*ref\s*,\s*page\s*,/im.test(text) || /^\s*ref\s*,[^\n]*\bnew_value\b/im.test(text);
}

export function putAttachment(text: string, kind: Attachment['kind'] = 'text'): Attachment {
  seq += 1;
  const id = `att_${seq}`;
  const rows = text.split(/\r?\n/).filter((l) => l.trim()).length - 1;
  const attachment: Attachment = { id, kind, text, rows: Math.max(0, rows) };
  store.set(id, attachment);
  return attachment;
}

export const getAttachment = (id: string) => store.get(id);

export const listAttachments = () => [...store.values()];

export function clearAttachments() {
  store.clear();
  seq = 0;
}

/** The line the model sees in place of the file. */
export const attachmentMarker = (a: Attachment) =>
  `[attached ${a.kind === 'refresh-csv' ? 'refresh CSV' : 'text'} — id ${a.id}, ${a.rows} rows. The contents are held outside this conversation; pass the id to a tool rather than asking for the text.]`;
