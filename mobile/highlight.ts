/** Preserve the source text while marking complete words or phrases. */
export function highlightParts(text: string, terms: string[]): { text: string; highlighted: boolean }[] {
  const escaped = [...new Set(terms.map(term => term.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!escaped.length) return [{ text, highlighted: false }];
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escaped.join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  const parts: { text: string; highlighted: boolean }[] = [];
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index + match[1].length;
    if (start > end) parts.push({ text: text.slice(end, start), highlighted: false });
    parts.push({ text: match[2], highlighted: true });
    end = match.index + match[0].length;
  }
  if (end < text.length) parts.push({ text: text.slice(end), highlighted: false });
  return parts;
}
