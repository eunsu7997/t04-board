const stage = document.getElementById('stage');
const img = document.getElementById('pet');
const SPR = ['idle', 'walk', 'run', 'pose', 'excited', 'sleep', 'curious', 'lie', 'blink'];
SPR.forEach(n => { new Image().src = `sprites/${n}.png`; }); // 미리 로드해서 전환 시 깜빡임 방지

let state = 'idle', dir = 1, until = 0, dragging = false, b = null;
const rand = (a, z) => a + Math.random() * (z - a);

function set(s, ms) {
  state = s;
  until = performance.now() + ms;
  stage.className = s + (dir < 0 ? ' flip' : '');
  img.className = s === 'lie' ? 'lie' : '';
  img.src = `sprites/${s}.png`;
}

function next() {
  const r = Math.random();
  if (r < 0.30) set('idle', rand(3000, 6000));
  else if (r < 0.52) { dir = Math.random() < 0.5 ? -1 : 1; set('walk', rand(3000, 6000)); }
  else if (r < 0.62) { dir = Math.random() < 0.5 ? -1 : 1; set('run', rand(1500, 3000)); }
  else if (r < 0.72) set('pose', rand(2500, 4000));
  else if (r < 0.80) set('lie', rand(4000, 7000));
  else if (r < 0.87) set('excited', rand(1500, 2500));
  else if (r < 0.94) set('curious', rand(2500, 4000));
  else set('sleep', rand(6000, 10000));
}

// 휴식 중 가끔 눈 깜빡임 (가끔은 두 번 연속)
let nextBlink = performance.now() + 2000;
function blink(now) {
  if (state !== 'idle' || dragging || now < nextBlink) return;
  nextBlink = now + rand(2500, 5000);
  const twice = Math.random() < 0.25;
  const close = () => { if (state === 'idle') img.src = 'sprites/blink.png'; };
  const open = () => { if (state === 'idle') img.src = 'sprites/idle.png'; };
  close(); setTimeout(open, 130);
  if (twice) { setTimeout(close, 260); setTimeout(open, 390); }
}

let last = performance.now();
async function tick(now) {
  const dt = Math.min(now - last, 50); last = now;
  if (!dragging) {
    if (now > until) next();
    blink(now);
    const speed = state === 'walk' ? 0.05 : state === 'run' ? 0.17 : 0;
    if (speed) {
      b = await window.pet.bounds();
      let x = b.x + dir * speed * dt;
      if (x < b.minX || x > b.maxX) { dir = -dir; x = Math.max(b.minX, Math.min(b.maxX, x)); stage.className = state + (dir < 0 ? ' flip' : ''); }
      window.pet.move(x, b.floorY);
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// 마우스를 올리면 두리번 반응, 클릭하면 신남
img.addEventListener('mouseenter', () => { if (state === 'idle' || state === 'walk' || state === 'sleep') set('curious', 2500); });
img.addEventListener('dblclick', () => set('excited', 2200));
img.addEventListener('contextmenu', e => { e.preventDefault(); window.pet.menu(); });

// 드래그로 옮기기 (놓으면 바닥으로 내려옴)
let off = null;
img.addEventListener('mousedown', async e => {
  if (e.button !== 0) return;
  b = await window.pet.bounds();
  off = { x: e.screenX - b.x, y: e.screenY - b.y, sx: e.screenX, sy: e.screenY };
});
window.addEventListener('mousemove', e => {
  if (!off) return;
  if (!dragging && Math.hypot(e.screenX - off.sx, e.screenY - off.sy) > 4) { dragging = true; set('excited', 1e9); }
  if (dragging) window.pet.move(e.screenX - off.x, e.screenY - off.y);
});
window.addEventListener('mouseup', async () => {
  if (dragging) {
    b = await window.pet.bounds();
    window.pet.move(Math.max(b.minX, Math.min(b.maxX, b.x)), b.floorY);
    dragging = false; set('pose', 2000);
  }
  off = null;
});
