import { propagateAttributes, startActiveObservation } from '@langfuse/tracing';
import { complete, llmConfig } from './llm.ts';

export interface Take {
  audio: Buffer;
  format: 'wav' | 'mp3';
  songId: string;
  part: string;
  recordedAt: Date;
}

export interface Reference {
  title: string;
  part: string;
  lyrics: string;
}

export interface LyricComparison {
  accuracy: number;
  missed: string[];
  extra: string[];
}

export interface Coaching {
  transcript: string;
  lyrics: LyricComparison;
  tips: string[];
}

export interface CoachResult {
  coaching: Coaching;
  traceId: string;
}

const words = (text: string) => text.toLowerCase().match(/[\p{L}']+/gu) ?? [];

export function compareLyrics(expected: string, sung: string): LyricComparison {
  const remaining = new Map<string, number>();
  for (const w of words(sung)) remaining.set(w, (remaining.get(w) ?? 0) + 1);
  const missed: string[] = [];
  for (const w of words(expected)) {
    const n = remaining.get(w) ?? 0;
    if (n > 0) remaining.set(w, n - 1);
    else missed.push(w);
  }
  const extra = [...remaining].flatMap(([w, n]) => Array<string>(n).fill(w));
  const total = words(expected).length;
  return { accuracy: total ? (total - missed.length) / total : 1, missed, extra };
}

async function transcribe(take: Take, reference: Reference): Promise<string> {
  return complete(
    'transcribe-lyrics',
    {
      model: llmConfig.models.transcribe,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Transcribe the sung or spoken lyrics exactly as heard. Output only the words, no commentary.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Take of "${reference.title}" (${take.part} part).` },
            { type: 'input_audio', input_audio: { data: take.audio.toString('base64'), format: take.format } },
          ],
        },
      ],
    },
    { songId: take.songId, audioBytes: take.audio.length },
  );
}

async function writeCoaching(reference: Reference, transcript: string, lyrics: LyricComparison): Promise<string[]> {
  const text = await complete('write-coaching', {
    model: llmConfig.models.coach,
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content:
          'You coach a choir singer after one take. Give two or three short, concrete tips, one per line, no numbering. ' +
          'Base them only on the comparison you are given. Pitch analysis is not available yet, so do not comment on pitch.',
      },
      {
        role: 'user',
        content:
          `Song: ${reference.title} (${reference.part})\nExpected lyrics: ${reference.lyrics}\nSung: ${transcript}\n` +
          `Lyric accuracy: ${(lyrics.accuracy * 100).toFixed(0)}%\nMissed words: ${lyrics.missed.join(', ') || 'none'}\n` +
          `Extra words: ${lyrics.extra.join(', ') || 'none'}`,
      },
    ],
  });
  return text.split('\n').map((l) => l.replace(/^[-*•\s]+/, '').trim()).filter(Boolean);
}

export async function coachTake(take: Take, reference: Reference): Promise<CoachResult> {
  const day = take.recordedAt.toISOString().slice(0, 10);
  return propagateAttributes(
    {
      traceName: 'coach-take',
      sessionId: `${take.songId}:${day}`,
      userId: 'owner',
      tags: ['coach-take', `part:${take.part}`],
      metadata: { songId: take.songId },
    },
    () =>
      startActiveObservation('coach-take', async (root) => {
        root.update({ input: { song: reference.title, part: take.part, recordedAt: take.recordedAt.toISOString() } });

        const transcript = await transcribe(take, reference);

        const lyrics = await startActiveObservation(
          'compare-to-reference',
          async (span) => {
            span.update({ input: { expected: reference.lyrics, sung: transcript } });
            const result = compareLyrics(reference.lyrics, transcript);
            span.update({ output: result });
            return result;
          },
          { asType: 'evaluator' },
        );

        const tips = await writeCoaching(reference, transcript, lyrics);
        root.update({ output: tips.join('\n'), metadata: { lyricAccuracy: lyrics.accuracy } });
        return { coaching: { transcript, lyrics, tips }, traceId: root.traceId };
      }),
  );
}
