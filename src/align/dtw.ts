export interface PitchFrame {
  t: number;
  midi: number | null;
  voiced: boolean;
}

export interface PitchTrack {
  hop_sec: number;
  frames: PitchFrame[];
}

/** Distance between two pitches in semitones, ignoring octaves, so an octave off costs nothing. */
export function foldedSemitones(a: number, b: number): number {
  const d = (((a - b) % 12) + 12) % 12;
  return Math.min(d, 12 - d);
}

/** Cost of matching one take frame to one reference frame. null means silence or a rest. */
export function frameCost(take: number | null, ref: number | null): number {
  if (take === null && ref === null) return 0;
  if (take === null || ref === null) return 1;
  return Math.min(foldedSemitones(take, ref), 1);
}

const OFF_DIAGONAL = 0.02;

/**
 * Banded dynamic time warping. Returns the path as [takeIndex, refIndex] pairs, start to end.
 * The band follows the diagonal from the first cell to the last, so the take may run
 * `band` frames ahead of or behind the reference at any point.
 */
export function dtw(take: (number | null)[], ref: (number | null)[], band = 400): [number, number][] {
  const n = take.length;
  const m = ref.length;
  if (n === 0 || m === 0) return [];
  const width = 2 * band + 1;
  const centre = (i: number) => Math.round((i * (m - 1)) / Math.max(n - 1, 1));
  const lo = (i: number) => centre(i) - band;
  // Moves: 0 diagonal, 1 take advances alone, 2 reference advances alone.
  const moves = new Uint8Array(n * width);
  let prev = new Float64Array(width).fill(Infinity);
  let cur = new Float64Array(width).fill(Infinity);
  for (let i = 0; i < n; i++) {
    cur.fill(Infinity);
    const l = lo(i);
    const pl = i > 0 ? lo(i - 1) : 0;
    for (let k = 0; k < width; k++) {
      const j = l + k;
      if (j < 0 || j >= m) continue;
      const c = frameCost(take[i], ref[j]);
      let best = Infinity;
      let move = 0;
      if (i === 0 && j === 0) {
        best = 0;
      } else {
        if (i > 0 && j > 0) {
          const pk = j - 1 - pl;
          if (pk >= 0 && pk < width && prev[pk] < best) { best = prev[pk]; move = 0; }
        }
        if (i > 0) {
          const pk = j - pl;
          if (pk >= 0 && pk < width && prev[pk] + OFF_DIAGONAL < best) { best = prev[pk] + OFF_DIAGONAL; move = 1; }
        }
        if (j > 0 && k > 0 && cur[k - 1] + OFF_DIAGONAL < best) { best = cur[k - 1] + OFF_DIAGONAL; move = 2; }
      }
      cur[k] = best + c;
      moves[i * width + k] = move;
    }
    [prev, cur] = [cur, prev];
  }
  const path: [number, number][] = [];
  let i = n - 1;
  let j = m - 1;
  if (!Number.isFinite(prev[j - lo(i)])) throw new Error('take and reference are too far apart in length to align');
  for (;;) {
    path.push([i, j]);
    if (i === 0 && j === 0) break;
    const move = moves[i * width + (j - lo(i))];
    if (move === 0) { i--; j--; } else if (move === 1) i--; else j--;
  }
  return path.reverse();
}
