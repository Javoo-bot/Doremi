// promptfoo assertion for the coaching tips. Same rule as tipNamesOnly in src/coaching/tips.ts,
// kept in plain CommonJS so promptfoo can load it without a TypeScript step.
function barsNamed(tip) {
  const bars = new Set();
  const re = /\bcomp(?:àsos|assos|às|as)\s+(\d+(?:\s*(?:,|i|-|–|a)\s*\d+)*)/giu;
  for (const m of tip.matchAll(re)) {
    const nums = m[1].split(/\s*(?:,|i|-|–|a)\s*/u).map(Number);
    if (/[-–]|\ba\b/u.test(m[1]) && nums.length === 2) {
      for (let b = nums[0]; b <= nums[1]; b++) bars.add(b);
    } else for (const b of nums) bars.add(b);
  }
  return [...bars];
}

module.exports = (output, { vars }) => {
  const tips = String(output).split('\n').map((l) => l.replace(/^[-*•\d.)\s]+(?=\S)/u, '').trim()).filter(Boolean);
  const flagged = vars.flagged;
  if (tips.length < 1 || tips.length > 3) return { pass: false, score: 0, reason: `expected 1 to 3 tips, got ${tips.length}` };
  for (const tip of tips) {
    const named = barsNamed(tip);
    if (named.length === 0) return { pass: false, score: 0, reason: `tip names no bar: ${tip}` };
    const wrong = named.filter((b) => !flagged.includes(b));
    if (wrong.length) return { pass: false, score: 0, reason: `tip names bar ${wrong.join(', ')}, sung well: ${tip}` };
  }
  if (!/comp[àa]s/iu.test(String(output))) return { pass: false, score: 0, reason: 'no Catalan bar word' };
  return { pass: true, score: 1, reason: 'every tip names a flagged bar and no good bar' };
};
