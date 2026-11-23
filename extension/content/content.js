/*
 * حصن (Hisn) — Content Script
 * 1) شريط تنبيه أعلى الصفحة حسب تصنيف الرابط
 * 2) وسم نتائج البحث والروابط بشارات ملونة (أخضر/أصفر/أحمر)
 * 3) حارس النماذج: اعتراض إرسال بيانات حساسة في صفحة مشبوهة
 * يتطلب: PCS_DATA + PCS_ENGINE (تُحمَّل قبله في manifest)
 */
(async function () {
  'use strict';
  if (!self.PCS_ENGINE || !self.PCS_DATA) return;
  const ENGINE = self.PCS_ENGINE;

  function send(msg) {
    return new Promise(resolve => {
      try { chrome.runtime.sendMessage(msg, r => { void chrome.runtime.lastError; resolve(r); }); }
      catch (e) { resolve(null); }
    });
  }

  /* ================= الإعدادات ================= */
  let settings = await send({ type: 'getSettings' }) ||
    { blocking: true, scanSearch: true, scanAllLinks: 'auto' };

  /* ================= فحص الصفحة الحالية + شريط التنبيه ================= */
  let currentScore = 0;
  let bannerDismissed = false;

  const pageRes = await send({ type: 'analyze', url: location.href });
  if (pageRes && pageRes.scannable) currentScore = pageRes.score;
  if (pageRes && (pageRes.level === 'caution' || pageRes.level === 'danger')) {
    showBanner(pageRes);
  }

  function showBanner(res) {
    if (bannerDismissed || document.getElementById('pcs-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'pcs-banner';
    bar.className = 'pcs-show pcs-' + res.level;

    const meta = ENGINE.levels[res.level];
    const icon = res.level === 'danger' ? '✕' : '!';
    const title = res.level === 'danger'
      ? 'تحذير: هذا الموقع مصنّف كخطر محتمل — لا تُدخل أي بيانات مالية أو رموز تحقق'
      : 'تنبيه: هذا الرابط مشبوه — تعامل بحذر قبل إدخال أي بيانات';
    const reasons = res.reasons.filter(r => r.weight > 0).slice(0, 3).map(r => r.text).join(' • ');
    const host = res.simulated ? res.simulated : res.host;

    bar.innerHTML =
      '<div class="pcs-banner-icon">' + icon + '</div>' +
      '<div class="pcs-banner-body">' +
      '<div class="pcs-banner-title">' + title + '</div>' +
      '<div class="pcs-banner-reasons">' + meta.text + ' (' + res.score + '/100) — ' + host + (reasons ? ' — ' + reasons : '') + '</div>' +
      '</div>';

    const btn = document.createElement('button');
    btn.className = 'pcs-banner-btn';
    btn.textContent = res.level === 'danger' ? 'أُدرك المخاطر' : 'إخفاء';
    btn.addEventListener('click', () => { bar.remove(); bannerDismissed = true; });
    bar.appendChild(btn);

    document.documentElement.appendChild(bar);
  }

  /* ================= فحص الروابط (نتائج البحث + الوضع العام) ================= */

  function resolveHref(href) {
    try {
      const u = new URL(href, location.href);
      const host = u.hostname;
      // روابط إعادة توجيه جوجل
      if (u.pathname === '/url' && u.searchParams.get('q')) {
        return u.searchParams.get('q');
      }
      // روابط إعادة توجيه بينج (u=a1<base64>)
      if (host.indexOf('bing.com') !== -1 && u.pathname.indexOf('/ck/') === 0) {
        const uParam = u.searchParams.get('u') || '';
        if (uParam.indexOf('a1') === 0) {
          const b64 = uParam.slice(2);
          try { return atob(b64.replace(/-/g, '+').replace(/_/g, '/')); } catch (e) { return null; }
        }
      }
      if (/^https?:/i.test(u.href)) return u.href;
      return null;
    } catch (e) { return null; }
  }

  function badgeFor(res) {
    const b = document.createElement('span');
    b.className = 'pcs-badge pcs-badge-' + res.level;
    b.textContent = ENGINE.levels[res.level].text;
    const reasons = res.reasons.filter(r => r.weight > 0).slice(0, 3).map(r => r.text).join(' • ');
    b.title = 'حصن: ' + ENGINE.levels[res.level].text +
      ' (' + res.score + '/100)' + (reasons ? '\n' + reasons : '');
    return b;
  }

  function labelAnchor(a) {
    if (a.dataset && a.dataset.pcsLabeled) return;
    const target = resolveHref(a.getAttribute('href') || '');
    if (!target) return;
    const res = ENGINE.analyze(target);
    if (!res.scannable) return;
    a.dataset.pcsLabeled = '1';
    a.appendChild(badgeFor(res));
  }

  function scanRoot(root, max) {
    const anchors = root.querySelectorAll('a[href]');
    let n = 0;
    for (const a of anchors) {
      if (n >= max) break;
      if (a.closest('#pcs-banner')) continue;
      labelAnchor(a);
      n++;
    }
  }

  function searchEngineHost() {
    const h = location.hostname;
    for (const key of Object.keys(self.PCS_DATA.searchEngines)) {
      if (h === key || h.indexOf(key) !== -1) return self.PCS_DATA.searchEngines[key];
    }
    return null;
  }

  function genericModeEnabled() {
    if (settings.scanAllLinks === 'on') return true;
    if (settings.scanAllLinks === 'off') return false;
    // auto: الصفحات المحلية (بيئة الديمو) فقط
    return location.hostname === 'localhost' || location.hostname === '127.0.0.1' ||
      location.protocol === 'file:';
  }

  let debounceTimer = null;
  function scheduleScan() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => scanRoot(document, 300), 700);
  }

  if (settings.scanSearch && searchEngineHost()) {
    scheduleScan();
    const mo = new MutationObserver(scheduleScan);
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
  } else if (genericModeEnabled()) {
    scheduleScan();
    const mo2 = new MutationObserver(scheduleScan);
    mo2.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  /* ================= حارس النماذج ================= */

  function inspectForm(form) {
    const fields = form.querySelectorAll('input, textarea');
    let passwords = 0;
    const names = [];
    fields.forEach(f => {
      const type = (f.getAttribute('type') || 'text').toLowerCase();
      if (type === 'password') passwords++;
      const id = (f.name || f.id || '').toString();
      if (id) names.push(id);
    });
    let crossOrigin = false;
    const action = form.getAttribute('action') || '';
    try {
      const resolved = new URL(action || location.href, location.href);
      crossOrigin = resolved.origin !== location.origin && /^https?:/i.test(resolved.protocol);
    } catch (e) { crossOrigin = false; }
    return { passwords, fieldNames: names, crossOrigin };
  }

  function markRiskyFields() {
    if (currentScore < 25) return;
    document.querySelectorAll('form input, form textarea').forEach(f => {
      const id = ((f.name || f.id || '') + ' ' + (f.getAttribute('type') || '')).toLowerCase();
      if (/otp|card|cvv|cvc|pin|iban|password|pass/.test(id)) f.classList.add('pcs-risk-field');
    });
  }
  markRiskyFields();

  const allowedForms = new WeakSet();
  let modalOpen = false;

  function showFormModal(verdict, form) {
    if (modalOpen) return;
    modalOpen = true;
    const overlay = document.createElement('div');
    overlay.id = 'pcs-modal-overlay';
    const reasons = verdict.reasons.slice(0, 4).map(r => '<li>' + r.text + '</li>').join('');
    overlay.innerHTML =
      '<div id="pcs-modal" role="alertdialog">' +
      '<h3>توقف — محاولة جمع بيانات حساسة</h3>' +
      '<p>هذه الصفحة مصنّفة كمشبوهة، ونموذجها يطلب بيانات حساسة:</p>' +
      '<ul>' + reasons + '</ul>' +
      '<p><b>لا تكمل إلا إذا كنت متأكداً تماماً أن الموقع رسمي.</b></p>' +
      '<div class="pcs-modal-actions">' +
      '<button class="pcs-btn-cancel">إلغاء (آمن)</button>' +
      '<button class="pcs-btn-continue">متابعة على مسؤوليتي</button>' +
      '</div></div>';
    document.documentElement.appendChild(overlay);

    const [cancelBtn, continueBtn] =
      overlay.querySelectorAll('.pcs-btn-cancel, .pcs-btn-continue');

    cancelBtn.addEventListener('click', () => { overlay.remove(); modalOpen = false; });
    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); modalOpen = false; } });
    continueBtn.addEventListener('click', () => {
      overlay.remove(); modalOpen = false;
      allowedForms.add(form);
      try { form.requestSubmit(); } catch (e) { form.submit(); }
    });
    cancelBtn.focus();
  }

  document.addEventListener('submit', e => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (allowedForms.has(form)) return;

    const info = inspectForm(form);
    const verdict = ENGINE.analyzeForms(info, { pageScore: currentScore });
    if (verdict.level === 'danger') {
      e.preventDefault();
      e.stopPropagation();
      showFormModal(verdict, form);
    }
  }, true);
})();
