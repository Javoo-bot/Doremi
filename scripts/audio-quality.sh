#!/usr/bin/env bash
# Usage: scripts/audio-quality.sh <dir>
# Each test take must be at least 16 kHz, at least 1 s long, not clipped and not silent.
set -euo pipefail

DIR=${1:-tests/fixtures/takes}
mkdir -p reports
REPORT=reports/audio-quality.txt
: > "$REPORT"
fail=0
count=0

shopt -s nullglob nocaseglob
for f in "$DIR"/*.{wav,mp3,m4a,ogg,aac}; do
  count=$((count + 1))
  rate=$(ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate -of csv=p=0 "$f")
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  stats=$(ffmpeg -nostats -i "$f" -af astats=metadata=0 -f null - 2>&1 | grep -E "Overall|Peak level dB|RMS level dB" | tail -n 2)
  peak=$(grep -m1 "Peak level dB" <<<"$stats" | awk '{print $NF}')
  rms=$(grep -m1 "RMS level dB" <<<"$stats" | awk '{print $NF}')
  line="$(basename "$f"): ${rate} Hz, ${dur} s, peak ${peak} dB, rms ${rms} dB"
  problems=()
  awk "BEGIN{exit !($rate < 16000)}" && problems+=("sample rate below 16 kHz")
  awk "BEGIN{exit !($dur < 1)}" && problems+=("shorter than 1 s")
  awk "BEGIN{exit !($peak >= -0.1)}" && problems+=("clipped")
  awk "BEGIN{exit !($rms < -45)}" && problems+=("nearly silent")
  if ((${#problems[@]})); then
    echo "::error::$line: ${problems[*]}"
    echo "FAIL $line: ${problems[*]}" >> "$REPORT"
    fail=1
  else
    echo "ok   $line" | tee -a "$REPORT"
  fi
done

echo "$count take(s) checked" | tee -a "$REPORT"
((count > 0)) || { echo "::error::No test takes in $DIR"; exit 1; }
exit $fail
