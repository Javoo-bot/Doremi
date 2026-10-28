const $ = (id) => document.getElementById(id);
const canvas = $('graph');
const ctx = canvas.getContext('2d');
const audio = $('take-audio');
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let data = null;
let view = null; // { t0, t1, m0, m1 } and plot box
let cursor = 0;
let ref = null; // WebAudio playback of the score
// For tests and debugging: what is playing and from where.
window.doremi = { playing: null, from: null };

const PAD = { l: 48, r: 12, t: 12, b: 34 };
const noteName = (m) => ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'][((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);

function setView() {
  const mids = [...data.reference.map((n) => n.midi), ...data.take.filter((f) => f.midi !== null).map((f) => f.midi)];
  view = { t0: 0, t1: data.duration + 0.3, m0: Math.floor(Math.min(...mids)) - 2, m1: Math.ceil(Math.max(...mids)) + 2 };
}
const x = (t) => PAD.l + ((t - view.t0) / (view.t1 - view.t0)) * (canvas.width - PAD.l - PAD.r);
const y = (m) => PAD.t + (1 - (m - view.m0) / (view.m1 - view.m0)) * (canvas.height - PAD.t - PAD.b);
const timeAt = (px) => view.t0 + ((px - PAD.l) / (canvas.width - PAD.l - PAD.r)) * (view.t1 - view.t0);

function draw() {
  if (!data) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = css('--fg');
  ctx.strokeStyle = css('--score');
  // Bars: alternating shade, number at the bottom, red when flagged.
  data.bars.forEach((b, i) => {
    if (i % 2 === 0) { ctx.globalAlpha = 0.07; ctx.fillStyle = css('--fg'); ctx.fillRect(x(b.start), PAD.t, x(b.end) - x(b.start), h - PAD.t - PAD.b); ctx.globalAlpha = 1; }
    ctx.fillStyle = b.flagged ? css('--off') : css('--fg');
    ctx.textAlign = 'center';
    ctx.fillText(String(b.bar), (x(b.start) + x(b.end)) / 2, h - 12);
  });
  ctx.fillStyle = css('--fg');
  ctx.textAlign = 'right';
  for (let m = Math.ceil(view.m0); m <= view.m1; m++) if ([0, 2, 4, 5, 7, 9, 11].includes(m % 12)) {
    ctx.globalAlpha = 0.2; ctx.beginPath(); ctx.moveTo(PAD.l, y(m)); ctx.lineTo(w - PAD.r, y(m)); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillText(noteName(m), PAD.l - 6, y(m) + 4);
  }
  // Off-pitch stretches
  ctx.fillStyle = css('--off');
  for (const s of data.offPitch) { ctx.globalAlpha = 0.25; ctx.fillRect(x(s.start), PAD.t, x(s.end) - x(s.start), h - PAD.t - PAD.b); ctx.globalAlpha = 1; }
  // Score line
  ctx.strokeStyle = css('--score'); ctx.lineWidth = 4; ctx.lineCap = 'round';
  for (const n of data.reference) { ctx.beginPath(); ctx.moveTo(x(n.start), y(n.midi)); ctx.lineTo(x(n.end), y(n.midi)); ctx.stroke(); }
  // Your line
  ctx.strokeStyle = css('--you'); ctx.lineWidth = 2;
  ctx.beginPath();
  let pen = false;
  for (const f of data.take) {
    if (f.midi === null) { pen = false; continue; }
    if (pen) ctx.lineTo(x(f.t), y(f.midi)); else { ctx.moveTo(x(f.t), y(f.midi)); pen = true; }
  }
  ctx.stroke();
  // Cursor
  ctx.strokeStyle = css('--fg'); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x(cursor), PAD.t); ctx.lineTo(x(cursor), h - PAD.b); ctx.stroke();
}

function barAt(t) { return data.bars.find((b) => t >= b.start && t < b.end)?.bar ?? null; }

function setCursor(t) {
  cursor = Math.min(Math.max(t, 0), data.duration);
  const bar = barAt(cursor);
  $('cursor').textContent = `${cursor.toFixed(2)} s${bar ? ` · compàs ${bar}` : ''}`;
  document.querySelectorAll('#tips li').forEach((li) => li.classList.toggle('active', bar !== null && li.dataset.bars.split(',').includes(String(bar))));
  draw();
}

function stop() {
  audio.pause();
  if (ref) { ref.timer && clearInterval(ref.timer); ref.nodes.forEach((n) => { try { n.stop(); } catch {} }); ref.ctx.close(); ref = null; }
  $('play-a').setAttribute('aria-pressed', 'false');
  $('play-b').setAttribute('aria-pressed', 'false');
  window.doremi.playing = null;
}

function playA(from) {
  stop();
  // The take's own clock is the pitch track's clock.
  audio.currentTime = from;
  audio.play().catch(() => {});
  $('play-a').setAttribute('aria-pressed', 'true');
  window.doremi = { playing: 'take', from };
  const tick = () => { if (window.doremi.playing !== 'take') return; setCursor(audio.currentTime); requestAnimationFrame(tick); };
  tick();
  audio.onended = () => stop();
}

function playB(from) {
  stop();
  const ac = new AudioContext();
  const now = ac.currentTime + 0.05;
  const nodes = [];
  for (const n of data.reference) {
    if (n.end <= from) continue;
    const start = Math.max(n.start, from);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 440 * 2 ** ((n.midi - 69) / 12);
    const t0 = now + (start - from), t1 = now + (n.end - from);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.25, t0 + 0.02);
    gain.gain.setValueAtTime(0.25, t1 - 0.05);
    gain.gain.linearRampToValueAtTime(0, t1);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0); osc.stop(t1 + 0.01);
    nodes.push(osc);
  }
  const startedAt = performance.now();
  const end = data.duration - from;
  ref = { ctx: ac, nodes, timer: setInterval(() => {
    const el = (performance.now() - startedAt) / 1000;
    setCursor(from + el);
    if (el >= end) stop();
  }, 50) };
  $('play-b').setAttribute('aria-pressed', 'true');
  window.doremi = { playing: 'score', from };
}

function renderTips() {
  const ul = $('tips');
  ul.replaceChildren();
  for (const tip of data.tips) {
    const li = document.createElement('li');
    li.dataset.bars = tip.bars.join(',');
    // Link each "compàs N" in the text to its bar.
    const re = /(comp(?:àsos|assos|às|as)\s+)(\d+(?:\s*(?:,|i)\s*\d+)*)/giu;
    let last = 0;
    for (const m of tip.text.matchAll(re)) {
      li.append(tip.text.slice(last, m.index), m[1]);
      let at = 0;
      for (const num of m[2].matchAll(/\d+/g)) {
        li.append(m[2].slice(at, num.index));
        const a = document.createElement('a');
        a.textContent = num[0];
        a.dataset.bar = num[0];
        a.tabIndex = 0;
        a.role = 'link';
        const go = () => { const b = data.bars.find((b) => b.bar === Number(num[0])); if (b) setCursor(b.start); };
        a.onclick = go;
        a.onkeydown = (e) => { if (e.key === 'Enter') go(); };
        li.append(a);
        at = num.index + num[0].length;
      }
      li.append(m[2].slice(at));
      last = m.index + m[0].length;
    }
    li.append(tip.text.slice(last));
    ul.append(li);
  }
}

function show(result, file) {
  data = result;
  stop();
  if (audio.dataset.url) URL.revokeObjectURL(audio.dataset.url);
  audio.dataset.url = URL.createObjectURL(file);
  audio.src = audio.dataset.url;
  $('song').textContent = data.title;
  $('result').hidden = false;
  setView();
  renderTips();
  setCursor(0);
}

async function analyse(file) {
  const status = $('status');
  status.className = '';
  status.textContent = 'Analitzant…';
  try {
    const res = await fetch('/api/analyze', { method: 'POST', body: file });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? 'Error');
    status.textContent = `Fet: ${file.name || 'gravació'}`;
    show(body, file);
  } catch (e) {
    status.className = 'error';
    status.textContent = e.message;
  }
}

$('upload').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) analyse(f); });

let recorder = null;
$('record').addEventListener('click', async () => {
  if (recorder) { recorder.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      $('record').textContent = 'Grava';
      $('record').setAttribute('aria-pressed', 'false');
      const file = new File(chunks, 'gravacio', { type: recorder.mimeType });
      recorder = null;
      analyse(file);
    };
    recorder.start();
    $('record').textContent = 'Atura la gravació';
    $('record').setAttribute('aria-pressed', 'true');
  } catch {
    $('status').className = 'error';
    $('status').textContent = 'No puc usar el micròfon';
  }
});

canvas.addEventListener('click', (e) => {
  if (!data) return;
  const r = canvas.getBoundingClientRect();
  const t = timeAt(((e.clientX - r.left) / r.width) * canvas.width);
  setCursor(t);
  // A click plays whichever side was playing, so you can flip between them.
  const side = window.doremi.playing;
  if (side === 'take') playA(cursor);
  else if (side === 'score') playB(cursor);
});
$('play-a').addEventListener('click', () => playA(cursor));
$('play-b').addEventListener('click', () => playB(cursor));
$('stop').addEventListener('click', stop);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);
