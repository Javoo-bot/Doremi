import { createServer, type IncomingMessage, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PitchTrack } from '../align/dtw.js';
import { scoreTake } from '../align/score.js';
import { barFacts } from '../coaching/facts.ts';
import { fallbackTips, coachBars } from '../coaching/tips.ts';
import { trackBuffer } from '../pitch/yin.ts';
import type { Reference } from '../score/types.js';
import { analyse } from './analysis.ts';

const MAX_UPLOAD = 50 * 1024 * 1024;
const publicDir = new URL('./public/', import.meta.url);
const files: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

export interface ServerOptions {
  reference: Reference;
  /** Python with torch and torchcrepe for full CREPE. Without it the built-in YIN tracker is used. */
  pitchPython?: string;
  /** Ask the model for the tips. Without it the tips come straight from the numbers. */
  useModel?: boolean;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_UPLOAD) { reject(new Error('too big')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function crepe(python: string, audio: Buffer): PitchTrack | null {
  const dir = mkdtempSync(join(tmpdir(), 'doremi-'));
  try {
    const path = join(dir, 'take');
    writeFileSync(path, audio);
    const r = spawnSync(python, [new URL('../../pitch/track.py', import.meta.url).pathname, path], { encoding: 'utf8', maxBuffer: 1 << 28 });
    return r.status === 0 ? (JSON.parse(r.stdout) as PitchTrack) : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function createApp(opts: ServerOptions): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && files[url.pathname]) {
        const [name, type] = files[url.pathname];
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(readFileSync(new URL(name, publicDir)));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/analyze') {
        const audio = await readBody(req);
        if (audio.length === 0) throw Object.assign(new Error('Cap fitxer'), { status: 400 });
        let pitch: PitchTrack | null = null;
        if (opts.pitchPython) pitch = crepe(opts.pitchPython, audio);
        if (!pitch) {
          try { pitch = trackBuffer(audio); } catch (e) { throw Object.assign(new Error('No puc llegir aquest àudio'), { status: 422, cause: e }); }
        }
        const score = scoreTake(opts.reference, pitch);
        let tips = { tips: fallbackTips(barFacts(score)), source: 'fallback' as string };
        if (score.flaggedBars.length === 0) tips = { tips: ['Tots els compassos han sortit bé. Continua així.'], source: 'none' };
        else if (opts.useModel) {
          try { tips = await coachBars(score, opts.reference.title); } catch { /* keep the numbers-only tips */ }
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(analyse(opts.reference, pitch, tips, score)));
        return;
      }
      res.writeHead(404).end('not found');
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (e as Error).message }));
    }
  });
}
