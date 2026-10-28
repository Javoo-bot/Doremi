"""Exit check for phase 2: median error under 10 cents on generated audio, unvoiced gaps detected."""
import json
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'pitch'))

import synth  # noqa: E402
import track  # noqa: E402

TAKES = ROOT / 'tests' / 'fixtures' / 'takes'
TRUTH = json.loads((TAKES / 'satb-bass.truth.json').read_text())
MARGIN = 0.12  # skip note onsets and offsets, where CREPE's 64 ms window straddles a change


def truth_midi_at(t: float):
    """Returns (midi, inside) - inside is True only well within a note, False only well inside a gap, else None."""
    for n in TRUTH:
        if n['start'] + MARGIN <= t <= n['end'] - MARGIN:
            return n['midi'], True
    for a, b in zip(TRUTH, TRUTH[1:]):
        if a['end'] + 0.06 <= t <= b['start'] - 0.06:
            return None, False
    return None, None


def evaluate(path: Path):
    frames = track.track(track.decode(str(path)))
    errors, gap_voiced, gap_total, note_unvoiced, note_total = [], 0, 0, 0, 0
    for f in frames:
        midi, inside = truth_midi_at(f['t'])
        if inside is True:
            note_total += 1
            if not f['voiced']:
                note_unvoiced += 1
            else:
                errors.append(abs(f['midi'] - midi) * 100)
        elif inside is False:
            gap_total += 1
            gap_voiced += f['voiced']
    return frames, errors, gap_voiced, gap_total, note_unvoiced, note_total


@pytest.mark.parametrize('ext', ['wav', 'mp3', 'm4a', 'ogg'])
def test_median_error_under_10_cents_and_gaps_unvoiced(ext):
    frames, errors, gap_voiced, gap_total, note_unvoiced, note_total = evaluate(TAKES / f'satb-bass.{ext}')
    assert len(frames) / (frames[-1]['t'] + 0.01) == pytest.approx(100, rel=0.02), 'about 100 frames a second'
    assert note_total > 100 and gap_total > 20
    assert float(np.median(errors)) < 10
    assert gap_voiced / gap_total < 0.05, 'silent gaps must be unvoiced'
    assert note_unvoiced / note_total < 0.05, 'sung notes must be voiced'


def test_unvoiced_frames_carry_no_pitch():
    frames = track.track(track.decode(str(TAKES / 'satb-bass.wav')))
    assert any(not f['voiced'] for f in frames)
    for f in frames:
        assert (f['hz'] is None and f['midi'] is None) == (not f['voiced'])


def test_breath_noise_is_not_voiced():
    rng = np.random.default_rng(3)
    audio = (rng.normal(0, 0.03, 16000 * 2)).astype(np.float32)  # 2 s of airy noise, no pitch
    frames = track.track(audio)
    assert sum(f['voiced'] for f in frames) / len(frames) < 0.05


def test_a_wrong_pitch_is_measured_as_wrong():
    """Guards the test itself: a take 50 cents off must not pass the 10 cent bar."""
    notes = json.loads((ROOT / 'tests/fixtures/scores/satb-bass.reference.json').read_text())['notes']
    audio, truth = synth.synth(notes, transpose=0)
    shifted, _ = synth.synth([{**n, 'midi': n['midi'] + 0.5} for n in notes])
    frames = track.track(shifted)
    errs = []
    for f in frames:
        midi, inside = truth_midi_at(f['t'])
        if inside is True and f['voiced']:
            errs.append(abs(f['midi'] - midi) * 100)
    assert float(np.median(errs)) > 40


def test_unreadable_file_fails_plainly(tmp_path):
    bad = tmp_path / 'x.mp3'
    bad.write_bytes(b'not audio')
    with pytest.raises(RuntimeError, match='ffmpeg could not read'):
        track.decode(str(bad))
