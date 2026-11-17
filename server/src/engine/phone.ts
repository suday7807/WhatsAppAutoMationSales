import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** "98765 43210", "+91 99001 12233", "919876543210", "09876543210" → "+919876543210" (or null). */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let cleaned = String(raw).replace(/[^\d+]/g, '');
  if (!cleaned) return null;
  if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);
  if (!cleaned.startsWith('+') && cleaned.length === 12 && cleaned.startsWith('91')) cleaned = '+' + cleaned;
  const parsed = parsePhoneNumberFromString(cleaned, 'IN');
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/** E.164 → digits used by WhatsApp ("+919876543210" → "919876543210"). */
export function toWaDigits(phone: string) {
  return phone.replace(/\D/g, '');
}

export interface ParsedLine {
  phone: string;
  name: string | null;
}

/** True for text that looks like a phone number (7+ digits), so it is never used as a name. */
export function looksLikePhone(s: string) {
  return (s.match(/\d/g)?.length ?? 0) >= 7;
}

/**
 * Parses pasted numbers. Accepts one per line, or many on a line separated by commas, semicolons,
 * tabs or spaces, with an optional name after a number:
 *   9876543210
 *   +91 99001 12233, Priya
 *   9076455490,8454811021,8108809151
 */
export function parsePasted(text: string): { valid: ParsedLine[]; invalid: string[] } {
  const valid: ParsedLine[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  const add = (phone: string) => {
    if (seen.has(phone)) return null;
    seen.add(phone);
    const row: ParsedLine = { phone, name: null };
    valid.push(row);
    return row;
  };
  for (const rawLine of text.split(/\r?\n/)) {
    let last: ParsedLine | null = null; // the number on this line a following name belongs to
    for (const rawTok of rawLine.split(/[,;\t|]/)) {
      const tok = rawTok.trim();
      if (!tok) continue;
      const phone = normalizePhone(tok);
      if (phone) {
        last = add(phone);
        continue;
      }
      if (looksLikePhone(tok)) {
        // Maybe several numbers separated by spaces ("9076455490 8454811021").
        const parts = tok.split(/\s+/).map((p) => normalizePhone(p));
        if (parts.length > 1 && parts.every(Boolean)) {
          for (const p of parts) last = add(p!);
        } else {
          invalid.push(tok);
          last = null;
        }
        continue;
      }
      // Plain text: the name for the number just before it on the same line.
      if (last && !last.name) last.name = tok;
      else invalid.push(tok);
    }
  }
  return { valid, invalid };
}
