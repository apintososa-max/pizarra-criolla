/* Pizarra Criolla · charts.js
   Gráficos en SVG, sin librerías: la curva de probabilidad de ganar de un juego y una línea simple
   para acumulados (diferencial de carreras, promedio de un jugador). Colores siempre desde los tokens de CSS. */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let uid = 0;

  function niceStep(span, count) {
    const raw = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }

  function tooltip(box) {
    let tip = box.querySelector('.viz-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'viz-tip';
      tip.hidden = true;
      box.appendChild(tip);
    }
    return tip;
  }

  function placeTip(box, tip, x) {
    const w = box.clientWidth;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    let left = x - tw / 2;
    left = Math.max(0, Math.min(w - tw, left));
    tip.style.left = left + 'px';
  }

  // ---------- probabilidad de ganar ----------
  // plays: salida de calc.wpa().plays. o: {away, home (abreviaturas), total (jugadas esperadas), cursor, label(play)}
  function winProb(box, plays, o) {
    o = o || {};
    box.classList.add('viz');
    const W = Math.max(280, box.clientWidth || 320);
    const padL = 40, padR = 46, padT = 10, plotH = 150, gap = 8, liH = 22, axisH = 20;
    const H = padT + plotH + gap + liH + axisH;
    const n = plays.length;
    const shown = o.cursor == null ? n : Math.min(n, o.cursor + 1);
    const total = Math.max(o.total || n, n, 1);
    const plotW = W - padL - padR;
    const x = i => padL + (i / total) * plotW;            // i = 0 es antes del primer lanzamiento
    const y = v => padT + (v / 100) * plotH;              // v = % del home club; arriba gana el visitante
    const mid = y(50);
    const pts = [[x(0), y(n ? plays[0].before : 50)]];
    for (let i = 0; i < shown; i++) pts.push([x(i + 1), y(plays[i].after)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const last = pts[pts.length - 1];
    const area = line + ` L${last[0].toFixed(1)} ${mid} L${pts[0][0].toFixed(1)} ${mid} Z`;
    const id = 'wp' + (++uid);

    // separadores de inning (en la primera jugada de cada alta)
    let grid = '', labels = '';
    const starts = [];
    plays.forEach((p, i) => { if (p.top && (i === 0 || !plays[i - 1].top)) starts.push({ i, inning: p.inning }); });
    starts.forEach((s, k) => {
      const x0 = x(s.i), x1 = k + 1 < starts.length ? x(starts[k + 1].i) : x(Math.max(n, total));
      if (k) grid += `<line x1="${x0.toFixed(1)}" x2="${x0.toFixed(1)}" y1="${padT}" y2="${padT + plotH}" class="viz-grid"/>`;
      if (x1 - x0 > 9) labels += `<text x="${((x0 + x1) / 2).toFixed(1)}" y="${H - 5}" class="viz-tick" text-anchor="middle">${s.inning}</text>`;
    });

    // barras de presión (leverage index) por turno
    let li = '';
    const bw = Math.max(1, Math.min(24, plotW / total - 1));
    const liTop = padT + plotH + gap;
    for (let i = 0; i < shown; i++) {
      const v = plays[i].li;
      if (v == null) continue;
      const h = Math.max(1, Math.min(1, v / 4) * liH);
      li += `<rect x="${(x(i + 1) - bw / 2).toFixed(1)}" y="${(liTop + liH - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(2, bw / 2)}" class="viz-li"/>`;
    }

    const endV = shown ? plays[shown - 1].after : (n ? plays[0].before : 50);
    const favAway = endV < 50;
    const endPct = Math.round(favAway ? 100 - endV : endV);
    const endTeam = favAway ? o.away : o.home;
    const endCls = favAway ? 'away' : 'home';

    box.innerHTML = `
<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" tabindex="0"
  aria-label="Probabilidad de ganar jugada por jugada: ${esc(endTeam)} ${endPct}% al final de lo mostrado">
  <defs>
    <clipPath id="${id}a"><rect x="0" y="0" width="${W}" height="${mid}"/></clipPath>
    <clipPath id="${id}h"><rect x="0" y="${mid}" width="${W}" height="${H - mid}"/></clipPath>
  </defs>
  <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" class="viz-plot"/>
  ${grid}
  <line x1="${padL}" x2="${padL + plotW}" y1="${mid}" y2="${mid}" class="viz-base"/>
  <path d="${area}" class="viz-area away" clip-path="url(#${id}a)"/>
  <path d="${area}" class="viz-area home" clip-path="url(#${id}h)"/>
  <path d="${line}" class="viz-line"/>
  ${li}
  <text x="${padL - 6}" y="${padT + 9}" class="viz-lab" text-anchor="end">${esc(o.away)}</text>
  <text x="${padL - 6}" y="${mid + 4}" class="viz-tick" text-anchor="end">50%</text>
  <text x="${padL - 6}" y="${padT + plotH - 2}" class="viz-lab" text-anchor="end">${esc(o.home)}</text>
  <text x="${padL - 6}" y="${liTop + liH - 4}" class="viz-tick" text-anchor="end">LI</text>
  ${labels}
  <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4" class="viz-dot ${endCls}"/>
  <text x="${(last[0] + 8).toFixed(1)}" y="${(Math.max(padT + 10, Math.min(padT + plotH - 2, last[1] + 4))).toFixed(1)}" class="viz-end">${endPct}%</text>
  <g class="viz-cross" visibility="hidden">
    <line y1="${padT}" y2="${padT + plotH}" class="viz-cross-line"/>
    <circle r="4" class="viz-dot"/>
  </g>
  <rect x="${padL}" y="0" width="${plotW}" height="${padT + plotH + gap + liH}" fill="transparent" class="viz-hit"/>
</svg>`;

    const svg = box.querySelector('svg');
    const cross = svg.querySelector('.viz-cross');
    const cl = cross.querySelector('line'), cd = cross.querySelector('circle');
    const tip = tooltip(box);
    let cur = null;
    const show = i => {
      if (i == null || i < 0 || i >= shown) { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; cur = null; return; }
      cur = i;
      const p = plays[i], px = x(i + 1), py = y(p.after);
      cl.setAttribute('x1', px); cl.setAttribute('x2', px);
      cd.setAttribute('cx', px); cd.setAttribute('cy', py);
      cd.setAttribute('class', 'viz-dot ' + (p.after < 50 ? 'away' : 'home'));
      cross.setAttribute('visibility', 'visible');
      const fav = p.after < 50 ? o.away : o.home, fp = Math.round(p.after < 50 ? 100 - p.after : p.after);
      const d = p.dswing;
      tip.innerHTML = `<b>${p.top ? 'Alta' : 'Baja'} del ${p.inning}.º</b> ${esc(p.desc)}` +
        `<span class="viz-tip-num">${esc(fav)} ${fp}% · ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} pts para el que batea${p.li != null ? ` · LI ${p.li.toFixed(1)}` : ''}</span>`;
      placeTip(box, tip, px * (box.clientWidth / W));
    };
    const pick = ev => {
      const r = svg.getBoundingClientRect();
      const px = (ev.clientX - r.left) * (W / r.width);
      const i = Math.round(((px - padL) / plotW) * total) - 1;
      show(Math.max(0, Math.min(shown - 1, i)));
    };
    const hit = svg.querySelector('.viz-hit');
    hit.addEventListener('pointermove', pick);
    hit.addEventListener('pointerdown', pick);
    svg.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') show(null); });
    svg.addEventListener('keydown', ev => {
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        ev.preventDefault();
        show(Math.max(0, Math.min(shown - 1, (cur == null ? shown - 1 : cur) + (ev.key === 'ArrowRight' ? 1 : -1))));
      } else if (ev.key === 'Escape') show(null);
    });
    svg.addEventListener('blur', () => show(null));
  }

  // ---------- línea simple con eje cero opcional ----------
  // pts: [{y, tip}], o: {fmt, zero, height, label}
  function line(box, pts, o) {
    o = o || {};
    box.classList.add('viz');
    const W = Math.max(280, box.clientWidth || 320);
    const padL = 40, padR = 44, padT = 10, plotH = o.height || 120, axisH = 18;
    const H = padT + plotH + axisH;
    const fmt = o.fmt || (v => String(v));
    const n = pts.length;
    if (!n) { box.innerHTML = ''; return; }
    let lo = Math.min(...pts.map(p => p.y)), hi = Math.max(...pts.map(p => p.y));
    if (o.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (o.ref != null) { lo = Math.min(lo, o.ref); hi = Math.max(hi, o.ref); }
    if (hi === lo) { hi += 1; lo -= 1; }
    const step = niceStep(hi - lo, 3);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const plotW = W - padL - padR;
    const x = i => padL + (n === 1 ? plotW : (i / (n - 1)) * plotW);
    const y = v => padT + (1 - (v - lo) / (hi - lo)) * plotH;
    let grid = '';
    for (let v = lo; v <= hi + step / 2; v += step) {
      const yy = y(v).toFixed(1);
      grid += `<line x1="${padL}" x2="${padL + plotW}" y1="${yy}" y2="${yy}" class="${Math.abs(v) < step / 1e3 && o.zero ? 'viz-base' : 'viz-grid'}"/>` +
        `<text x="${padL - 6}" y="${(+yy + 4).toFixed(1)}" class="viz-tick" text-anchor="end">${esc(fmt(v))}</text>`;
    }
    const base = o.zero ? y(0) : padT + plotH;
    const d = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.y).toFixed(1)).join(' ');
    const area = d + ` L${x(n - 1).toFixed(1)} ${base.toFixed(1)} L${x(0).toFixed(1)} ${base.toFixed(1)} Z`;
    const ref = o.ref != null ? `<line x1="${padL}" x2="${padL + plotW}" y1="${y(o.ref).toFixed(1)}" y2="${y(o.ref).toFixed(1)}" class="viz-ref"/>
      <text x="${padL + plotW + 4}" y="${(y(o.ref) + 4).toFixed(1)}" class="viz-tick">${esc(o.refLabel || '')}</text>` : '';
    const lp = pts[n - 1];
    let xl = '';
    const every = Math.max(1, Math.ceil(n / 6));
    for (let i = 0; i < n; i += every) xl += `<text x="${x(i).toFixed(1)}" y="${H - 4}" class="viz-tick" text-anchor="middle">${i + 1}</text>`;
    box.innerHTML = `
<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" tabindex="0" aria-label="${esc(o.label || 'Gráfico')}: último valor ${esc(fmt(lp.y))}">
  ${grid}${ref}
  <path d="${area}" class="viz-area one"/>
  <path d="${d}" class="viz-line one"/>
  ${xl}
  <circle cx="${x(n - 1).toFixed(1)}" cy="${y(lp.y).toFixed(1)}" r="4" class="viz-dot one"/>
  <text x="${(x(n - 1) + 8).toFixed(1)}" y="${(y(lp.y) + 4).toFixed(1)}" class="viz-end">${esc(fmt(lp.y))}</text>
  <g class="viz-cross" visibility="hidden"><line y1="${padT}" y2="${padT + plotH}" class="viz-cross-line"/><circle r="4" class="viz-dot one"/></g>
  <rect x="${padL}" y="0" width="${plotW}" height="${padT + plotH}" fill="transparent" class="viz-hit"/>
</svg>`;
    const svg = box.querySelector('svg');
    const cross = svg.querySelector('.viz-cross'), cl = cross.querySelector('line'), cd = cross.querySelector('circle');
    const tip = tooltip(box);
    let cur = null;
    const show = i => {
      if (i == null) { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; cur = null; return; }
      cur = i;
      const px = x(i), py = y(pts[i].y);
      cl.setAttribute('x1', px); cl.setAttribute('x2', px);
      cd.setAttribute('cx', px); cd.setAttribute('cy', py);
      cross.setAttribute('visibility', 'visible');
      tip.innerHTML = pts[i].tip || esc(fmt(pts[i].y));
      placeTip(box, tip, px * (box.clientWidth / W));
    };
    const pick = ev => {
      const r = svg.getBoundingClientRect();
      const px = (ev.clientX - r.left) * (W / r.width);
      const i = n === 1 ? 0 : Math.round(((px - padL) / plotW) * (n - 1));
      show(Math.max(0, Math.min(n - 1, i)));
    };
    const hit = svg.querySelector('.viz-hit');
    hit.addEventListener('pointermove', pick);
    hit.addEventListener('pointerdown', pick);
    svg.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') show(null); });
    svg.addEventListener('keydown', ev => {
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        ev.preventDefault();
        show(Math.max(0, Math.min(n - 1, (cur == null ? n - 1 : cur) + (ev.key === 'ArrowRight' ? 1 : -1))));
      } else if (ev.key === 'Escape') show(null);
    });
    svg.addEventListener('blur', () => show(null));
  }

  // Redibuja al cambiar el ancho (girar el teléfono). Un solo observador por gráfico aunque se redibuje mil veces.
  function responsive(box, draw) {
    box._draw = draw;
    draw();
    if (box._ro || typeof ResizeObserver === 'undefined') return;
    let w = box.clientWidth;
    box._ro = new ResizeObserver(() => {
      if (!box.isConnected) { box._ro.disconnect(); return; }
      if (Math.abs(box.clientWidth - w) > 8) { w = box.clientWidth; box._draw(); }
    });
    box._ro.observe(box);
  }

  root.PC = root.PC || {};
  root.PC.charts = { winProb, line, responsive, NS };
})(typeof window !== 'undefined' ? window : globalThis);
