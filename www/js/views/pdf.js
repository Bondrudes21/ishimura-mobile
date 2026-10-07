// Просмотр PDF: страницы отрисовываются лениво по мере прокрутки
import { h, btn, toast } from '../util.js';
import { libBook, getProgress, setProgress } from '../state.js';
import { getPdfjs } from '../bookfmt.js';
import { sfx } from '../sound.js';

export function renderPdf(root, { id }, { go }) {
  const b = libBook(id);
  if (!b) { go('library', {}, { replace: true }); return; }
  window.ark.library.update('book', id, { lastOpened: new Date().toISOString() });
  const key = `lib:${id}`;

  let pdf = null, task = null, scale = 1, fit = true, pages = [], current = 1;
  const pageNo = h('input.input.pdf-page', { value: '1' });
  const total = h('span');
  const zoomLbl = h('span.pdf-zoom');
  const scroller = h('div.pdf-scroll');
  const bar = h('div.reader-bar', {},
    btn('', () => { sfx('close'); go('library'); }, { ico: 'back', cls: 'ghost', title: 'Назад (Esc)' }),
    h('div.title', {}, h('b', {}, b.title), h('span', {}, (b.authors || []).join(', ') || 'PDF')),
    h('div.pdf-nav', {}, btn('', () => jump(current - 1), { ico: 'left', cls: 'ghost' }), pageNo, total, btn('', () => jump(current + 1), { ico: 'right', cls: 'ghost' })),
    btn('', () => zoom(1 / 1.15), { ico: 'zoomOut', cls: 'ghost', title: 'Отдалить' }), zoomLbl,
    btn('', () => zoom(1.15), { ico: 'zoomIn', cls: 'ghost', title: 'Приблизить' }),
    btn('По ширине', () => { fit = true; layout(); }, { cls: 'ghost' }),
    btn('', () => window.ark.win.fullscreen(), { ico: 'fullscreen', cls: 'ghost', title: 'Полный экран' }));
  const reader = h('div.reader.pdf-reader', {}, bar, scroller);
  root.append(reader);

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) renderPage(Number(e.target.dataset.n));
  }, { root: scroller, rootMargin: '600px 0px' });

  async function renderPage(n) {
    const pg = pages[n - 1];
    if (!pg || pg.rendered === scale) return;
    pg.rendered = scale;
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;
    const canvas = h('canvas');
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = `${vp.width}px`;
    canvas.style.height = `${vp.height}px`;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: page.getViewport({ scale: scale * dpr }), canvas }).promise;
    if (pg.rendered !== scale) return;
    pg.el.replaceChildren(canvas);
    pg.el.classList.add('ready');
  }

  function layout() {
    if (!pdf) return;
    const keep = current;
    if (fit) scale = Math.max(0.3, (scroller.clientWidth - 60) / pages[0].w);
    zoomLbl.textContent = `${Math.round(scale * 100)}%`;
    for (const pg of pages) {
      pg.el.style.width = `${pg.w * scale}px`;
      pg.el.style.height = `${pg.h * scale}px`;
      pg.rendered = 0;
      pg.el.classList.remove('ready');
    }
    for (const pg of pages) { io.unobserve(pg.el); io.observe(pg.el); }
    jump(keep, true);
  }

  function zoom(k) { fit = false; scale = Math.min(5, Math.max(0.3, scale * k)); layout(); }

  function jump(n, instant) {
    n = Math.max(1, Math.min(pages.length, n));
    const el = pages[n - 1] && pages[n - 1].el;
    if (el) scroller.scrollTo({ top: el.offsetTop - 20, behavior: instant ? 'auto' : 'smooth' });
  }

  let saveT;
  scroller.addEventListener('scroll', () => {
    const mid = scroller.scrollTop + scroller.clientHeight * 0.3;
    let n = 1;
    for (const pg of pages) { if (pg.el.offsetTop <= mid) n = Number(pg.el.dataset.n); else break; }
    if (n !== current) { current = n; pageNo.value = n; }
    clearTimeout(saveT);
    saveT = setTimeout(() => setProgress(key, { frac: pages.length > 1 ? (current - 1) / (pages.length - 1) : 1, para: current }), 400);
  }, { passive: true });
  pageNo.addEventListener('change', () => jump(Number(pageNo.value) || 1));

  const onKey = (e) => {
    if (e.target instanceof Element && e.target.matches('input')) return;
    if (e.key === 'Escape') go('library');
    if (e.key === 'ArrowRight') jump(current + 1);
    if (e.key === 'ArrowLeft') jump(current - 1);
  };
  document.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => { if (fit) layout(); });

  (async () => {
    try {
      const c = await window.ark.library.content(id);
      const lib = await getPdfjs();
      task = lib.getDocument({ url: c.url, isEvalSupported: false });
      pdf = await task.promise;
      if (!root.isConnected) return;
      total.textContent = `/ ${pdf.numPages}`;
      if (!b.pages) window.ark.library.update('book', id, { pages: pdf.numPages });
      const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
      for (let n = 1; n <= pdf.numPages; n++) {
        const el = h('div.pdf-page-box', { 'data-n': n }, h('span', {}, n));
        scroller.append(el);
        pages.push({ el, w: first.width, h: first.height, rendered: 0 });
      }
      const p = getProgress(key);
      current = p && p.para ? p.para : 1;
      layout();
      ro.observe(scroller);
    } catch (e) {
      scroller.append(h('div.empty', {}, h('h3', {}, 'Не удалось открыть PDF'), h('p', {}, e.message)));
      toast('Ошибка PDF', e.message, { error: true });
    }
  })();

  return () => {
    io.disconnect();
    ro.disconnect();
    document.removeEventListener('keydown', onKey);
    if (task) task.destroy();
  };
}
