"""Test audio made by code: harmonic tones at the pitches of a phase 1 reference.json.

Usage: python pitch/synth.py <reference.json> <out dir> [--name take]
Writes <name>.wav/.mp3/.m4a/.ogg. Notes are shortened so there is a silent gap between them,
which the tracker must report as unvoiced. A little noise keeps the audio realistic.
"""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np

SR = 16000
GAP_SEC = 0.15  # silence at the end of every note, plus a lead-in at the start
LEAD_SEC = 0.3
HARMONICS = (1.0, 0.5, 0.33, 0.25, 0.15)  # a rough bass voice


def midi_to_hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def synth(notes: list[dict], transpose: int = 0, seed: int = 7) -> tuple[np.ndarray, list[dict]]:
    """Returns the audio and the truth: one {start, end, midi} per sounding stretch."""
    rng = np.random.default_rng(seed)
    total = LEAD_SEC + max(n['startSec'] + n['lengthSec'] for n in notes) + 0.3
    audio = np.zeros(int(total * SR))
    truth = []
    for n in notes:
        start = LEAD_SEC + n['startSec']
        end = start + n['lengthSec'] - GAP_SEC
        if end - start < 0.2:
            continue
        midi = n['midi'] + transpose
        t = np.arange(int((end - start) * SR)) / SR
        tone = sum(a * np.sin(2 * np.pi * midi_to_hz(midi) * (k + 1) * t) for k, a in enumerate(HARMONICS))
        env = np.minimum(1.0, np.minimum(t, t[-1] - t) / 0.03)  # 30 ms fades, no clicks
        i = int(start * SR)
        audio[i:i + len(t)] += 0.25 * tone * env
        truth.append({'start': start, 'end': end, 'midi': midi})
    audio += rng.normal(0, 0.0005, audio.shape)
    return audio.astype(np.float32), truth


def write_all(audio: np.ndarray, out_dir: Path, name: str) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    wav = out_dir / f'{name}.wav'
    pcm = (np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes()
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 's16le', '-ar', str(SR), '-ac', '1', '-i', '-', str(wav)],
                   input=pcm, check=True)
    paths = [wav]
    for ext, codec in (('mp3', 'libmp3lame'), ('m4a', 'aac'), ('ogg', 'libvorbis')):
        p = out_dir / f'{name}.{ext}'
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(wav), '-c:a', codec, '-b:a', '96k', str(p)], check=True)
        paths.append(p)
    return paths


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('reference')
    ap.add_argument('out_dir')
    ap.add_argument('--name', default='take')
    args = ap.parse_args()
    notes = json.loads(Path(args.reference).read_text())['notes']
    audio, truth = synth(notes)
    for p in write_all(audio, Path(args.out_dir), args.name):
        print(p)
    Path(args.out_dir, f'{args.name}.truth.json').write_text(json.dumps(truth, indent=1) + '\n')


if __name__ == '__main__':
    main()
