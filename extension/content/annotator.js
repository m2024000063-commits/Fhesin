/*
 * حصن (Hisn) — الوضع الصامت (Annotator)
 * البديل 1 من البدائل الأربعة: إضافة المتصفح الصامتة لهواتف iOS وAndroid.
 * تعمل في الخلفية بمجرد تحميل الصفحة: تقرأ كل الروابط الظاهرة (نتائج البحث، الخرائط،
 * القوائم، الجداول…) وتضع بجانب كل رابط نقطة ملونة (🟢 آمن / 🟡 مشبوه / 🔴 خطر)
 * قبل أن يلمسه المستخدم — بلا شريط تنبيه وبلا أي عنصر يزاحم تصفح المستخدم.
 *
 * الفحص محلي 100% (PCS_ENGINE) — صفر طلبات شبكة من هذا الملف.
 * يتطلب: PCS_DATA + PCS_ENGINE (تُحمَّل قبله في manifest) ويُشغَّل مع content.js.
 * التمكين: settings.silentDots (افتراضياً مفعّل) — يُرسله service-worker.
 */
(async function () {
  'use strict';
  if (!self.PCS_ENGINE || !self.PCS_DATA) return;
  const ENGINE = self.PCS_ENGINE;
  const DATA = self.PCS_DATA;

  /* ================= الإعدادات ================= */
  function send(msg) {
    return new Promise(resolve => {
      try { chrome.runtime.sendMessage(msg, r => { void chrome.runtime.lastError; resolve(r); }); }
      catch (e) { resolve(null); }
    });
  }
  const settings = await send({ type: 'getSettings' }) || { silentDots: true };
  /* الوضع الصامت مفعّل افتراضياً؛ يمكن إيقافه من نافذة الإضافة */
  if (settings.silentDots === false) return;

  /* ================= أدوات ================= */

  /* فك روابط إعادة التوجيه المعروفة في نتائج البحث (جوجل/بينج) — نفس منطق content.js */
  function resolveHref(href) {
    try {
      const u = new URL(href, location.href);
      if (u.pathname === '/url' && u.searchParams.get('q')) {
        return u.searchParams.get('q');
      }
      if (u.hostname.indexOf('bing.com') !== -1 && u.pathname.indexOf('/ck/') === 0) {
        const uParam = u.searchParams.get('u') || '';
        if (uParam.indexOf('a1') === 0) {
          try {
            return atob(uParam.slice(2).replace(/-/g, '+').replace(/_/g, '/'));
          } catch (e) { return null; }
        }
      }
      if (/^https?:/i.test(u.href)) return u.href;
      return null;
    } catch (e) { return null; }
  }

  /* هل الصفحة الحالية داخل نتائج بحث أو خرائط؟ — الالتقاط السياقي للنقطة */
  function pageSource() {
    const h = location.hostname;
    for (const key of Object.keys(DATA.searchEngines)) {
      if (h === key || h.indexOf(key) !== -1) return 'search';
    }
    if (/maps?\./i.test(h) || h.indexOf('google.') !== -1 && location.pathname.indexOf('/maps') === 0) return 'maps';
    return 'direct';
  }

  /* خريطة النقاط: آمن → 🟢، مشبوه → 🟡، خطر → 🔴
     (المستخدم طلب نقطة 🟢 أو 🔴 — أضفنا الوسطية 🟡 لدقة أعلى، ويمكن إخفاؤها بإيقاف الوضع الصامت) */
  function dotFor(res) {
    const cls = res.level === 'danger' ? 'pcs-dot-danger'
      : (res.level === 'caution' ? 'pcs-dot-caution' : 'pcs-dot-safe');
    const dot = document.createElement('span');
    dot.className = 'pcs-dot ' + cls;
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', 'حصن: ' + ENGINE.levels[res.level].text);
    const reasons = res.reasons.filter(r => r.weight > 0).slice(0, 2).map(r => r.text).join(' • ');
    dot.title = 'حصن: ' + ENGINE.levels[res.level].text + ' (' + res.score + '/100)' +
      (reasons ? '\n' + reasons : '');
    return dot;
  }

  /* وسم رابط واحد — استثناء: روابط داخل عناصر وسم حصن نفسها، والروابط الداخلية الصغيرة */
  function labelAnchor(a) {
    if (a.dataset && a.dataset.pcsSilent) return;
    const href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) return;
    const target = resolveHref(href);
    if (!target) return;
    const res = ENGINE.analyze(target, { source: pageSource() });
    if (!res.scannable) return;
    a.dataset.pcsSilent = '1';
    /* النقطة تُلحق بنهاية الرابط، وموضعها داخل النص لا يفسد بنية الصفحة */
    try { a.appendChild(dotFor(res)); } catch (e) { /* عقدة مهدمة أثناء المرور */ }
  }

  /* ================= المسح السريع على تحميل الصفحة ================= */

  /* سقف الروابط لكل موجة مسح — يحمي الأداء على هواتف متوسطة (يستأنف على الموجات التالية) */
  const WAVE_MAX = 400;
  let wavePending = 0;

  function scanRoot(root) {
    const anchors = root.querySelectorAll ? root.querySelectorAll('a[href]') : [];
    let n = 0;
    for (const a of anchors) {
      if (n >= WAVE_MAX) { wavePending = 1; break; }
      if (a.closest('.pcs-dot')) continue;
      labelAnchor(a);
      n++;
    }
  }

  let debounceTimer = null;
  function scheduleScan(delay) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      scanRoot(document);
      if (wavePending) { wavePending = 0; setTimeout(() => scanRoot(document), 350); }
    }, delay || 600);
  }

  /* أول مسح: بمجرد تحميل الصفحة — قبل لمس المستخدم لأي رابط */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scheduleScan(250));
  } else {
    scheduleScan(150);
  }

  /* مراقبة المحتوى الديناميكي: نتائج بحث تُحمَّل لاحقاً، خرائط تُحدَّث، قوائم لا نهائية */
  let mo = null;
  function startObserver() {
    if (mo) return;
    mo = new MutationObserver(muts => {
      let fresh = 0;
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.closest && node.closest('.pcs-dot')) continue;
          fresh++;
        }
      }
      if (fresh) scheduleScan(500);
    });
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }
  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver);

  /* لا شيء آخر — صمت كامل: لا شريط، لا حوار، لا طلبات شبكة */
})();
