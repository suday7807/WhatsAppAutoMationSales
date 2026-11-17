// A bare "no"/"nahi" is NOT an opt-out: it is often an answer like "no, we don't have a website".
const EXACT = new Set([
  'stop', 'unsubscribe', 'remove', 'block', 'band', 'band karo',
  'not interested', 'no thanks', 'no thank you', 'mat bhejo', 'dont message', "don't message",
]);
const CONTAINS = [
  'not interested', 'stop messaging', 'stop sending', 'unsubscribe', 'band karo', 'mat bhejo',
  'dont message', "don't message", 'do not message', 'remove my number', 'interested nahi', 'interest nahi',
];

/** Does this reply mean "don't contact me again"? */
export function isOptOutText(body: string | null | undefined): boolean {
  const t = (body ?? '').toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (EXACT.has(t)) return true;
  return CONTAINS.some((p) => t.includes(p));
}
