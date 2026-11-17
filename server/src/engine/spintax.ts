export interface TemplateVars {
  name?: string | null;
  business?: string | null;
  city?: string | null;
  category?: string | null;
  link?: string | null;
}

type Rand = () => number;

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] ?? '';
}

// A "name" with 7+ digits is really phone numbers that ended up in the name column; never greet with it.
const cleanName = (name?: string | null) => (name && (name.match(/\d/g)?.length ?? 0) >= 7 ? '' : name);

function resolve(key: string, v: TemplateVars): string {
  switch (key) {
    case 'name':
      return cleanName(v.name)?.trim() ?? '';
    case 'first_name':
    case 'firstname':
      return firstName(cleanName(v.name));
    case 'business':
    case 'company':
      return v.business?.trim() ?? '';
    case 'city':
      return v.city?.trim() ?? '';
    case 'category':
      return v.category?.trim() ?? '';
    case 'link':
    case 'url':
      return v.link?.trim() ?? '';
    default:
      return '';
  }
}

/**
 * Renders a message template:
 *  - {{name}}, {{first_name}}, {{business}}, {{city}}, {{category}}, {{link}}
 *  - {{name|friend}} → fallback when the value is empty
 *  - {Hi|Hello|Hey} → picks one option at random (nesting allowed)
 */
export function renderTemplate(tpl: string, vars: TemplateVars, rand: Rand = Math.random): string {
  // 1. Placeholders. Values are stripped of braces so they can't be mistaken for spintax.
  let out = tpl.replace(/\{\{\s*([a-z_]+)\s*(?:\|([^{}]*))?\}\}/gi, (_m, key: string, fallback?: string) => {
    const value = resolve(key.toLowerCase(), vars).replace(/[{}]/g, '');
    return value || (fallback ?? '').trim();
  });

  // 2. Spintax, innermost group first.
  const group = /\{([^{}]*)\}/;
  while (group.test(out)) {
    out = out.replace(group, (_m, inner: string) => {
      const options = inner.split('|');
      return options[Math.floor(rand() * options.length)] ?? '';
    });
  }

  // 3. Tidy up gaps left by empty placeholders ("Hi , ..." → "Hi, ...").
  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.!?])/g, '$1').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n') // at most one blank line between paragraphs
    .trim();
}

/** Picks which variation a recipient gets. "order" uses the campaign's rotating cursor. */
export function pickVariation(count: number, rotation: 'order' | 'random', cursor: number, rand: Rand = Math.random) {
  if (count <= 0) return -1;
  return rotation === 'random' ? Math.floor(rand() * count) : cursor % count;
}

/** Warnings shown in the campaign builder for risky message content. */
export function lintIntro(text: string, mode: 'combined' | 'separate' = 'separate', hasKit = false): string[] {
  const warnings: string[] = [];
  if (mode === 'combined') {
    if (hasKit && !/\{\{\s*(link|url)\s*\}\}/i.test(text)) warnings.push('Message mein {{link}} nahi hai, demo website ka link nahi jayega.');
    if (/https?:\/\/|www\./i.test(text)) warnings.push('Link khud mat likho, {{link}} use karo (demo kit se aata hai).');
    if (text.length > 600) warnings.push('Message 600 characters se lamba hai. 3–4 chhoti lines best rehti hain.');
  } else {
    if (/https?:\/\/|www\./i.test(text)) warnings.push('Intro mein link hai. Link ko second message mein rakho, ban ka risk kam hota hai.');
    if (text.length > 300) warnings.push('Intro 300 characters se lamba hai. Chhota message zyada natural lagta hai.');
  }
  if (/[—–]/.test(text)) warnings.push('Em dash (—) AI-written jaisa lagta hai. Normal comma ya full stop use karo.');
  return warnings;
}
