"""Sung pitch tracker. Usage: python pitch/track.py <audio file> [--device cpu]

Decodes any format ffmpeg reads (MP4, M4A, OGG, MP3, WAV), runs CREPE every 10 ms
and prints JSON: {"hop_sec", "frames": [{"t", "hz", "midi", "confidence", "voiced"}]}.
Unvoiced frames (silence, breath) have hz and midi set to null, so they never count as notes.
"""
import argparse
import json
import subprocess
import sys

import numpy as np

SAMPLE_RATE = 16000
HOP = 160  # 10 ms at 16 kHz, so 100 frames a second
FMIN, FMAX = 50.0, 1000.0  # choir range with room to spare
MIN_CONFIDENCE = 0.5  # CREPE periodicity below this is noise or breath
MIN_RMS_DB = -50.0  # frames quieter than this are silence


def decode(path: str) -> np.ndarray:
    """Mono float32 at 16 kHz through ffmpeg."""
    cmd = ['ffmpeg', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', str(SAMPLE_RATE), '-f', 'f32le', '-']
    out = subprocess.run(cmd, capture_output=True)
    if out.returncode != 0:
        raise RuntimeError(f'ffmpeg could not read {path}: {out.stderr.decode(errors="replace").strip()}')
    audio = np.frombuffer(out.stdout, dtype=np.float32)
    if audio.size == 0:
        raise RuntimeError(f'{path} has no audio')
    return audio


def frame_rms_db(audio: np.ndarray, n_frames: int) -> np.ndarray:
    """Loudness of each 64 ms CREPE window, centred on the frame time (CREPE pads the same way)."""
    padded = np.pad(audio, (512, 512))
    db = np.empty(n_frames)
    for i in range(n_frames):
        w = padded[i * HOP:i * HOP + 1024]
        db[i] = 20 * np.log10(max(float(np.sqrt(np.mean(w * w))), 1e-9))
    return db


def track(audio: np.ndarray, device: str = 'cpu') -> list[dict]:
    import torch
    import torchcrepe

    x = torch.from_numpy(audio.copy())[None]
    pitch, periodicity = torchcrepe.predict(
        x, SAMPLE_RATE, HOP, FMIN, FMAX, model='full', batch_size=512, device=device,
        return_periodicity=True, decoder=torchcrepe.decode.viterbi,
    )
    # Smooth the confidence over 3 frames and drop the unvoiced ones, as the torchcrepe docs advise.
    periodicity = torchcrepe.filter.median(periodicity, 3)
    hz = pitch[0].numpy()
    conf = periodicity[0].numpy()
    db = frame_rms_db(audio, len(hz))
    frames = []
    for i in range(len(hz)):
        voiced = bool(conf[i] >= MIN_CONFIDENCE and db[i] >= MIN_RMS_DB)
        frames.append({
            't': round(i * HOP / SAMPLE_RATE, 3),
            'hz': round(float(hz[i]), 2) if voiced else None,
            'midi': round(float(69 + 12 * np.log2(hz[i] / 440.0)), 3) if voiced else None,
            'confidence': round(float(conf[i]), 3),
            'voiced': voiced,
        })
    return frames


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('audio')
    ap.add_argument('--device', default='cpu')
    args = ap.parse_args()
    try:
        frames = track(decode(args.audio), args.device)
    except Exception as e:  # noqa: BLE001 - CLI boundary, report plainly
        print(f'error: {e}', file=sys.stderr)
        return 1
    json.dump({'hop_sec': HOP / SAMPLE_RATE, 'frames': frames}, sys.stdout)
    sys.stdout.write('\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
