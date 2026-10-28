// Usage: npm run coach -- <take.wav> <songId>
import { sdk } from '../src/instrumentation.ts';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { coachTake, type Reference } from '../src/coach.ts';

const [audioPath, songId] = process.argv.slice(2);
if (!audioPath || !songId) {
  console.error('Usage: npm run coach -- <take.wav|take.mp3> <songId>');
  process.exit(1);
}

const reference: Reference = JSON.parse(readFileSync(`songs/${songId}/reference.json`, 'utf8'));
const format = extname(audioPath).slice(1) as 'wav' | 'mp3';

try {
  const { coaching, traceId } = await coachTake(
    { audio: readFileSync(audioPath), format, songId, part: reference.part, recordedAt: new Date() },
    reference,
  );
  console.log(JSON.stringify({ traceId, ...coaching }, null, 2));
} finally {
  await sdk.shutdown();
}
