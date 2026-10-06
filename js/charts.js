/* Pizarra Criolla · charts.js
   Gráficos en SVG hechos a mano, sin librerías. Colores siempre desde los tokens de CSS (styles.css y
   css/graficos.css) y letra con los tokens --fs-* (respetan la letra que el usuario eligió en el teléfono).
   - winProb: la curva de probabilidad de ganar con sus marcas (jonrones, cambios de lanzador, carreras por media
     entrada) y un cursor que se arrastra; lo que queda después del cursor va tenue.
   - spray: el mapa de batazos.  - zone: la zona de strike del turno.  - field: el campo en tiza con la defensa.
   - line: una línea simple para acumulados (diferencial de carreras, promedio de un jugador).
   winProb, spray, zone y field devuelven un controlador que sigue sirviendo aunque CH.responsive redibuje al girar el
   teléfono: el cursor, el aro, un lanzamiento nuevo o un corredor cambian sin rehacer el SVG. */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let uid = 0;

  // ---------- ayudantes ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const f1 = v => (+v).toFixed(1);
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  const reduced = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const raf = f => (root.requestAnimationFrame ? root.requestAnimationFrame(f) : setTimeout(f, 16));
  const caf = id => (root.cancelAnimationFrame ? root.cancelAnimationFrame(id) : clearTimeout(id));

  // "José A. Martínez" -> "Martínez" ; "Ronald Acuña Jr." -> "Acuña Jr." (igual que en juegos.js)
  const surname = n => {
    const p = String(n || '').split(' ').filter(x => x && !/^[A-Z]\.$/.test(x));
    return p.length > 1 ? p.slice(1).join(' ') : (p[0] || '');
  };

  // px de un token de letra (--fs-cap, --fs-sm…) con la letra del usuario. Se lee al dibujar, nunca al arrastrar.
  function fsPx(name) {
    try {
      const cs = getComputedStyle(document.documentElement);
      const base = parseFloat(cs.fontSize) || 16, v = cs.getPropertyValue(name).trim(), n = parseFloat(v);
      return n ? (/px$/.test(v) ? n : n * base) : base * .75;
    } catch (e) { return 12; }
  }
  // Ancho aproximado de un texto, sin medir (sirve mientras se arrastra). em: ancho medio de una letra.
  const textW = (t, px, em) => String(t == null ? '' : t).length * px * (em || .56);
  // Ancho para dibujar: el de la caja sin su relleno. Con el relleno adentro el SVG se encogía para caber y la letra
  // quedaba más chica que su token. Se lee al dibujar.
  function innerW(box, min, def) {
    let w = box.clientWidth || 0;
    if (w) {
      try { const cs = getComputedStyle(box); w -= (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0); } catch (e) { /* sin estilo */ }
    }
    return Math.max(min, Math.floor(w) || def);
  }

  // Nombre corto de una jugada para las etiquetas: viene como texto de la API en español ("Base por Bolas"),
  // como C.eventEs ("Rolata") o como eventType ("field_out").
  const EV_ES = {
    'Base por Bolas': 'Boleto', 'Base por Bolas Intencional': 'Boleto intencional', 'Pelotazo': 'Golpeado',
    'Roletazo de Out': 'Rolata', 'Elevado de Out': 'Elevado', 'Línea de Out': 'Línea', 'Elevadito de Out': 'Elevadito',
    'Roletazo de Doble Play': 'Doble play', 'Error de Fildeo': 'Error', 'Out Forzado': 'Out forzado',
    'Elevado de Sacrificio': 'Elevado de sacrificio', 'Toque de Sacrificio': 'Toque de sacrificio'
  };
  const EV_TYPE = {
    single: 'Sencillo', double: 'Doble', triple: 'Triple', home_run: 'Jonrón', walk: 'Boleto', intent_walk: 'Boleto intencional',
    hit_by_pitch: 'Golpeado', strikeout: 'Ponche', field_error: 'Error', force_out: 'Out forzado', sac_fly: 'Elevado de sacrificio',
    sac_bunt: 'Toque de sacrificio', grounded_into_double_play: 'Doble play', double_play: 'Doble play',
    fielders_choice: 'Selección', fielders_choice_out: 'Selección'
  };
  const TRAJ = { ground_ball: 'Rolata', fly_ball: 'Elevado', line_drive: 'Línea', popup: 'Elevadito', bunt_grounder: 'Toque', bunt_popup: 'Elevadito de toque', bunt_line_drive: 'Línea de toque' };
  const evShort = (ev, traj) => {
    const e = String(ev || '');
    if (/^[a-z_]+$/.test(e)) return e === 'field_out' ? TRAJ[traj] || 'Out' : EV_TYPE[e] || 'Jugada';
    return EV_ES[e] || e || 'Jugada';
  };

  // Controlador estable por caja. CH.responsive vuelve a llamar a la función al cambiar el ancho y el SVG se rehace,
  // pero el objeto que recibió quien llamó la primera vez sigue sirviendo: sus métodos usan siempre el último dibujo.
  // k.st guarda lo que sobrevive al redibujo (cursor, aro, lo último que llegó por update); k.on y k.offs, los oyentes,
  // cuadros y relojes que se sueltan al redibujar y en destroy().
  function ctl(box, kind, methods) {
    let k = box._pcCtl;
    // otro gráfico en la misma caja: el controlador viejo queda sin efecto (el observador de CH.responsive sigue)
    if (k && k.kind !== kind) { k.clean(); k.impl = {}; k = null; }
    if (!k) {
      const offs = [];
      k = { kind, st: {}, impl: {}, offs, api: {} };
      k.on = (el, type, fn, opt) => { el.addEventListener(type, fn, opt); offs.push(() => el.removeEventListener(type, fn, opt)); };
      k.clean = () => { while (offs.length) { try { offs.pop()(); } catch (e) { /* ya no estaba */ } } };
      methods.forEach(m => { k.api[m] = (a, b) => (k.impl[m] ? k.impl[m](a, b) : undefined); });
      k.api.destroy = () => {
        k.clean();
        k.impl = {};
        if (box._ro) { box._ro.disconnect(); box._ro = null; }
        box._draw = null;
        if (box._pcCtl === k) box._pcCtl = null;
      };
      box._pcCtl = k;
    }
    k.clean();
    k.impl = {};
    return k;
  }
  // Una entrada suave (solo opacidad y transform) para lo que aparece de nuevo; nada con "menos movimiento".
  const enter = (el, from) => {
    if (!el || !el.animate || reduced()) return;
    try { el.animate([from || { opacity: 0 }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2, .8, .2, 1)' }); } catch (e) { /* sin animación */ }
  };

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
  // plays: salida de calc.wpa().plays (una por turno, el mismo índice que las jugadas completas). o:
  //   away, home: siglas · total: jugadas esperadas (en vivo la curva no llega al final) · cursor: jugada marcada
  //   marks: salida de C.wpMarks (jonrones, cambios de lanzador, carreras por media entrada) · labelOf(i): texto de las
  //   dos jugadas que más movieron la curva (si no, "Doble de Marcano" con lo que trae la API)
  //   animate: al abrir, la curva se dibuja de izquierda a derecha · onPick(i): al tocar o arrastrar, una vez por cuadro
  //   onRelease(i): al soltar.
  // Sin onPick ni onRelease se comporta como siempre: tocar o pasar el ratón muestra la jugada en un globito.
  // Devuelve { setCursor(i), destroy() }; setCursor mueve la cruz y el tramo tenue sin rehacer el SVG (null: sin cursor).
  function winProb(box, plays, o) {
    o = o || {};
    plays = plays || [];
    const K = ctl(box, 'wp', ['setCursor']), S = K.st;
    box.classList.add('viz', 'gw');
    const n = plays.length;
    const pick = typeof o.onPick === 'function' || typeof o.onRelease === 'function';
    const norm = i => (i == null || !n || !isFinite(i) ? null : clamp(Math.round(i), 0, n - 1));
    // si el cursor que se pasa cambió, manda ese; si es el mismo (redibujo al girar), queda donde lo dejó el dedo
    S.cur = !('given' in S) || o.cursor !== S.given ? norm(o.cursor) : norm(S.cur);
    S.given = o.cursor;
    const M = o.marks || null;
    const fc = fsPx('--fs-cap'), fsm = fsPx('--fs-sm');
    const W = innerW(box, 280, 320);
    // a la derecha solo el aire del punto: el % del final se corre adentro si no cabe afuera
    const padL = Math.max(40, Math.round(fc * 3.6)), padR = 12;
    const pillH = Math.round(fc * 1.75), padT = pillH + 8, plotH = 150;
    const plotW = W - padL - padR;
    const total = Math.max(o.total || n, n, 1);
    const x = i => padL + (i / total) * plotW;            // i = 0 es antes del primer lanzamiento
    const y = v => padT + (v / 100) * plotH;              // v = % del home club; arriba gana el visitante
    const mid = y(50);
    // franjas bajo la curva: carreras por media entrada y cambios de lanzador (con marcas), presión (LI) e innings
    const chipH = Math.round(fc * 1.45), rowOff = Math.round(chipH * .72);
    let yy = padT + plotH + 8;
    const runY = yy; if (M) yy += chipH + rowOff + 6;
    const liTop = yy, liH = 22; yy += liH + (M ? 6 : 0);
    const subY = yy, subH = 16; if (M) yy += subH;
    const bandEnd = yy;
    const H = Math.round(bandEnd + fc + 10);
    const pts = [[x(0), y(n ? plays[0].before : 50)]];
    for (let i = 0; i < n; i++) pts.push([x(i + 1), y(plays[i].after)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + f1(p[0]) + ' ' + f1(p[1])).join(' ');
    const last = pts[pts.length - 1];
    const area = line + ` L${f1(last[0])} ${f1(mid)} L${f1(pts[0][0])} ${f1(mid)} Z`;
    const id = 'wp' + (++uid);

    // separadores de inning (en la primera jugada de cada alta) y su número al pie
    let grid = '';
    const starts = [], inn = [];
    plays.forEach((p, i) => { if (p.top && (i === 0 || !plays[i - 1].top)) starts.push({ i, inning: p.inning }); });
    starts.forEach((s, k) => {
      const x0 = x(s.i), x1 = k + 1 < starts.length ? x(starts[k + 1].i) : x(Math.max(n, total));
      if (k) grid += `<line x1="${f1(x0)}" x2="${f1(x0)}" y1="${padT}" y2="${f1(bandEnd)}" class="viz-grid"/>`;
      if (x1 - x0 > 9) inn.push({ t: String(s.inning), x0, cx: (x0 + x1) / 2 });
    });
    // Números de inning que no caben separados ("1011" en extrainnings cortos o con letra grande): el de antes se corre
    // a la izquierda sin salirse de su inning y, si ni así, se salta; el último (donde va o terminó el juego) siempre
    // queda. El ancho se estima con la letra (antes se medía con getBBox, que forzaba el layout al abrir).
    let edge = Infinity;
    for (let j = inn.length - 1; j >= 0; j--) {
      const t = inn[j], w = textW(t.t, fc, .6), bx = t.cx - w / 2, over = bx + w + Math.max(4, fc * .45) - edge;
      if (over <= 0) { edge = bx; continue; }
      if (t.cx - over < t.x0) { t.skip = true; continue; }
      t.cx -= over;
      edge = bx - over;
    }
    const labels = inn.filter(t => !t.skip).map(t => `<text x="${f1(t.cx)}" y="${H - 5}" class="viz-tick viz-inn" text-anchor="middle">${t.t}</text>`).join('');

    // barras de presión (leverage index) por turno
    const bw = Math.max(1, Math.min(24, plotW / total - 1));
    let li = '';
    for (let i = 0; i < n; i++) {
      const v = plays[i].li;
      if (v == null) continue;
      const h = Math.max(1, Math.min(1, v / 4) * liH);
      li += `<rect x="${f1(x(i + 1) - bw / 2)}" y="${f1(liTop + liH - h)}" width="${f1(bw)}" height="${f1(h)}" rx="${Math.min(2, bw / 2)}" class="gw-li" data-i="${i}"/>`;
    }

    // marcas (con o.marks): fichas de carreras, cambios de lanzador, jonrones y las dos jugadas que más movieron la curva
    let mk = '';
    const hrs = M && M.hr ? M.hr.filter(k => k >= 0 && k < n) : [];
    const subs = M && M.changes ? M.changes.filter(c => c && c.k >= 0 && c.k <= n) : [];
    if (M) {
      const sideOf = i => (plays[i].top ? 'a' : 'h');
      // carreras de cada media entrada (solo si hubo): arriba las del visitante, abajo las del home club
      const hv = (M.halves || []).filter(h => h && h.k >= 0 && h.k < n);
      const rowEnd = { a: -Infinity, h: -Infinity }; // en cada fila, una ficha no pisa a la anterior (letra grande)
      hv.forEach((h, j) => {
        if (!(h.runs > 0)) return;
        const k1 = j + 1 < hv.length ? hv[j + 1].k - 1 : n - 1, row = h.top ? 'a' : 'h';
        const t = String(h.runs), w = Math.max(chipH, Math.round(textW(t, fc, .62) + 8));
        const cx = Math.min(Math.max((x(h.k) + x(k1 + 1)) / 2, rowEnd[row] + w / 2 + 2), padL + plotW - w / 2);
        const cy = runY + chipH / 2 + (h.top ? 0 : rowOff);
        rowEnd[row] = cx + w / 2;
        mk += `<g class="gw-mk gw-run ${h.top ? 'a' : 'h'}" data-k="${h.k}"><rect x="${f1(cx - w / 2)}" y="${f1(cy - chipH / 2)}" width="${w}" height="${chipH}" rx="4"/>` +
          `<text x="${f1(cx)}" y="${f1(cy + fc * .36)}" text-anchor="middle">${t}</text></g>`;
      });
      // cambios de lanzador: rayita del color del equipo que cambió, arriba el visitante y abajo el home club
      subs.forEach(c => {
        const cx = f1(x(c.k)), up = c.side === 'away';
        mk += `<line class="gw-mk gw-sub ${up ? 'a' : 'h'}" data-k="${c.k}" x1="${cx}" x2="${cx}" y1="${f1(subY + (up ? 1.5 : subH / 2 + 1))}" y2="${f1(subY + (up ? subH / 2 - 1 : subH - 1.5))}"/>`;
      });
      // las dos jugadas que más movieron la curva: etiqueta hacia afuera de la línea del 50 % (al otro lado si choca)
      const big = plays.map((p, i) => [Math.abs(p.delta || 0), i]).filter(a => a[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 2).map(a => a[1]);
      const labelOf = typeof o.labelOf === 'function' ? o.labelOf
        : i => { const sn = surname(plays[i].batter && plays[i].batter.fullName), ev = evShort(plays[i].event); return sn ? `${ev} de ${sn}` : ev; };
      // Cajas que una etiqueta no puede tapar: las otras etiquetas, los puntos marcados y el % del final de la curva.
      // Tampoco puede cortar el trazo: se mira la y mínima y máxima de la curva en el tramo de la caja.
      const boxes = [];
      const overlaps = b => boxes.some(q => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
      const yAt = xv => {
        for (let j = 1; j < pts.length; j++) {
          if (pts[j][0] >= xv) { const a = pts[j - 1], c = pts[j]; return a[1] + (c[1] - a[1]) * ((xv - a[0]) / ((c[0] - a[0]) || 1)); }
        }
        return last[1];
      };
      const cuts = b => {
        const xa = Math.max(b[0], pts[0][0]), xb = Math.min(b[2], last[0]);
        if (xa > xb) return false; // a la derecha de lo jugado (en vivo): ahí no hay trazo
        let lo = Math.min(yAt(xa), yAt(xb)), hi = Math.max(yAt(xa), yAt(xb));
        for (const p of pts) if (p[0] > xa && p[0] < xb) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
        return lo <= b[3] + 2 && hi >= b[1] - 2;
      };
      [...hrs, ...big].forEach(k => { const px = x(k + 1), py = y(plays[k].after); boxes.push([px - 5, py - 5, px + 5, py + 5]); });
      {
        // el % del final (cuando no hay cursor), donde lo pone paintCur
        const ev = n ? plays[n - 1].after : 50, t = Math.round(ev < 50 ? 100 - ev : ev) + '%', ew = textW(t, fsm, .62);
        const out = last[0] + 8 + ew <= W - 2, yb = out ? clamp(last[1] + 4, padT + 10, padT + plotH - 2) : last[1] < mid ? last[1] + fsm + 6 : last[1] - 8;
        boxes.push(out ? [last[0] + 6, yb - fsm, last[0] + 10 + ew, yb + 3] : [last[0] - 6 - ew, yb - fsm, last[0] - 2, yb + 3]);
      }
      // Lugar para un texto junto a su punto: del lado preferido (hacia afuera de la línea del 50 %) y del otro, cerca y
      // el doble de lejos; centrado sobre el punto, corrido para caber, o a un lado. Nunca se sale del área de la curva.
      // Si nada sirve, null: queda solo el punto.
      const spot = (px, py, w, h, prefer, gap) => {
        for (const f of [1, 2]) for (const d of [prefer, -prefer]) {
          const cy = py + d * gap * f;
          if (cy - h / 2 < padT || cy + h / 2 > padT + plotH) continue;
          for (const cx of [px, clamp(px, padL + w / 2, padL + plotW - w / 2), px + 6 + w / 2, px - 6 - w / 2]) {
            const b = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
            if (b[0] < padL || b[2] > padL + plotW || overlaps(b) || cuts(b)) continue;
            boxes.push(b);
            return { cx, cy, b, dir: d > 0 ? 1 : -1 };
          }
        }
        return null;
      };
      const maxCh = Math.max(4, Math.floor((plotW - 10) / (fc * .58)));
      big.forEach(i => {
        const px = x(i + 1), py = y(plays[i].after);
        let t = String(labelOf(i) || '');
        if (t.length > maxCh) t = t.slice(0, maxCh - 1) + '…'; // cortada al ancho del gráfico
        const w = textW(t, fc, .58) + 6, h = fc * 1.25, s = spot(px, py, w, h, py < mid ? -1 : 1, 22);
        let g = `<g class="gw-mk gw-big" data-k="${i}">`;
        if (s) {
          // la rayita va del punto al borde más cercano de la etiqueta
          const lx = clamp(px, s.b[0], s.b[2]), ly = clamp(py, s.b[1], s.b[3]);
          g += `<line class="gw-ann-l" x1="${f1(px)}" x2="${f1(lx)}" y1="${f1(py + s.dir * 4)}" y2="${f1(ly)}"/>` +
            `<text class="gw-ann" x="${f1(s.cx)}" y="${f1(s.cy + fc * .36)}" text-anchor="middle">${esc(t)}</text>`;
        }
        mk += g + `<circle class="gw-dot ${sideOf(i)}" cx="${f1(px)}" cy="${f1(py)}" r="3.5"/></g>`;
      });
      // jonrones: "HR" del lado hacia donde movió la curva (si ya tiene etiqueta grande, o no cabe, solo el punto)
      hrs.forEach(k => {
        const px = x(k + 1), py = y(plays[k].after);
        let g = `<g class="gw-mk gw-hr" data-k="${k}"><circle class="gw-dot ${sideOf(k)}" cx="${f1(px)}" cy="${f1(py)}" r="3.5"/>`;
        const s = big.indexOf(k) < 0 ? spot(px, py, textW('HR', fc, .72) + 4, fc * 1.05, plays[k].top ? -1 : 1, 11) : null;
        if (s) g += `<text class="gw-hr-t" x="${f1(s.cx)}" y="${f1(s.cy + fc * .34)}" text-anchor="middle">HR</text>`;
        mk += g + '</g>';
      });
    }

    const curve = `<path d="${area}" class="viz-area away" clip-path="url(#${id}a)"/><path d="${area}" class="viz-area home" clip-path="url(#${id}h)"/>` +
      `<path d="${line}" pathLength="1" class="gw-line a" clip-path="url(#${id}a)"/><path d="${line}" pathLength="1" class="gw-line h" clip-path="url(#${id}h)"/>`;
    const lab = (yv, t, cls) => `<text x="${padL - 6}" y="${f1(yv)}" class="${cls || 'viz-tick'}" text-anchor="end">${t}</text>`;
    // Con onPick/onRelease la curva es un deslizador para el lector de pantalla (role="slider": la jugada marcada en
    // aria-valuenow y aria-valuetext, y el resumen en aria-describedby); sin ellos, una imagen con su resumen, como antes.
    const focoSvg = !!(document.activeElement && box.contains(document.activeElement));
    const rol = pick && n ? `role="slider" aria-label="Probabilidad de ganar" aria-valuemin="1" aria-valuemax="${n}" aria-orientation="horizontal" aria-describedby="${id}d"`
      : 'role="img" aria-label="Probabilidad de ganar"';
    box.innerHTML = `
<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ${rol} tabindex="0" class="gw-svg${pick ? ' gw-pick' : ''}">
  <defs>
    <clipPath id="${id}a"><rect x="0" y="0" width="${W}" height="${f1(mid)}"/></clipPath>
    <clipPath id="${id}h"><rect x="0" y="${f1(mid)}" width="${W}" height="${f1(H - mid)}"/></clipPath>
    <clipPath id="${id}p"><rect class="gw-past" x="0" y="0" width="${W}" height="${H}"/></clipPath>
  </defs>
  <rect x="${padL}" y="${padT}" width="${f1(plotW)}" height="${plotH}" class="viz-plot"/>
  ${grid}
  <line x1="${padL}" x2="${f1(padL + plotW)}" y1="${f1(y(25))}" y2="${f1(y(25))}" class="viz-grid gw-q"/>
  <line x1="${padL}" x2="${f1(padL + plotW)}" y1="${f1(y(75))}" y2="${f1(y(75))}" class="viz-grid gw-q"/>
  <line x1="${padL}" x2="${f1(padL + plotW)}" y1="${f1(mid)}" y2="${f1(mid)}" class="viz-base"/>
  <g class="gw-ghost" visibility="hidden">${curve}${li}</g>
  <g class="gw-now" clip-path="url(#${id}p)">${curve}${li}</g>
  ${mk}
  ${lab(padT + fc * .8, esc(o.away), 'viz-lab')}${lab(y(25) + fc * .36, '75%')}${lab(mid + fc * .36, '50%')}${lab(y(75) + fc * .36, '75%')}
  ${lab(padT + plotH - 2, esc(o.home), 'viz-lab')}
  ${M ? lab(runY + (chipH + rowOff) / 2 + fc * .36, 'Carr.') : ''}${lab(liTop + liH - 4, 'LI')}${M ? lab(subY + subH / 2 + fc * .36, 'Lanz.') : ''}
  ${labels}
  <g class="gw-cur" visibility="hidden"><line class="gw-cur-l" y1="${padT - 3}" y2="${f1(bandEnd)}"/>
    <rect class="gw-pill" y="1" height="${pillH}" rx="${pillH / 2}"/><text class="gw-pill-t" y="${f1(1 + pillH / 2 + fc * .36)}" text-anchor="middle"></text></g>
  <g class="gw-end"><circle r="4" class="viz-dot"/><text class="viz-end"></text></g>
  <g class="viz-cross" visibility="hidden"><line y1="${padT}" y2="${padT + plotH}" class="viz-cross-line"/><circle r="4" class="viz-dot"/></g>
  <rect x="${padL - 6}" y="0" width="${f1(plotW + 12)}" height="${f1(bandEnd)}" fill="transparent" class="viz-hit gw-hit"/>
</svg>${pick && n ? `<p class="sr" id="${id}d"></p>` : ''}`;

    const svg = box.querySelector('svg'), desc = box.querySelector('.sr');
    // si la curva vieja tenía el foco (teclado), lo recupera la nueva
    if (focoSvg) { try { svg.focus({ preventScroll: true }); } catch (e) { svg.focus(); } }

    // ---- el cursor: tramo hecho (vivo) y tramo tenue, cruz, píldora con el inning y la pizarra, punto con el % ----
    const past = svg.querySelector('.gw-past'), ghost = svg.querySelector('.gw-ghost');
    const cur = svg.querySelector('.gw-cur'), cl = cur.querySelector('line'), pr = cur.querySelector('rect'), pt = cur.querySelector('text');
    const end = svg.querySelector('.gw-end'), ed = end.querySelector('circle'), et = end.querySelector('text');
    const bars = [];
    svg.querySelectorAll('.gw-now .gw-li').forEach(r => { bars[+r.getAttribute('data-i')] = r; });
    const marks = [...svg.querySelectorAll('.gw-mk')].map(e => [e, +e.getAttribute('data-k')]);
    let barOn = null, futFrom = null;
    const favOf = v => (v < 50 ? [o.away, Math.round(100 - v), 'away'] : [o.home, Math.round(v), 'home']);
    // "Jugada 84 de 89, alta del 9.º, MAG 14 ORI 6, MAG 100 %"
    const momento = k => {
      const p = plays[k], f = favOf(p.after);
      return `Jugada ${k + 1} de ${n}, ${p.top ? 'alta' : 'baja'} del ${p.inning}.º` +
        `${p.away != null && p.home != null ? `, ${o.away} ${p.away} ${o.home} ${p.home}` : ''}, ${f[0]} ${f[1]} %`;
    };
    // el resumen: lo de todo el gráfico (va en aria-label si es imagen, en aria-describedby si es deslizador)
    const resumen = () => {
      let s = 'Probabilidad de ganar jugada por jugada';
      if (!n) return s + ': todavía sin jugadas';
      const f = favOf(plays[n - 1].after);
      s += `: ${f[0]} ${f[1]} % al final de lo mostrado`;
      if (M) s += `. ${plural(hrs.length, 'jonrón', 'jonrones')}, ${plural(subs.length, 'cambio de lanzador', 'cambios de lanzador')}`;
      if (pick) s += '. Flechas, Inicio, Fin y Re Pág o Av Pág para moverse por las jugadas';
      return s;
    };
    if (desc) desc.textContent = resumen();
    const aria = () => {
      if (pick || !n || S.cur == null) return resumen();
      return `Probabilidad de ganar jugada por jugada. ${momento(S.cur)}`;
    };
    const paintCur = () => {
      const i = S.cur;
      const k = i == null ? n - 1 : i;
      if (k >= 0) {
        // el punto del momento: en el cursor o, sin cursor, al final con el % del que va arriba (afuera si cabe; si
        // no, adentro, del lado contrario al borde)
        const p = plays[k], px = x(k + 1), py = y(p.after), f = favOf(p.after);
        ed.setAttribute('cx', f1(px)); ed.setAttribute('cy', f1(py)); ed.setAttribute('class', 'viz-dot ' + f[2]);
        const t = i == null ? f[1] + '%' : '', out = px + 8 + textW(t, fsm, .62) <= W - 2;
        et.setAttribute('text-anchor', out ? 'start' : 'end');
        et.setAttribute('x', f1(out ? px + 8 : px - 4));
        et.setAttribute('y', f1(out ? clamp(py + 4, padT + 10, padT + plotH - 2) : py < mid ? py + fsm + 6 : py - 8));
        et.textContent = t;
        end.removeAttribute('visibility');
      } else end.setAttribute('visibility', 'hidden');
      if (i == null) {
        past.setAttribute('width', W);
        ghost.setAttribute('visibility', 'hidden');
        cur.setAttribute('visibility', 'hidden');
      } else {
        // la píldora de arriba dice el momento: alta o baja, inning, pizarra y el % del que va arriba
        const p = plays[i], px = x(i + 1), f = favOf(p.after);
        past.setAttribute('width', f1(px + bw / 2 + .5));
        ghost.removeAttribute('visibility');
        cl.setAttribute('x1', f1(px)); cl.setAttribute('x2', f1(px));
        const t = `${p.top ? '▲' : '▼'} ${p.inning}.º${p.away != null && p.home != null ? ` · ${p.away}-${p.home}` : ''} · ${f[0]} ${f[1]}%`;
        const w = Math.round(textW(t, fc, .6) + 16), lx = clamp(px, w / 2 + 1, W - w / 2 - 1);
        pt.textContent = t;
        pt.setAttribute('x', f1(lx));
        pr.setAttribute('x', f1(lx - w / 2)); pr.setAttribute('width', w);
        cur.removeAttribute('visibility');
      }
      // presión del turno marcado, y lo que viene después del cursor, tenue
      const b = i == null ? null : bars[i] || null;
      if (b !== barOn) { if (barOn) barOn.classList.remove('on'); if (b) b.classList.add('on'); barOn = b; }
      if (futFrom !== i) { marks.forEach(([e, k2]) => e.classList.toggle('gw-fut', i != null && k2 > i)); futFrom = i; }
      if (pick && n) {
        // deslizador: la jugada marcada (sin cursor, la última)
        svg.setAttribute('aria-valuenow', String(k + 1));
        svg.setAttribute('aria-valuetext', momento(k));
      } else svg.setAttribute('aria-label', aria());
    };
    paintCur();
    K.impl.setCursor = i => { S.cur = norm(i); paintCur(); };

    const hit = svg.querySelector('.gw-hit');
    const idxAt = (cx, r) => clamp(Math.round(((((cx - r.left) * (W / (r.width || W))) - padL) / plotW) * total) - 1, 0, Math.max(0, n - 1));
    if (pick && n) {
      // Arrastrar: el dedo mueve el cursor y avisa con onPick una vez por cuadro (la medida del SVG se lee una sola vez
      // en ese cuadro, antes de escribir). Con el dedo, primero se ve si el gesto es de lado (arrastre) o hacia arriba
      // o abajo (el navegador desplaza la página y el cursor no se mueve); un toque sin arrastre también vale.
      let drag = null, want = null, rid = 0;
      const frame = () => {
        rid = 0;
        if (want == null) return;
        const i = idxAt(want, svg.getBoundingClientRect());
        want = null;
        if (i !== S.cur) { S.cur = i; paintCur(); if (o.onPick) o.onPick(i); }
      };
      const queue = cx => { want = cx; if (!rid) rid = raf(frame); };
      const flush = () => { if (rid) { caf(rid); rid = 0; } frame(); };
      K.offs.push(() => { if (rid) caf(rid); });
      const grab = ev => { try { hit.setPointerCapture(ev.pointerId); } catch (e) { /* sin captura */ } svg.classList.add('gw-drag'); };
      const finish = () => {
        flush();
        drag = null;
        svg.classList.remove('gw-drag');
        if (o.onRelease && S.cur != null) o.onRelease(S.cur);
      };
      K.on(hit, 'pointerdown', ev => {
        if (ev.button > 0) return;
        drag = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, on: ev.pointerType !== 'touch' };
        if (drag.on) { grab(ev); queue(ev.clientX); }
      });
      K.on(hit, 'pointermove', ev => {
        if (!drag || ev.pointerId !== drag.id) return;
        if (!drag.on) {
          const dx = ev.clientX - drag.x0, dy = ev.clientY - drag.y0;
          if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
          drag.on = true;
          grab(ev);
        }
        queue(ev.clientX);
      });
      K.on(hit, 'pointerup', ev => {
        if (!drag || ev.pointerId !== drag.id) return;
        if (!drag.on) queue(ev.clientX); // un toque
        finish();
      });
      K.on(hit, 'pointercancel', () => { if (drag && drag.on) finish(); else drag = null; });
      // teclado (como un deslizador): flechas de a una jugada, Re Pág y Av Pág de a 10, Inicio y Fin; mueven el cursor
      // (onPick) y al soltar la tecla, onRelease
      const STEP = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10, Home: -Infinity, End: Infinity };
      K.on(svg, 'keydown', ev => {
        if (!(ev.key in STEP)) return;
        ev.preventDefault();
        const base = S.cur == null ? n - 1 : S.cur;
        const i = clamp(isFinite(STEP[ev.key]) ? base + STEP[ev.key] : STEP[ev.key] < 0 ? 0 : n - 1, 0, n - 1);
        if (i === S.cur) return;
        S.cur = i;
        paintCur();
        if (o.onPick) o.onPick(i);
      });
      K.on(svg, 'keyup', ev => { if (ev.key in STEP && o.onRelease && S.cur != null) o.onRelease(S.cur); });
    } else if (n) {
      // Como antes: tocar o pasar el ratón muestra la jugada en un globito (hasta el cursor, si hay).
      const cross = svg.querySelector('.viz-cross');
      const xl = cross.querySelector('line'), xd = cross.querySelector('circle');
      const tip = tooltip(box);
      let probe = null, want = null, rid = 0;
      const shown = () => (S.cur == null ? n : S.cur + 1);
      const show = i => {
        if (i == null || i < 0 || i >= shown()) { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; probe = null; return; }
        probe = i;
        const p = plays[i], px = x(i + 1), py = y(p.after);
        xl.setAttribute('x1', px); xl.setAttribute('x2', px);
        xd.setAttribute('cx', px); xd.setAttribute('cy', py);
        xd.setAttribute('class', 'viz-dot ' + (p.after < 50 ? 'away' : 'home'));
        cross.setAttribute('visibility', 'visible');
        const f = favOf(p.after), d = p.dswing;
        tip.innerHTML = `<b>${p.top ? 'Alta' : 'Baja'} del ${p.inning}.º</b> ${esc(p.desc)}` +
          `<span class="viz-tip-num">${esc(f[0])} ${f[1]}% · ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} pts para el que batea${p.li != null ? ` · LI ${p.li.toFixed(1)}` : ''}</span>`;
        placeTip(box, tip, px * (box.clientWidth / W));
      };
      const frame = () => { rid = 0; if (want == null) return; const i = idxAt(want, svg.getBoundingClientRect()); want = null; show(Math.min(shown() - 1, i)); };
      const queue = ev => { want = ev.clientX; if (!rid) rid = raf(frame); };
      K.offs.push(() => { if (rid) caf(rid); });
      K.on(hit, 'pointermove', queue);
      K.on(hit, 'pointerdown', queue);
      K.on(svg, 'pointerleave', ev => { if (ev.pointerType === 'mouse') { want = null; show(null); } });
      K.on(svg, 'keydown', ev => {
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
          ev.preventDefault();
          show(Math.max(0, Math.min(shown() - 1, (probe == null ? shown() - 1 : probe) + (ev.key === 'ArrowRight' ? 1 : -1))));
        } else if (ev.key === 'Escape') show(null);
      });
      K.on(svg, 'blur', () => show(null));
    }

    // al abrir, la curva se dibuja de izquierda a derecha (stroke-dashoffset, la excepción que permite el contrato) y
    // lo demás aparece con opacidad; una sola vez por caja, nada con "menos movimiento"
    if (o.animate && !S.animated && !reduced()) {
      svg.classList.add('gw-in');
      const t = setTimeout(() => svg.classList.remove('gw-in'), 1200);
      K.offs.push(() => clearTimeout(t));
    }
    if (o.animate) S.animated = true;
    return K.api;
  }

  // ---------- mapa de batazos ----------
  // points: salida de C.sprayPoints. o: side ('away' | 'home' | null: filtra), away y home (siglas), highlight (k: aro
  //   en ese batazo), onPick(k) al tocar un punto, dimAfter (true: los batazos posteriores al marcado quedan tenues),
  //   legend (false: sin la leyenda de texto).
  // Campo genérico en la escala de la API, visto desde detrás de home: home en ≈ (125,4; 198,3), 1 unidad ≈ 2,5 pies,
  // líneas de foul a 45°, cerca a 330 pies por las líneas y 400 al center (la API no trae las medidas de cada estadio).
  // Devuelve { setHighlight(k), destroy() }; setHighlight mueve el aro sin rehacer el SVG.
  const HX = 125.42, HY = 198.27;
  function spray(box, points, o) {
    o = o || {};
    const K = ctl(box, 'spray', ['setHighlight']), S = K.st;
    box.classList.add('viz', 'gs');
    S.hl = !('given' in S) || o.highlight !== S.given ? (o.highlight == null ? null : o.highlight) : S.hl;
    S.given = o.highlight;
    S.temp = null;
    const fc = fsPx('--fs-cap');
    const W = innerW(box, 240, 320);
    const ux0 = HX - 106, ux1 = HX + 106, uy0 = HY - 184, uy1 = HY + 26;
    const s = W / (ux1 - ux0), H = Math.round((uy1 - uy0) * s);
    const X = u => (u - ux0) * s, Y = u => (u - uy0) * s;
    const pol = (r, a) => [HX + r * Math.sin(a * Math.PI / 180), HY - r * Math.cos(a * Math.PI / 180)];
    const P = q => `${f1(X(q[0]))} ${f1(Y(q[1]))}`;
    // cerca: 132 unidades (330 pies) en las esquinas y 160 (400) al center
    let fence = 'M' + P([HX, HY]);
    for (let a = -45; a <= 45; a += 3) fence += ' L' + P(pol(132 + 28 * Math.cos(2 * a * Math.PI / 180), a));
    fence += ' Z';
    const R = f1(38 * s);
    const dirt = `M${P([HX, HY])} L${P(pol(50.9, -45))} A${R} ${R} 0 0 1 ${P(pol(50.9, 45))} Z`;
    const b1 = pol(36, 45), b2 = pol(50.9, 0), b3 = pol(36, -45), mound = pol(24.2, 0);
    const bag = q => { const cx = X(q[0]), cy = Y(q[1]), h = 3.6; return `<path class="gs-bag" d="M${f1(cx)} ${f1(cy - h)} L${f1(cx + h)} ${f1(cy)} L${f1(cx)} ${f1(cy + h)} L${f1(cx - h)} ${f1(cy)} Z"/>`; };
    const hx = X(HX), hy = Y(HY), pl = pol(132, -45), pr = pol(132, 45);
    const posT = (q, t, anchor, dx) => `<text class="gs-pos" x="${f1(X(q[0]) + (dx || 0))}" y="${f1(Y(q[1]))}" text-anchor="${anchor}">${t}</text>`;

    // puntos: relleno = hit, hueco = out o error, más grande = jonrón; del color del equipo
    const vis = (points || []).filter(p => p && p.x != null && p.y != null && (!o.side || p.side === o.side));
    const sc = clamp(s / 1.5, .9, 1.3);
    const pos = vis.map(p => {
      const r = (p.hr ? 6.5 : 4.6) * sc;
      return { p, k: p.k, r, x: clamp(X(p.x), r + 1, W - r - 1), y: clamp(Y(p.y), r + 1, H - r - 1) };
    });
    const rank = p => (p.hr ? 2 : p.hit ? 1 : 0); // los huecos abajo, los jonrones encima
    const dots = pos.slice().sort((a, b) => rank(a.p) - rank(b.p) || a.k - b.k).map(q => {
      const p = q.p;
      return `<circle class="gs-p ${p.hit ? 'hit' : 'out'} ${p.side === 'away' ? 'a' : 'h'}${p.hr ? ' hr' : ''}" cx="${f1(q.x)}" cy="${f1(q.y)}" r="${f1(q.r)}" data-k="${q.k}"/>`;
    }).join('');
    const sides = o.side ? [o.side] : ['away', 'home'];
    const teamOf = sd => o[sd] || (sd === 'away' ? 'Visitante' : 'Home club');
    const legend = o.legend === false ? '' : `<p class="viz-key gs-key">${sides.map(sd => `<span><i class="gs-k hit ${sd === 'away' ? 'a' : 'h'}" aria-hidden="true"></i>${esc(teamOf(sd))}</span>`).join('')}` +
      '<span><i class="gs-k hit" aria-hidden="true"></i>relleno: hit</span><span><i class="gs-k out" aria-hidden="true"></i>hueco: out o error</span>' +
      '<span><i class="gs-k hr" aria-hidden="true"></i>más grande: jonrón</span></p>';
    // Para el lector de pantalla el mapa es una lista (role="listbox") con un batazo por opción, en el orden del juego;
    // el marcado es la opción activa (aria-activedescendant) y elegida (aria-selected). Lo dibujado va aparte, oculto.
    const id = 'gs' + (++uid), seq = pos.slice().sort((a, b) => a.k - b.k);
    const labelOf = q => { const sn = surname(q.p.batter && q.p.batter.fullName), ev = evShort(q.p.event, q.p.traj); return sn ? `${ev} de ${sn}` : ev; };
    const optOf = q => `${teamOf(q.p.side)}: ${labelOf(q)}, ${q.p.top ? 'alta' : 'baja'} del ${q.p.inning}.º`;
    // (rect y no circle, y sueltas dentro del SVG: Chrome no reconoce role="option" en un circle ni dentro de un g)
    const opts = seq.map(q => `<rect class="gs-o" id="${id}o${q.k}" role="option" aria-selected="false" aria-label="${esc(optOf(q))}" x="${f1(q.x - q.r)}" y="${f1(q.y - q.r)}" width="${f1(2 * q.r)}" height="${f1(2 * q.r)}"/>`).join('');
    const focoSvg = !!(document.activeElement && box.contains(document.activeElement));
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="listbox" tabindex="0" class="gs-svg" aria-label="Mapa de batazos">
  <g aria-hidden="true">
  <path class="gs-fld" d="${fence}"/><path class="gs-dirt" d="${dirt}"/>
  <line class="gs-foul" x1="${f1(hx)}" y1="${f1(hy)}" x2="${f1(X(pl[0]))}" y2="${f1(Y(pl[1]))}"/><line class="gs-foul" x1="${f1(hx)}" y1="${f1(hy)}" x2="${f1(X(pr[0]))}" y2="${f1(Y(pr[1]))}"/>
  <path class="gs-dia" d="M${P([HX, HY])} L${P(b1)} L${P(b2)} L${P(b3)} Z"/><circle class="gs-bag" cx="${f1(X(mound[0]))}" cy="${f1(Y(mound[1]))}" r="${f1(Math.max(2.5, 2.4 * s))}"/>
  ${bag(b1)}${bag(b2)}${bag(b3)}<path class="gs-bag" d="M${f1(hx - 3.4)} ${f1(hy - 3)} h6.8 v3 l-3.4 3.4 l-3.4 -3.4 z"/>
  ${posT(pol(146, -45), 'LF', 'start', 6)}${posT(pol(170, 0), 'CF', 'middle')}${posT(pol(146, 45), 'RF', 'end', -6)}
  <g class="gs-dots">${dots}</g>
  <g class="gs-hl" visibility="hidden"><circle class="gs-ring"/><rect class="gs-lab-bg" rx="5"/><text class="gs-lab"></text></g>
  </g>
  ${opts}
</svg>${legend}`;

    const svg = box.querySelector('svg');
    if (focoSvg) { try { svg.focus({ preventScroll: true }); } catch (e) { svg.focus(); } }
    const els = new Map(), optEl = new Map();
    svg.querySelectorAll('.gs-p').forEach(c => els.set(+c.getAttribute('data-k'), c));
    svg.querySelectorAll('.gs-o').forEach(c => optEl.set(+c.id.slice(id.length + 1), c));
    const byK = new Map(pos.map(q => [q.k, q]));
    const hl = svg.querySelector('.gs-hl'), ring = hl.querySelector('circle'), lbg = hl.querySelector('rect'), lt = hl.querySelector('text');
    const paintHL = k => {
      const q = k == null ? null : byK.get(k);
      if (!q) { hl.setAttribute('visibility', 'hidden'); return; }
      ring.setAttribute('cx', f1(q.x)); ring.setAttribute('cy', f1(q.y)); ring.setAttribute('r', f1(q.r + 5));
      const t = labelOf(q), tw = textW(t, fc, .58) + 12, th = Math.round(fc * 1.7);
      const lx = clamp(q.x < W / 2 ? q.x + q.r + 9 : q.x - q.r - 9 - tw, 2, W - tw - 2);
      const ly = clamp(q.y - th / 2, 2, H - th - 2);
      lbg.setAttribute('x', f1(lx)); lbg.setAttribute('y', f1(ly)); lbg.setAttribute('width', f1(tw)); lbg.setAttribute('height', th);
      lt.setAttribute('x', f1(lx + 6)); lt.setAttribute('y', f1(ly + th / 2 + fc * .36));
      lt.textContent = t;
      hl.removeAttribute('visibility');
    };
    const parts = sides.map(sd => {
      const a = vis.filter(p => p.side === sd), h = a.filter(p => p.hit).length, hr = a.filter(p => p.hr).length;
      return `${teamOf(sd)}, ${plural(a.length, 'batazo', 'batazos')}: ${plural(h, 'hit', 'hits')}${hr ? ` (${plural(hr, 'jonrón', 'jonrones')})` : ''}`;
    });
    svg.setAttribute('aria-label', `Mapa de batazos. ${parts.join('; ')}. Flechas para recorrerlos y Enter para ir a esa jugada`);
    let dimFrom, selWas = null;
    const paint = () => {
      paintHL(S.temp != null ? S.temp : S.hl);
      if (o.dimAfter && dimFrom !== S.hl) { els.forEach((el, k) => el.classList.toggle('gs-later', S.hl != null && k > S.hl)); dimFrom = S.hl; }
      // la opción marcada: elegida y activa para el lector
      const sel = S.hl == null ? null : optEl.get(S.hl) || null;
      if (sel !== selWas) {
        if (selWas) selWas.setAttribute('aria-selected', 'false');
        if (sel) { sel.setAttribute('aria-selected', 'true'); svg.setAttribute('aria-activedescendant', sel.id); } else svg.removeAttribute('aria-activedescendant');
        selWas = sel;
      }
    };
    paint();
    K.impl.setHighlight = k => { S.hl = k == null ? null : k; S.temp = null; paint(); };

    // el punto más cercano al dedo, dentro de 14 px más su radio (el área de toque mide 24 px o más)
    const near = (ev, extra) => {
      const r = svg.getBoundingClientRect(), f = W / (r.width || W);
      const ux = (ev.clientX - r.left) * f, uy = (ev.clientY - r.top) * f;
      let best = null, bd = Infinity;
      for (const q of pos) { const d = (q.x - ux) * (q.x - ux) + (q.y - uy) * (q.y - uy); if (d < bd) { bd = d; best = q; } }
      const lim = best ? extra * f + best.r : 0;
      return best && bd <= lim * lim ? best : null;
    };
    K.on(svg, 'click', ev => {
      const q = near(ev, 14);
      if (!q) return;
      S.hl = q.k; S.temp = null;
      paint();
      if (typeof o.onPick === 'function') o.onPick(q.k);
    });
    // con ratón, pasar por encima muestra el aro (una vez por cuadro)
    let hov = null, rid = 0;
    K.offs.push(() => { if (rid) caf(rid); });
    K.on(svg, 'pointermove', ev => {
      if (ev.pointerType !== 'mouse') return;
      hov = ev;
      if (!rid) rid = raf(() => {
        rid = 0;
        const q = hov && near(hov, 10);
        hov = null;
        const t = q ? q.k : null;
        svg.classList.toggle('gs-over', !!q);
        if (t !== S.temp) { S.temp = t; paintHL(t != null ? t : S.hl); }
      });
    });
    K.on(svg, 'pointerleave', () => { svg.classList.remove('gs-over'); if (S.temp != null) { S.temp = null; paintHL(S.hl); } });
    // teclado (como una lista): flechas al batazo siguiente o anterior del juego, Inicio y Fin; Enter o espacio, a la jugada
    const PASO = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -Infinity, End: Infinity };
    K.on(svg, 'keydown', ev => {
      if (!seq.length) return;
      if (ev.key in PASO) {
        ev.preventDefault();
        const d = PASO[ev.key], j0 = seq.findIndex(q => q.k === S.hl);
        const j = !isFinite(d) ? (d < 0 ? 0 : seq.length - 1) : j0 < 0 ? (d > 0 ? 0 : seq.length - 1) : clamp(j0 + d, 0, seq.length - 1);
        S.hl = seq[j].k; S.temp = null;
        paint();
      } else if ((ev.key === 'Enter' || ev.key === ' ') && S.hl != null && byK.has(S.hl)) {
        ev.preventDefault();
        if (typeof o.onPick === 'function') o.onPick(S.hl);
      }
    });
    return K.api;
  }

  // ---------- zona de strike del turno ----------
  // pitches: salida de C.pitchSeq(play). o: box (salida de C.zoneBox), batSide ('L' | 'R'), seqBox (elemento donde va la
  //   secuencia en letras; si no, debajo de la zona), count (false: la secuencia sin la cuenta al final; con ella, tope
  //   3-2), legend (false: sin la leyenda de las letras).
  // Vista desde el center, como en la TV: x crece a la derecha e y hacia abajo; el derecho queda a la derecha de la
  // imagen (comprobado con los pelotazos de 7 juegos). Margen de 36 unidades a los lados y 34 arriba. Ningún lanzamiento
  // tapa el carril del bateador ni el plato: lo que cae ahí o más afuera va pegado del lado de adentro, atenuado y con una
  // flechita hacia donde cayó. Número del lanzamiento y ZURDO/DERECHO a --fs-cap o más.
  // Devuelve { update(pitches, o), destroy() }: cada lanzamiento nuevo se agrega sin rehacer el SVG.
  const CALLS = {
    bola: ['B', 'Bola'], cantado: ['C', 'Strike cantado'], tirandole: ['S', 'Strike tirándole'], foul: ['F', 'Foul'],
    enjuego: ['X', 'En juego'], golpeado: ['G', 'Golpeado'], otro: ['·', 'Otro']
  };
  const CODE_CALL = {
    B: 'bola', '*B': 'bola', I: 'bola', P: 'bola', V: 'bola', VB: 'bola', C: 'cantado', K: 'cantado', S: 'tirandole', W: 'tirandole',
    T: 'tirandole', M: 'tirandole', Q: 'tirandole', O: 'tirandole', F: 'foul', L: 'foul', R: 'foul', X: 'enjuego', D: 'enjuego',
    E: 'enjuego', H: 'golpeado'
  };
  const callOf = q => (q && CALLS[q.call] ? q.call : CODE_CALL[q && q.code] || 'otro');
  const ZONE = { x0: 84, x1: 132, y0: 120, y1: 176 };
  // leyenda con la letra de cada tipo: "B bola · C cantado · S tirándole · F foul · X en juego"
  const ZKEY = '<p class="gz-key" aria-hidden="true">' + [['bola', 'bola'], ['cantado', 'cantado'], ['tirandole', 'tirándole'], ['foul', 'foul'], ['enjuego', 'en juego']]
    .map(([c, t]) => `<span><i class="gz-c ${c}"><b>${CALLS[c][0]}</b></i>${t}</span>`).join('') + '</p>';
  const cnt = q => `${Math.min(3, q.balls)}-${Math.min(2, q.strikes)}`; // la cuenta topa en 3-2 (el boleto no dice "4-2")
  function zone(box, pitches, o) {
    o = o || {};
    const K = ctl(box, 'zone', ['update']), S = K.st;
    box.classList.add('viz', 'gz');
    // lo último que llegó por update sobrevive al redibujo si se vuelven a pasar los mismos datos
    if (!('gp' in S) || pitches !== S.gp || o !== S.go) { S.ps = pitches || []; S.o = o; }
    S.gp = pitches; S.go = o;
    const W = innerW(box, 110, 160);
    // la secuencia y la leyenda van juntas: debajo de la zona o en o.seqBox (por ejemplo, a todo el ancho de la pizarra)
    const seqIn = !(o.seqBox && o.seqBox.nodeType === 1);
    const seqHTML = '<ol class="gz-seq" aria-hidden="true"></ol>' + (o.legend === false ? '' : ZKEY);
    box.innerHTML = `<div class="gz-pan"><svg class="gz-svg" role="img" focusable="false" aria-label="Zona de strike">
  <rect class="gz-bg" rx="10"/><g class="gz-bat" visibility="hidden"><rect class="gz-bat-r"/><text class="gz-bat-t" text-anchor="middle" dy=".35em"></text></g>
  <rect class="gz-box"/><path class="gz-grid"/><path class="gz-plate"/><text class="gz-vista" text-anchor="middle">vista del center</text>
  <g class="gz-ms"></g><circle class="gz-last" visibility="hidden"/>
</svg>${seqIn ? seqHTML : ''}</div>`;
    if (!seqIn) o.seqBox.innerHTML = seqHTML;
    const svg = box.querySelector('svg'), ms = svg.querySelector('.gz-ms'), ring = svg.querySelector('.gz-last');
    const bat = svg.querySelector('.gz-bat'), batR = bat.querySelector('rect'), batT = bat.querySelector('text');
    let seqEl = (seqIn ? box : o.seqBox).querySelector('.gz-seq');
    const fc = fsPx('--fs-cap');
    let G = null;
    const zb = () => {
      const b = S.o && S.o.box;
      return b && b.x1 > b.x0 && b.y1 > b.y0 ? b : ZONE;
    };
    // geometría: depende del ancho y de la caja; cambia los atributos de lo que ya está
    const layout = () => {
      const Z = zb(), vx0 = Z.x0 - 36, vx1 = Z.x1 + 36, vy0 = Z.y0 - 34, vy1 = Z.y1 + 46;
      const s = W / (vx1 - vx0), H = Math.round((vy1 - vy0) * s);
      // el número del lanzamiento a --fs-cap o más; el radio de la marca sale de esa letra
      const r0 = clamp(s * 6.4, 8.5, 13), fn = Math.max(fc, r0 * 1.2), r = Math.max(r0, fn * .78);
      G = { Z, s, H, r, X: u => (u - vx0) * s, Y: u => (u - vy0) * s, key: [W, Z.x0, Z.x1, Z.y0, Z.y1, !!Z.inPlayUnreliable].join() };
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('width', W); svg.setAttribute('height', H);
      svg.style.setProperty('--gz-n', f1(fn) + 'px');
      const bg = svg.querySelector('.gz-bg');
      bg.setAttribute('x', .5); bg.setAttribute('y', .5); bg.setAttribute('width', W - 1); bg.setAttribute('height', H - 1);
      const zx0 = G.X(Z.x0), zx1 = G.X(Z.x1), zy0 = G.Y(Z.y0), zy1 = G.Y(Z.y1);
      const zr = svg.querySelector('.gz-box');
      zr.setAttribute('x', f1(zx0)); zr.setAttribute('y', f1(zy0)); zr.setAttribute('width', f1(zx1 - zx0)); zr.setAttribute('height', f1(zy1 - zy0));
      let g = '';
      for (let j = 1; j < 3; j++) {
        const gx = zx0 + (zx1 - zx0) * j / 3, gy = zy0 + (zy1 - zy0) * j / 3;
        g += `M${f1(gx)} ${f1(zy0)}V${f1(zy1)}M${f1(zx0)} ${f1(gy)}H${f1(zx1)}`;
      }
      svg.querySelector('.gz-grid').setAttribute('d', g);
      // el plato, visto desde el center: el lado plano hacia el lanzador y la punta hacia el receptor. Debajo, en lo que
      // ya medía la zona, "vista del center" a --fs-cap, solo si cabe entera a lo ancho y a lo alto. El ancho se mide al
      // cambiar la geometría (y otra vez cuando llegan las fuentes); sin medida, se estima con holgura. Con la letra
      // grande no cabe y queda solo en el texto para el lector
      const cx = (zx0 + zx1) / 2, pw = (zx1 - zx0) * .32, py = G.Y(Z.y1 + 16), u = s * 3.6;
      svg.querySelector('.gz-plate').setAttribute('d', `M${f1(cx - pw)} ${f1(py)}H${f1(cx + pw)}V${f1(py + u)}L${f1(cx)} ${f1(py + u * 2)}L${f1(cx - pw)} ${f1(py + u)}Z`);
      G.plateTop = py;
      const vista = svg.querySelector('.gz-vista'), libre = H - (py + u * 2);
      let vw = 0;
      try { vw = vista.getComputedTextLength(); } catch (e) { /* sin dibujar */ }
      const cabe = (vw || textW('vista del center', fc, .5)) + 8 <= W && libre >= fc * 1.3 + 4;
      vista.setAttribute('x', f1(W / 2)); vista.setAttribute('y', f1(H - Math.max(3, fc * .28)));
      vista.setAttribute('visibility', cabe ? 'visible' : 'hidden');
      // el largo de los dos rótulos del carril, medido con la misma letra (paintBat pone el que toca)
      const mide = t => { batT.textContent = t; let w = 0; try { w = batT.getComputedTextLength(); } catch (e) { /* sin dibujar */ } return w || textW(t, fc, .86); };
      G.batW = { L: mide('ZURDO'), R: mide('DERECHO') };
      ms.textContent = '';
    };
    // el carril del bateador (el zurdo a la izquierda de la imagen, el derecho a la derecha): ancho para el rótulo a
    // --fs-cap y largo para que quepa entero, sin salirse del dibujo ni bajar al plato. Si la palabra no cabe ni así
    // (letra grande), va la inicial, Z o D, como en el duelo
    const lane = () => {
      const sd = S.o && S.o.batSide;
      if (sd !== 'L' && sd !== 'R') return null;
      const w = Math.max(12, fc + 6), x0 = sd === 'L' ? 4 : W - 4 - w, top = 2, bot = G.plateTop - 3;
      const word = (G.batW || {})[sd] || textW(sd === 'L' ? 'ZURDO' : 'DERECHO', fc, .86);
      const entero = word + 12 <= bot - top, t = entero ? (sd === 'L' ? 'ZURDO' : 'DERECHO') : sd === 'L' ? 'Z' : 'D';
      const need = (entero ? word : fc * .9) + 12;
      let y0 = G.Y(G.Z.y0 - 12), y1 = G.Y(G.Z.y1 + 12);
      if (y1 - y0 < need) { const c = (y0 + y1) / 2; y0 = c - need / 2; y1 = c + need / 2; }
      if (y0 < top) { y1 += top - y0; y0 = top; }   // si se sale por arriba, baja; si pisa el plato, sube
      if (y1 > bot) { y0 -= y1 - bot; y1 = bot; }
      return { sd, t, x0, w, y0: Math.max(top, y0), y1: Math.min(bot, y1) };
    };
    const shape = (c, r) => {
      if (c === 'enjuego') { const a = r * 1.2; return `<path class="gz-sh" d="M0 ${f1(-a)}L${f1(a)} 0L0 ${f1(a)}L${f1(-a)} 0Z"/>`; }
      if (c === 'foul' || c === 'golpeado') { const a = r * .88; return `<rect class="gz-sh" x="${f1(-a)}" y="${f1(-a)}" width="${f1(2 * a)}" height="${f1(2 * a)}" rx="${c === 'foul' ? 3 : 1.5}"/>`; }
      return `<circle class="gz-sh" r="${f1(r)}"/>` + (c === 'tirandole' ? `<circle class="gz-in" r="${f1(r - 2.8)}"/>` : '');
    };
    const paintMarks = anim => {
      const ps = S.ps || [], Z = G.Z, r = G.r;
      const list = [];
      ps.forEach((q, j) => {
        if (!q || q.x == null || q.y == null) return; // sin ubicación (bola o strike automático): solo en la secuencia
        const c = callOf(q);
        if (c === 'enjuego' && Z.inPlayUnreliable) return;
        list.push([q, j, c]);
      });
      // dónde puede ir el centro de una marca: fuera del carril del bateador y encima del plato (con el aro del último,
      // r + 4, también afuera); lo que cae más allá va pegado a ese borde con su flechita (r + 8: la flecha tampoco entra)
      const L = lane(), m0 = r + 5;
      const ax0 = (L && L.sd === 'L' ? L.x0 + L.w : 0) + m0, ax1 = (L && L.sd === 'R' ? L.x0 : W) - m0;
      const ay0 = m0, ay1 = G.plateTop - m0;
      let lastXY = null;
      list.forEach(([q, j, c], idx) => {
        let px = G.X(q.x), py = G.Y(q.y);
        const far = px < ax0 || px > ax1 || py < ay0 || py > ay1;
        let dx = 0, dy = 0;
        if (far) {
          const cx = clamp(px, ax0 + 3, ax1 - 3), cy = clamp(py, ay0 + 3, ay1 - 3), L2 = Math.hypot(px - cx, py - cy) || 1;
          dx = (px - cx) / L2; dy = (py - cy) / L2; px = cx; py = cy;
        }
        if (j === ps.length - 1) lastXY = [px, py];
        const key = `${c}|${j}|${f1(px)}|${f1(py)}|${far ? 1 : 0}`;
        const el = ms.children[idx];
        if (el && el.getAttribute('data-key') === key) return;
        const arw = far ? (() => {
          const tx = dx * (r + 6.5), ty = dy * (r + 6.5), bx = dx * (r + 1.5), by = dy * (r + 1.5), qx = -dy * 3.4, qy = dx * 3.4;
          return `<path class="gz-arw" d="M${f1(tx)} ${f1(ty)}L${f1(bx + qx)} ${f1(by + qy)}L${f1(bx - qx)} ${f1(by - qy)}Z"/>`;
        })() : '';
        const html = `<g class="gz-m ${c}${far ? ' far' : ''}" transform="translate(${f1(px)} ${f1(py)})" data-key="${key}">` +
          `<g class="gz-mi">${shape(c, r)}${arw}<text class="gz-n" y="${f1(r * .43)}" text-anchor="middle">${j + 1}</text></g></g>`;
        if (el) { el.insertAdjacentHTML('beforebegin', html); el.remove(); } else ms.insertAdjacentHTML('beforeend', html);
        if (anim) enter(ms.children[idx].firstChild, { opacity: 0, transform: 'scale(.4)' });
      });
      while (ms.children.length > list.length) ms.lastChild.remove();
      // aro en el último lanzamiento del turno
      if (lastXY) {
        ring.setAttribute('cx', f1(lastXY[0])); ring.setAttribute('cy', f1(lastXY[1])); ring.setAttribute('r', f1(r + 4));
        ring.removeAttribute('visibility');
      } else ring.setAttribute('visibility', 'hidden');
    };
    // el lado del bateador, con su rótulo
    const paintBat = () => {
      const L = lane();
      if (!L) { bat.setAttribute('visibility', 'hidden'); return; }
      const cx = L.x0 + L.w / 2, cy = (L.y0 + L.y1) / 2;
      batR.setAttribute('x', f1(L.x0)); batR.setAttribute('y', f1(L.y0)); batR.setAttribute('width', f1(L.w)); batR.setAttribute('height', f1(L.y1 - L.y0));
      batR.setAttribute('rx', f1(L.w / 2));
      // la palabra va girada a lo largo del carril; la inicial, derecha (una Z acostada se lee N)
      batT.setAttribute('x', f1(cx)); batT.setAttribute('y', f1(cy));
      if (L.t.length > 1) batT.setAttribute('transform', `rotate(-90 ${f1(cx)} ${f1(cy)})`); else batT.removeAttribute('transform');
      if (batT.textContent !== L.t) batT.textContent = L.t;
      bat.removeAttribute('visibility');
    };
    let seqWas = null;
    const paintSeq = () => {
      // si quien pinta la pizarra vació o rehízo el contenido de o.seqBox, la secuencia vuelve a su sitio
      if (!seqIn && o.seqBox.isConnected && !o.seqBox.contains(seqEl)) {
        o.seqBox.innerHTML = seqHTML;
        seqEl = o.seqBox.querySelector('.gz-seq');
        seqWas = null;
      }
      if (!seqEl) return;
      const ps = S.ps || [], lp = ps[ps.length - 1], conCuenta = !(S.o && S.o.count === false);
      const h = ps.map(q => { const c = callOf(q); return `<li class="gz-c ${c}"><b>${CALLS[c][0]}</b></li>`; }).join('') +
        (conCuenta ? `<li class="gz-cnt">${lp ? cnt(lp) : '0-0'}</li>` : '');
      if (h !== seqWas) { seqEl.innerHTML = h; seqWas = h; } // igual que antes: no se toca
    };
    const aria = () => {
      const ps = S.ps || [];
      const sd = S.o && S.o.batSide, who = sd === 'L' ? '. Batea zurdo' : sd === 'R' ? '. Batea derecho' : '';
      if (!ps.length) return 'Zona de strike, vista del center: todavía sin lanzamientos' + who;
      const w = ps.map(q => String(q.label || CALLS[callOf(q)][1]).toLowerCase()), lp = ps[ps.length - 1];
      return `Zona de strike, vista del center: ${plural(ps.length, 'lanzamiento', 'lanzamientos')} (${w.join(', ')}), cuenta ${cnt(lp)}, el último ${w[w.length - 1]}${who}`;
    };
    const paint = anim => {
      const Z = zb(), key = [W, Z.x0, Z.x1, Z.y0, Z.y1, !!Z.inPlayUnreliable].join();
      if (!G || G.key !== key) layout();
      paintBat();
      paintMarks(anim);
      paintSeq();
      svg.setAttribute('aria-label', aria());
    };
    paint(false);
    S.t = 0;
    // con la letra ya cargada, "vista del center" se vuelve a medir
    if (document.fonts && document.fonts.status !== 'loaded') {
      let alive = true;
      K.offs.push(() => { alive = false; });
      document.fonts.ready.then(() => { if (alive && svg.isConnected) { G = null; paint(false); } });
    }
    K.impl.update = (ps, o2) => {
      S.ps = ps || [];
      if (o2) S.o = Object.assign({}, S.o, o2);
      // lo nuevo entra con un saltito, salvo que lleguen seguidos (arrastre de la curva o repetición rápida)
      const now = Date.now(), anim = now - S.t > 300;
      S.t = now;
      paint(anim);
    };
    return K.api;
  }

  // ---------- el campo en tiza ----------
  // s: { defense (salida de C.defenseAt o linescore.defense), bases [b1, b2, b3] con {id, fullName} o null,
  //      batter {id, fullName}, batSide ('L' | 'R'), lastHit {x, y, traj} (coordenadas de la API) o null }
  // o: { narrow: true/false (por defecto, pantalla de menos de 26,25rem: 420 px con la letra normal) }.
  // Visto desde detrás de home, con home abajo: el derecho batea a la izquierda del plato y el zurdo a la derecha.
  // Cada corredor va afuera de su base (1.ª a la derecha, 3.ª a la izquierda, 2.ª arriba); si no cabe, primero se corta
  // el apellido y solo después la ficha sube junto a la base, siempre del lado de afuera.
  // Angosto: solo el cuadro interior con los corredores y el bateador, y debajo el botón "Ver defensa"
  // (<button aria-expanded>); abierto, el campo entero con la defensa y la caja lleva la clase gf-abierto.
  // Devuelve { update(s), destroy() }: cambia corredores, nombres y el batazo sin rehacer el SVG.
  const FB = 62, FR = 190, FD = 96;              // bases, cerca y tierra del cuadro, en unidades del dibujo
  const C45 = Math.SQRT1_2;
  const FBASES = [[FB * C45, FB * C45], [0, FB * Math.SQRT2], [-FB * C45, FB * C45]];
  const FPOS = [['pitcher', 'P', 0, 40], ['catcher', 'C', 0, -9], ['first', '1B', 68, 64], ['second', '2B', 38, 104], ['shortstop', 'SS', -38, 104],
    ['third', '3B', -68, 64], ['left', 'LF', -90, 140], ['center', 'CF', 0, 170], ['right', 'RF', 90, 140]];
  // x0, x1, abajo de home, arriba. El cuadro interior deja sitio a los lados de 1.ª y 3.ª y encima de 2.ª para las fichas
  const FVIEW = { full: [-154, 154, -34, 214], inf: [-100, 100, -16, 128] };
  const TRAJ_ES = { ground_ball: 'rolata', line_drive: 'línea', fly_ball: 'elevado', popup: 'elevadito', bunt_grounder: 'toque', bunt_popup: 'elevadito de toque', bunt_line_drive: 'línea de toque' };
  // batazo (unidades de la API) → dibujo: el cuadro a escala y de ahí a la cerca, comprimido (400 pies = la cerca)
  const hitPt = (hx, hy) => {
    const dx = 2.5 * (hx - HX), dy = 2.5 * (HY - hy), r = Math.hypot(dx, dy), a = Math.atan2(dx, dy), b2 = FB * Math.SQRT2;
    const ru = r <= 127.3 ? r * b2 / 127.3 : b2 + (r - 127.3) * (FR - b2) / (400 - 127.3);
    return [ru * Math.sin(a), ru * Math.cos(a), r];
  };
  function field(box, s, o) {
    o = o || {};
    const K = ctl(box, 'field', ['update']), S = K.st;
    box.classList.add('viz', 'gf');
    if (!('gs' in S) || s !== S.gs) S.s = s || {};
    S.gs = s;
    const narrow = o.narrow != null ? !!o.narrow : !!(root.matchMedia && root.matchMedia('(max-width: 26.24rem)').matches);
    if (!narrow) S.open = false;
    box.classList.toggle('gf-abierto', narrow && !!S.open);
    const W = innerW(box, 140, 220);
    // Letra de los tokens, nunca bajo --fs-cap. Con un tope según el ancho del campo para que en un campo chico con la
    // letra grande del teléfono los nombres no lo tapen (el mismo cálculo va en el CSS con min() y max()). Angosto, las
    // fichas a --fs-cap.
    const cs = W / 11, cd = W / 15, fcap = fsPx('--fs-cap'), fsm0 = fsPx('--fs-sm');
    const fsm = narrow ? fcap : Math.max(fcap, Math.min(fsm0, cs)), fsd = Math.max(fcap, Math.min(fsm0, cd)), fc = fcap;
    const id = 'gf' + (++uid);
    // si el botón tenía el foco (con el teclado), lo recupera el botón nuevo
    const focoBtn = !!(document.activeElement && box.contains(document.activeElement) && document.activeElement.classList.contains('gf-btn'));
    box.innerHTML = `<div class="gf-pan"><svg class="gf-svg${narrow ? ' gf-angosto' : ''}" id="${id}" role="img" focusable="false" aria-label="Campo"
  style="--gf-cs:${f1(cs)}px;--gf-cd:${f1(cd)}px">
  <path class="gf-of"/><path class="gf-in"/><path class="gf-dia"/><circle class="gf-mound"/>
  <g class="gf-hit" visibility="hidden"><path class="gf-hit-l"/><circle class="gf-hit-d"/><text class="gf-hit-t" text-anchor="middle"></text></g>
  <g class="gf-defs">${FPOS.map(p => `<g class="gf-pos" visibility="hidden"><circle class="gf-dot" r="2.6"/><text class="gf-def" text-anchor="middle"></text></g>`).join('')}</g>
  <path class="gf-base" data-base="1"/><path class="gf-base" data-base="2"/><path class="gf-base" data-base="3"/><path class="gf-home"/>
  ${[0, 1, 2].map(() => '<g class="gf-run" visibility="hidden"><rect/><text text-anchor="middle"></text></g>').join('')}
  <g class="gf-bat" visibility="hidden"><rect rx="4"/><text text-anchor="middle"></text></g>
</svg><p class="gf-lista" aria-hidden="true" hidden></p>${narrow ? `<button type="button" class="gf-btn" aria-controls="${id}" aria-expanded="false">Ver defensa</button>` : ''}</div>`;
    const svg = box.querySelector('svg'), btn = box.querySelector('.gf-btn'), lis = box.querySelector('.gf-lista');
    const q1 = c => svg.querySelector(c), qa = c => [...svg.querySelectorAll(c)];
    const of = q1('.gf-of'), inf = q1('.gf-in'), dia = q1('.gf-dia'), mound = q1('.gf-mound'), home = q1('.gf-home');
    const bases = qa('.gf-base'), runs = qa('.gf-run'), defs = qa('.gf-pos'), batG = q1('.gf-bat');
    if (btn && focoBtn) { try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); } }
    const hitG = q1('.gf-hit'), hitL = hitG.querySelector('path'), hitD = hitG.querySelector('circle'), hitT = hitG.querySelector('text');
    // ancho medio de una letra de cada estilo (se mide una vez al dibujar y otra cuando terminan de llegar las fuentes)
    const em = { run: .6, def: .56 };
    const measure = () => {
      const probe = (cls, t, px) => {
        const g = document.createElementNS(NS, 'g');
        g.setAttribute('class', cls);
        g.innerHTML = `<text>${t}</text>`;
        svg.appendChild(g);
        let w = 0;
        try { w = g.firstChild.getComputedTextLength(); } catch (e) { /* sin dibujar */ }
        g.remove();
        return w > 0 ? w / t.length / px : 0;
      };
      em.run = probe('gf-run', 'HERNANDEZ', fsm) || em.run;
      em.def = probe('gf-pos', 'Rodriguez', fsd) || em.def;
    };
    measure();
    let lastAnim = 0;
    const paint = anim => {
      const st = S.s || {}, open = narrow && !!S.open, showDef = !narrow || open;
      const V = narrow && !open ? FVIEW.inf : FVIEW.full;
      const sc = W / (V[1] - V[0]), H = Math.round((V[3] - V[2]) * sc);
      const X = u => (u - V[0]) * sc, Y = v => (V[3] - v) * sc;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('width', W); svg.setAttribute('height', H);
      // el campo: jardín hasta la cerca, tierra del cuadro, diamante, montículo y home
      const pole = sgn => [X(sgn * FR * C45), Y(FR * C45)], hx = X(0), hy = Y(0);
      of.setAttribute('d', `M${f1(hx)} ${f1(hy)}L${f1(pole(-1)[0])} ${f1(pole(-1)[1])}A${f1(FR * sc)} ${f1(FR * sc)} 0 0 1 ${f1(pole(1)[0])} ${f1(pole(1)[1])}Z`);
      inf.setAttribute('d', `M${f1(hx)} ${f1(hy)}L${f1(X(-FD * C45))} ${f1(Y(FD * C45))}A${f1(FD * sc)} ${f1(FD * sc)} 0 0 1 ${f1(X(FD * C45))} ${f1(Y(FD * C45))}Z`);
      dia.setAttribute('d', `M${f1(hx)} ${f1(hy)}` + FBASES.map(b => `L${f1(X(b[0]))} ${f1(Y(b[1]))}`).join('') + 'Z');
      mound.setAttribute('cx', f1(hx)); mound.setAttribute('cy', f1(Y(40))); mound.setAttribute('r', f1(Math.max(3, 4.5 * sc)));
      const bh = clamp(5.5 * sc, 5, 8);
      home.setAttribute('d', `M${f1(hx - bh)} ${f1(hy - bh * .9)}h${f1(bh * 2)}v${f1(bh * .9)}l${f1(-bh)} ${f1(bh)}l${f1(-bh)} ${f1(-bh)}z`);
      // cajas ocupadas (px): las bases y el plato primero, para que ningún nombre las tape
      const placed = [];
      const area = b => placed.reduce((a, q) => a + Math.max(0, Math.min(b[2], q[2]) - Math.max(b[0], q[0])) * Math.max(0, Math.min(b[3], q[3]) - Math.max(b[1], q[1])), 0);
      const place = (w, h, cands) => {
        let best = null, bs = Infinity;
        for (const c of cands) {
          const cx = clamp(c[0], w / 2 + 1, W - w / 2 - 1), cy = clamp(c[1], h / 2 + 1, H - h / 2 - 1);
          const b = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
          const sc2 = area(b) + Math.abs(cx - c[0]) + Math.abs(cy - c[1]); // lo que choca y lo que se tuvo que correr
          if (sc2 < bs) { bs = sc2; best = b; if (sc2 < 1) break; }
        }
        placed.push(best);
        return best;
      };
      const bxy = FBASES.map(b => [X(b[0]), Y(b[1])]);
      bases.forEach((el, i) => {
        const [cx, cy] = bxy[i], on = !!(st.bases && st.bases[i]);
        el.setAttribute('d', `M${f1(cx)} ${f1(cy - bh)}L${f1(cx + bh)} ${f1(cy)}L${f1(cx)} ${f1(cy + bh)}L${f1(cx - bh)} ${f1(cy)}Z`);
        el.classList.toggle('on', on);
        placed.push([cx - bh, cy - bh, cx + bh, cy + bh]);
      });
      placed.push([hx - bh, hy - bh, hx + bh, hy + bh]);
      const chipH = Math.round(fsm * 1.5), gap = 3, pad = 10, cw = fsm * em.run;
      const hits = b => placed.some(q => b[0] < q[2] - .5 && b[2] > q[0] + .5 && b[1] < q[3] - .5 && b[3] > q[1] + .5);
      const inside = b => b[0] >= 0 && b[2] <= W && b[1] >= 0 && b[3] <= H;
      // el apellido en mayúsculas que cabe en maxW px (cortado con punto, con 3 letras como mínimo) o null
      const fit = (nm, maxW) => {
        const t = nm.toUpperCase();
        if (t.length * cw + pad <= maxW) return t;
        const n = Math.floor((maxW - pad) / cw) - 1;
        return n >= 3 ? t.slice(0, n) + '.' : null;
      };
      const wOf = t => Math.round(t.length * cw + pad);
      const setChip = (g, b, t, cls) => {
        const r = g.querySelector('rect'), tx = g.querySelector('text');
        r.setAttribute('x', f1(b[0])); r.setAttribute('y', f1(b[1])); r.setAttribute('width', f1(b[2] - b[0])); r.setAttribute('height', chipH);
        if (cls !== 'bat') r.setAttribute('rx', f1(chipH / 2));
        tx.setAttribute('x', f1((b[0] + b[2]) / 2)); tx.setAttribute('y', f1(b[1] + chipH / 2 + fsm * .36));
        const was = g.getAttribute('visibility') === 'hidden' || tx.textContent !== t;
        tx.textContent = t;
        g.removeAttribute('visibility');
        if (placed.indexOf(b) < 0) placed.push(b);
        return was;
      };
      // Corredores en amarillo, afuera de su base y separados 3 px: 1.ª a la derecha y 3.ª a la izquierda, a su altura (si
      // el apellido no cabe ni cortado, arriba de la base desde su centro hacia afuera, o abajo); 2.ª arriba. Si alguno no
      // tiene sitio sin tapar algo (campo chico con letra grande), los nombres van en una línea bajo el campo y las bases
      // quedan prendidas.
      const plan = [], antes = placed.length;
      let enLista = false;
      [0, 2, 1].forEach(i => {
        const r = st.bases && st.bases[i], nm = r && surname(r.fullName);
        if (!nm || enLista) return;
        const [cx, cy] = bxy[i], h = chipH, cands = [], up = cy - bh - gap - h;
        if (i === 1) {
          const t = fit(nm, W - 2);
          if (t) { const w = wOf(t), x0 = clamp(cx - w / 2, 1, W - 1 - w); cands.push([t, [x0, up, x0 + w, up + h]]); }
        } else {
          const out = i === 0 ? 1 : -1, xe = cx + out * (bh + gap);  // borde de adentro de la ficha, junto a la base
          const t1 = fit(nm, out > 0 ? W - 1 - xe : xe - 1);
          if (t1) { const w = wOf(t1); cands.push([t1, out > 0 ? [xe, cy - h / 2, xe + w, cy + h / 2] : [xe - w, cy - h / 2, xe, cy + h / 2]]); }
          const t2 = fit(nm, out > 0 ? W - 1 - cx : cx - 1);
          if (t2) { const w2 = wOf(t2), xa = out > 0 ? cx : cx - w2; cands.push([t2, [xa, up, xa + w2, up + h]], [t2, [xa, cy + bh + gap, xa + w2, cy + bh + gap + h]]); }
        }
        const c = cands.find(k => inside(k[1]) && !hits(k[1]));
        if (!c) { enLista = true; return; }
        placed.push(c[1]);
        plan.push([i, c]);
      });
      if (enLista) placed.length = antes;
      runs.forEach((g, i) => {
        const p = !enLista && plan.find(q => q[0] === i);
        if (!p) { g.setAttribute('visibility', 'hidden'); return; }
        if (setChip(g, p[1][1], p[1][0]) && anim) enter(g, { opacity: 0 });
      });
      // Los corredores que no caben como fichas van en UNA línea bajo el campo ("1.ª NÚÑEZ · 3.ª ODOR"): si no cabe a lo
      // ancho, los apellidos se cortan con punto como en las fichas (3 letras como mínimo) y, si aun así no, el CSS la
      // termina con "…". Nunca suma más de una línea a la pizarra.
      const items = enLista ? [0, 1, 2].filter(i => st.bases && st.bases[i]).map(i => [['1.ª', '2.ª', '3.ª'][i], surname(st.bases[i].fullName).toUpperCase() || '—']) : [];
      let lt = items.map(it => it.join(' ')).join(' · ');
      if (items.length && lt.length * cw > W - 2) {
        const fijo = items.reduce((a, it) => a + it[0].length + 1, 0) + (items.length - 1) * 3; // "1.ª " y " · "
        const cada = Math.floor(((W - 2) / cw - fijo) / items.length);
        lt = items.map(it => `${it[0]} ${it[1].length <= cada ? it[1] : it[1].slice(0, Math.max(3, cada - 1)) + '.'}`).join(' · ');
      }
      if (lis.textContent !== lt) lis.textContent = lt;
      lis.hidden = !lt;
      // bateador en su caja: el derecho a la izquierda del plato (visto desde detrás de home), el zurdo a la derecha; a la
      // altura del plato o, si con la letra grande la ficha se sale por abajo, subida lo justo para quedar dentro
      const bt = st.batter && surname(st.batter.fullName);
      if (bt) {
        const left = st.batSide !== 'L', xe = hx + (left ? -1 : 1) * (bh + 6);
        const t = fit(bt, left ? xe - 1 : W - 1 - xe) || bt.toUpperCase().slice(0, 3) + '.', w = wOf(t), x0 = left ? xe - w : xe;
        const yc = Math.max(1, Math.min(hy - chipH / 2, H - 1 - chipH));
        const cands = [[x0, yc, x0 + w, yc + chipH], [x0, hy + bh + 2, x0 + w, hy + bh + 2 + chipH]];
        setChip(batG, cands.find(b => inside(b) && !hits(b)) || cands[0], t, 'bat');
      } else batG.setAttribute('visibility', 'hidden');
      // el último batazo: curva para los elevados, recta para las rolatas y las líneas
      const lh = st.lastHit;
      if (lh && lh.x != null && lh.y != null) {
        const [ux, uy, ft] = hitPt(+lh.x, +lh.y), x1 = X(ux), y1 = Y(uy), dx = x1 - hx, dy = y1 - hy;
        const tr = String(lh.traj || ''), fly = /fly_ball|popup/.test(tr), grd = /ground|bunt_grounder/.test(tr);
        let d = `M${f1(hx)} ${f1(hy - bh)}`;
        if (fly) {
          const k = .2, nx = dx >= 0 ? dy : -dy, ny = dx >= 0 ? -dx : dx; // se abomba hacia el center
          d += `Q${f1((hx + x1) / 2 + nx * k)} ${f1((hy + y1) / 2 + ny * k)} ${f1(x1)} ${f1(y1)}`;
        } else d += `L${f1(x1)} ${f1(y1)}`;
        const key = d;
        hitL.setAttribute('d', d);
        hitL.setAttribute('class', 'gf-hit-l ' + (fly ? 'fly' : grd ? 'ground' : 'line'));
        hitD.setAttribute('cx', f1(x1)); hitD.setAttribute('cy', f1(y1)); hitD.setAttribute('r', f1(clamp(3.5 * sc, 3.5, 6)));
        // la distancia, junto a donde cayó, solo si cabe sin tapar nada (si cayó fuera de lo que se ve, la trayectoria sola)
        let dist = '';
        if (!grd && ft >= 60 && x1 >= 0 && x1 <= W && y1 >= 0 && y1 <= H) {
          const t = `≈${Math.round(ft / 10) * 10} pies`, w = textW(t, fc, .56), h = fc * 1.3;
          const b = [[x1 + (dx >= 0 ? -1 : 1) * (w / 2 + 9), y1 - h * .6], [x1, y1 - h - 4], [x1, y1 + h + 4], [x1 + (dx >= 0 ? 1 : -1) * (w / 2 + 9), y1]]
            .map(c => [c[0] - w / 2, c[1] - h / 2, c[0] + w / 2, c[1] + h / 2]).find(q => inside(q) && !hits(q));
          if (b) {
            placed.push(b);
            hitT.setAttribute('x', f1((b[0] + b[2]) / 2)); hitT.setAttribute('y', f1(b[1] + h / 2 + fc * .36));
            dist = t;
          }
        }
        hitT.textContent = dist;
        if (hitG.getAttribute('data-key') !== key) {
          hitG.setAttribute('data-key', key);
          if (anim) enter(hitG, { opacity: 0 });
        }
        hitG.removeAttribute('visibility');
      } else { hitG.setAttribute('visibility', 'hidden'); hitG.removeAttribute('data-key'); }
      // la defensa: un punto en la posición típica y el apellido debajo (o encima, o a un lado, si choca)
      const defH = Math.round(fsd * 1.25);
      FPOS.forEach((p, i) => {
        const g = defs[i], who = st.defense && st.defense[p[0]], nm = who && surname(who.fullName);
        if (!showDef || !nm) { g.setAttribute('visibility', 'hidden'); return; }
        const cx = X(p[2]), cy = Y(p[3]), w = textW(nm, fsd, em.def) + 6, dot = g.querySelector('circle'), tx = g.querySelector('text');
        const pitcher = p[0] === 'pitcher', catcher = p[0] === 'catcher';
        const b = place(w, defH, catcher ? [[cx, hy + bh + 3 + defH / 2], [cx + bh + 8 + w / 2, hy + defH]] : [
          [cx, cy + (pitcher ? 6 : 5) + defH / 2], [cx, cy - 5 - defH / 2], [cx + 6 + w / 2, cy], [cx - 6 - w / 2, cy]]);
        dot.setAttribute('cx', f1(cx)); dot.setAttribute('cy', f1(cy));
        dot.setAttribute('visibility', pitcher || catcher ? 'hidden' : 'visible');
        tx.setAttribute('x', f1((b[0] + b[2]) / 2)); tx.setAttribute('y', f1(b[1] + defH / 2 + fsd * .36));
        tx.textContent = nm;
        g.removeAttribute('visibility');
      });
      svg.setAttribute('aria-label', aria(st));
      if (btn) {
        btn.textContent = open ? 'Ocultar defensa' : 'Ver defensa';
        btn.setAttribute('aria-expanded', String(open));
      }
    };
    const aria = st => {
      const B = ['1.ª', '2.ª', '3.ª'], on = [0, 1, 2].filter(i => st.bases && st.bases[i]);
      const who = i => { const nm = surname(st.bases[i].fullName); return nm ? `${B[i]} (${nm})` : B[i]; };
      const parts = [on.length ? `${on.length > 1 ? 'corredores' : 'corredor'} en ${on.map(who).join(on.length > 2 ? ', ' : ' y ')}` : 'bases limpias'];
      if (st.batter) parts.push(`al bate ${surname(st.batter.fullName)}${st.batSide === 'L' ? ', zurdo' : st.batSide === 'R' ? ', derecho' : ''}`);
      const lh = st.lastHit;
      if (lh && lh.x != null && lh.y != null) {
        const ft = hitPt(+lh.x, +lh.y)[2];
        parts.push(`último batazo: ${TRAJ_ES[lh.traj] || 'batazo'}${ft >= 60 ? ` de unos ${Math.round(ft / 10) * 10} pies` : ''}`);
      }
      const d = FPOS.filter(p => st.defense && st.defense[p[0]]).map(p => `${p[1]} ${surname(st.defense[p[0]].fullName)}`);
      if (d.length) parts.push(`defensa: ${d.join(', ')}`);
      return `Campo: ${parts.join('; ')}`;
    };
    paint(false);
    K.impl.update = s2 => {
      S.s = s2 || {};
      const now = Date.now(), anim = now - lastAnim > 300;
      lastAnim = now;
      paint(anim);
    };
    // "Ver defensa": abre el campo entero con la defensa; la caja lleva gf-abierto (P le da todo el ancho de la pizarra)
    if (btn) {
      K.on(btn, 'click', () => {
        S.open = !S.open;
        box.classList.toggle('gf-abierto', S.open);
        paint(false);
      });
    }
    // con la letra de la pizarra ya cargada, los chips se vuelven a medir
    if (document.fonts && document.fonts.status !== 'loaded') {
      let alive = true;
      K.offs.push(() => { alive = false; });
      document.fonts.ready.then(() => { if (alive && svg.isConnected) { measure(); paint(false); } });
    }
    return K.api;
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
  // El redibujo va en el cuadro siguiente: hecho dentro del observador cambia el alto de la caja en la misma vuelta y
  // el navegador avisa "ResizeObserver loop completed with undelivered notifications".
  // Devuelve lo que devuelva el dibujo (el controlador de winProb, spray, zone y field), que sigue sirviendo después.
  function responsive(box, draw) {
    box._draw = draw;
    const r = draw();
    if (box._ro || typeof ResizeObserver === 'undefined') return r;
    let w = box.clientWidth;
    box._ro = new ResizeObserver(() => {
      if (!box.isConnected || !box._draw) { if (box._ro) { box._ro.disconnect(); box._ro = null; } return; }
      if (Math.abs(box.clientWidth - w) > 8 && !box._rq) {
        box._rq = raf(() => {
          box._rq = 0;
          if (!box.isConnected || !box._draw) return;
          w = box.clientWidth;
          box._draw();
        });
      }
    });
    box._ro.observe(box);
    return r;
  }

  root.PC = root.PC || {};
  root.PC.charts = { winProb, spray, zone, field, line, responsive, NS };
})(typeof window !== 'undefined' ? window : globalThis);
