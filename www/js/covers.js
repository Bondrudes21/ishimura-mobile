// Процедурные обложки-заглушки: уникальные для каждого рассказа и окрашенные текущей темой
import { h, hash, esc } from './util.js';
import { contentUrl } from './state.js';

function rng(seed) {
  let s = seed || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296;
}

const MOTIFS = ['planet', 'orb', 'ship', 'signal'];

export function coverSvg(item, { label } = {}) {
  const seed = hash(item.id || item.title || 'x');
  const r = rng(seed);
  const motif = item.motif || MOTIFS[seed % MOTIFS.length];
  const W = 200, H = 300;
  let art = '';

  if (motif === 'planet') {
    const cx = 60 + r() * 80, cy = 110 + r() * 40, rad = 50 + r() * 30;
    art = `
      <circle cx="${cx}" cy="${cy}" r="${rad}" fill="url(#pg${seed})"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${rad * 1.7}" ry="${rad * 0.32}" fill="none" stroke="var(--accent)" stroke-opacity=".55" transform="rotate(${-18 + r() * 36} ${cx} ${cy})"/>
      <circle cx="${cx + rad * 1.3}" cy="${cy - rad * 0.9}" r="${4 + r() * 5}" fill="var(--accent-2)" opacity=".8"/>`;
  } else if (motif === 'orb') {
    art = `
      <circle cx="100" cy="125" r="70" fill="url(#og${seed})"/>
      ${[0, 1, 2].map((i) => `<circle cx="100" cy="125" r="${82 + i * 16}" fill="none" stroke="var(--accent)" stroke-opacity="${0.35 - i * 0.1}" stroke-dasharray="${2 + i * 3} ${4 + i * 2}"/>`).join('')}`;
  } else if (motif === 'ship') {
    const y = 120 + r() * 30;
    art = `
      <path d="M20 ${y} L150 ${y - 14} L184 ${y} L150 ${y + 14} Z" fill="var(--bg-3)" stroke="var(--accent)" stroke-opacity=".7"/>
      ${Array.from({ length: 9 }, (_, i) => `<rect x="${40 + i * 12}" y="${y - 3}" width="6" height="2" fill="var(--accent)" opacity="${0.4 + r() * 0.6}"/>`).join('')}
      <path d="M20 ${y} L0 ${y - 6} L0 ${y + 6} Z" fill="var(--accent)" opacity=".8"/>
      <circle cx="160" cy="${y + 90}" r="120" fill="url(#pg${seed})" opacity=".6"/>`;
  } else {
    art = Array.from({ length: 6 }, (_, i) => {
      let d = `M10 ${80 + i * 22}`;
      for (let x = 10; x <= 190; x += 6) d += ` L${x} ${80 + i * 22 + Math.sin(x / (8 + i * 2) + r() * 6) * (4 + r() * 12)}`;
      return `<path d="${d}" fill="none" stroke="var(--accent)" stroke-opacity="${0.25 + i * 0.12}" stroke-width="1.2"/>`;
    }).join('');
  }

  const stars = Array.from({ length: 26 }, () => `<circle cx="${r() * W}" cy="${r() * 210}" r="${r() * 1.2}" fill="var(--text)" opacity="${0.2 + r() * 0.6}"/>`).join('');
  const title = esc(item.title || '');
  const fs = title.length > 14 ? 15 : title.length > 9 ? 19 : 24;

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
    <defs>
      <radialGradient id="pg${seed}" cx="35%" cy="30%"><stop offset="0" stop-color="var(--accent)" stop-opacity=".9"/><stop offset=".55" stop-color="var(--bg-3)"/><stop offset="1" stop-color="var(--bg)"/></radialGradient>
      <radialGradient id="og${seed}"><stop offset="0" stop-color="var(--accent-2)"/><stop offset=".35" stop-color="var(--accent)" stop-opacity=".8"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></radialGradient>
      <linearGradient id="bg${seed}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--bg-3)"/><stop offset="1" stop-color="var(--bg)"/></linearGradient>
      <pattern id="gr${seed}" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="var(--accent)" stroke-opacity=".07"/></pattern>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg${seed})"/>
    <rect width="${W}" height="${H}" fill="url(#gr${seed})"/>
    ${stars}${art}
    <rect x="0" y="212" width="${W}" height="88" fill="var(--bg)" opacity=".82"/>
    <line x1="14" y1="212" x2="${W - 14}" y2="212" stroke="var(--accent)" stroke-opacity=".6"/>
    <text x="14" y="232" font-family="var(--f-ui)" font-size="9" letter-spacing="2" fill="var(--accent)">${esc(label || (item.year ? `ГОД ${item.year}` : 'АРХИВ'))}</text>
    <text x="14" y="${262}" font-family="var(--f-head)" font-weight="700" font-size="${fs}" fill="var(--text)" style="text-transform:var(--head-case)">${title}</text>
    <text x="14" y="284" font-family="var(--f-ui)" font-size="8" letter-spacing="1.5" fill="var(--dim)">${esc((item.subtitle || '').toUpperCase())}</text>
    <rect x="${W - 26}" y="14" width="12" height="12" fill="none" stroke="var(--accent)" stroke-opacity=".6"/>
  </svg>`;
}

export function coverEl(item, opts = {}) {
  const el = h('div.cover');
  if (item.cover) {
    const img = h('img', { src: contentUrl(item.cover), alt: '', loading: 'lazy' });
    img.onerror = () => { img.remove(); el.insertAdjacentHTML('afterbegin', coverSvg(item, opts)); };
    el.append(img);
  } else {
    el.innerHTML = coverSvg(item, opts);
  }
  return el;
}
