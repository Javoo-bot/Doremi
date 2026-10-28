import { readFileSync } from 'node:fs';
import type { AudioReference } from '../score/types.ts';
import { readZip } from '../score/zip.ts';

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (entities[e] ?? m),
  );

/** The words of a .docx, in reading order. */
export function docxWords(bytes: Uint8Array): string[] {
  const xml = readZip(bytes).get('word/document.xml')?.toString('utf8');
  if (!xml) throw new Error('Not a .docx: word/document.xml is missing');
  const text = xml
    .replace(/<w:tab\s*\/>/g, ' ')
    .replace(/<w:br\s*\/>|<\/w:p>/g, '\n')
    .replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, (_, t: string) => `\u0001${t}\u0002`)
    .replace(/<[^>]+>/g, '')
    .replace(/\u0002\u0001/g, '');
  return decode(text.replace(/[\u0001\u0002]/g, ''))
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Spread the words over the notes in order. The pairing is a guess (a word can cover several notes, or
 * a note several words), so the reference is marked lyrics: "approximate".
 */
export function attachLyrics(ref: AudioReference, words: string[]): AudioReference {
  const n = ref.notes.length;
  const slots: string[][] = ref.notes.map(() => []);
  if (n && words.length) words.forEach((w, j) => slots[Math.floor((j * n) / words.length)].push(w));
  return {
    ...ref,
    lyrics: 'approximate',
    notes: ref.notes.map((note, i) => (slots[i].length ? { ...note, lyric: slots[i].join(' ') } : note)),
  };
}

export const readDocxWords = (path: string) => docxWords(readFileSync(path));
