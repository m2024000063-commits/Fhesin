/* حصن (Hisn) — Popup logic */
'use strict';

const $ = id => document.getElementById(id);

function send(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, r => { void chrome.runtime.lastError; resolve(r); });
  });
}

function levelColor(level) {
  return { safe: '#16a34a', caution: '#d97706', danger: '#dc2626', na: '#6b7280' }[level] || '#6b7280';
}

function renderResult(res) {
  const gauge = $('gauge');
  const scoreNum = $('scoreNum');
  const chip = $('levelChip');
  const host = $('hostLine');
  const list = $('reasons');

  const color = levelColor(res.level);
  scoreNum.textContent = res.scannable ? String(res.score) : '—';
  gauge.style.background = 'conic-gradient(' + color + ' 0deg ' + Math.round(res.score * 3.6) + 'deg, #e5e7eb ' + Math.round(res.score * 3.6) + 'deg 360deg)';
  chip.textContent = res.levelText || 'غير معروف';
  chip.style.background = color + '22';
  chip.style.color = color;
  host.textContent = (res.simulated ? '[محاكاة] ' : '') + (res.registrable || res.host || res.url) +
    (res.cloud ? ' • تقييم سحابي' : '');

  list.innerHTML = '';
  (res.reasons || []).slice(0, 6).forEach(r => {
    const li = document.createElement('li');
    let cls = 'r-info';
    if (r.weight > 0) cls = res.level === 'danger' ? 'r-danger' : (res.level === 'caution' ? 'r-caution' : 'r-info');
    if (r.weight < 0 || r.code === 'OFFICIAL') cls = 'r-safe';
    li.className = cls;
    li.textContent = (r.weight > 0 ? '• ' : (r.weight < 0 ? '✓ ' : 'ℹ ')) + r.text +
      (r.weight > 0 ? ' (+' + r.weight + ')' : '');
    list.appendChild(li);
  });

  /* المقارنة الفورية مع الموقع الرسمي عند اكتشاف انتحال — كانت تُعرض في الموقع وصفحة
     الحجب فقط رغم أن README يَعِد بعرضها في كل الواجهات */
  const cmp = res.comparison;
  const cmpCard = $('cmpCard');
  if (cmp) {
    cmpCard.style.display = 'block';
    const rows = $('cmpRows');
    rows.innerHTML = '';
    const cmpRow = (label, prefix, mid, suffix, cls) => {
      const row = document.createElement('div');
      row.className = 'cmp-row ' + cls;
      const tag = document.createElement('span');
      tag.className = 'cmp-tag';
      tag.textContent = label;
      const code = document.createElement('code');
      code.className = 'cmp-host';
      code.appendChild(document.createTextNode(prefix));
      if (mid) {
        const mark = document.createElement('mark');
        mark.textContent = mid;
        code.appendChild(mark);
      }
      code.appendChild(document.createTextNode(suffix));
      row.appendChild(tag);
      row.appendChild(code);
      rows.appendChild(row);
    };
    cmpRow('المشبوه:', cmp.diff.prefix, cmp.diff.fakeMid, cmp.diff.suffix, 'cmp-bad');
    cmpRow('الرسمي:', cmp.diff.prefix, cmp.diff.officialMid, cmp.diff.suffix, 'cmp-good');
    const go = $('cmpLink');
    go.href = cmp.officialUrl;
    go.textContent = 'الرسمي ↗ ' + cmp.officialHost;
  } else {
    cmpCard.style.display = 'none';
  }

  $('reportBtn').onclick = async () => {
    await send({ type: 'report', url: res.url, score: res.score, level: res.level, source: 'popup' });
    $('reportBtn').textContent = 'تم الإبلاغ ✓';
    setTimeout(() => { $('reportBtn').textContent = 'الإبلاغ عن الرابط'; }, 2000);
  };
}

async function scanCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;
  const res = await send({ type: 'analyze', url: tab.url });
  if (res) renderResult(res);
}

async function loadStats() {
  const { pcs_stats } = await chrome.storage.local.get('pcs_stats');
  const s = pcs_stats || { total: 0, safe: 0, caution: 0, danger: 0, blocked: 0 };
  $('stTotal').textContent = s.total;
  $('stSafe').textContent = s.safe;
  $('stCaution').textContent = s.caution;
  $('stDanger').textContent = s.danger;
  $('stBlocked').textContent = s.blocked;
}

async function loadSettings() {
  const s = await send({ type: 'getSettings' });
  if (!s) return;
  $('setBlocking').checked = !!s.blocking;
  $('setHardWall').checked = !!s.hardWall;
  $('setScanSearch').checked = !!s.scanSearch;
  $('setSilentDots').checked = s.silentDots !== false;
  $('setCloud').checked = !!s.useCloud;
  $('cloudEndpoint').value = s.cloudEndpoint || '';
  $('setScanAll').value = s.scanAllLinks || 'auto';
  $('statusDot').className = 'dot ' + (s.blocking ? 'dot-on' : 'dot-off');
  $('statusDot').title = s.blocking ? 'الحماية مفعّلة' : 'الحجب معطّل — التنبيهات فقط';
}

async function bindSettings() {
  $('setBlocking').addEventListener('change', async e => {
    await send({ type: 'setSettings', patch: { blocking: e.target.checked } });
    loadSettings();
  });
  $('setHardWall').addEventListener('change', e => {
    send({ type: 'setSettings', patch: { hardWall: e.target.checked } });
  });
  $('setScanSearch').addEventListener('change', e => {
    send({ type: 'setSettings', patch: { scanSearch: e.target.checked } });
  });
  $('setSilentDots').addEventListener('change', e => {
    send({ type: 'setSettings', patch: { silentDots: e.target.checked } });
  });
  $('setCloud').addEventListener('change', e => {
    send({ type: 'setSettings', patch: { useCloud: e.target.checked } });
  });
  $('cloudEndpoint').addEventListener('change', e => {
    send({ type: 'setSettings', patch: { cloudEndpoint: e.target.value.trim() } });
  });
  $('setScanAll').addEventListener('change', e => {
    send({ type: 'setSettings', patch: { scanAllLinks: e.target.value } });
  });
}

function bindManual() {
  const input = $('manualUrl');
  const go = async () => {
    let v = input.value.trim();
    if (!v) return;
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    const res = await send({ type: 'analyze', url: v, log: true });
    if (res) renderResult(res);
    loadStats();
  };
  $('manualBtn').addEventListener('click', go);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

$('rescanBtn').addEventListener('click', () => { scanCurrentTab(); loadStats(); });

$('dashBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

document.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version;
scanCurrentTab();
loadStats();
loadSettings();
bindSettings();
bindManual();
