/**
 * Shared text utilities for qualification.
 *
 * Filtering and stem agreement live here rather than inside a scorer so
 * every stage tokenises identically.
 */
export const STOPWORDS = new Set([
  'and', 'the', 'for', 'with', 'from', 'type', 'types', 'other', 'others',
  'item', 'items', 'supply', 'supplies', 'service', 'services', 'quality',
  'grade', 'part', 'parts', 'misc', 'general', 'various', 'including',
  'include', 'per', 'upto', 'above', 'below', 'unit', 'units', 'make',
  'model', 'size', 'sizes', 'work', 'works', 'material', 'materials',
]);

export function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 4 && !STOPWORDS.has(t));
}

/**
 * Identical, or sharing a stem of at least 5 characters. An unbounded
 * substring test previously matched "and" inside "Landscape".
 */
export function tokensAgree(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 5 && longer.startsWith(shorter);
}
