# Pitch tracker

Setup: `python3 -m venv .venv && .venv/bin/pip install -r pitch/requirements.txt` (CPU torch is enough; ffmpeg must be installed).

- `python pitch/track.py take.m4a` prints JSON, one frame every 10 ms. Unvoiced frames (silence, breath) have `hz` and `midi` null.
- `python pitch/synth.py reference.json tests/fixtures/takes --name satb-bass` regenerates the test takes from a phase 1 reference.
- `pytest tests/pitch` is the phase 2 exit check. The Node test in `tests/unit/pitch-cli.test.ts` uses `PITCH_PYTHON` (default `python3`) and skips itself when torch is missing.
