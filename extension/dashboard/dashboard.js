/* حصن (Hisn) — منطق لوحة مؤشرات التهديدات */
'use strict';

const $ = id => document.getElementById(id);
let filter = 'all';
let currentData = { log: [], stats: {}, reports: [] };

function send(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, r => { void chrome.runtime.lastError; resolve(r); });
  });
}

function chip(level) {
  const meta = { safe: 'آمن', caution: 'مشبوه', danger: 'خطر', na: 'غير قابل للفحص' }[level] || level;
  return '<span class="chip ' + level + '">' + meta + '</span>';
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' +
    p(d.getHours()) + ':' + p(d.getMinutes());
}

function actionText(a) {
  return {
    blocked: 'حُجب قبل الفتح',
    override: 'تجاوز يدوي',
    monitored: 'مراقبة',
    manual: 'فحص يدوي'
  }[a] || a;
}

function renderStats(stats, reportsCount) {
  $('stTotal').textContent = stats.total || 0;
  $('stSafe').textContent = stats.safe || 0;
  $('stCaution').textContent = stats.caution || 0;
  $('stDanger').textContent = stats.danger || 0;
  $('stBlocked').textContent = stats.blocked || 0;
  $('stReports').textContent = reportsCount;

  const total = Math.max(1, stats.total || 0);
  const rows = [
    { label: 'آمن', n: stats.safe || 0, color: '#22c55e' },
    { label: 'مشبوه', n: stats.caution || 0, color: '#f59e0b' },
    { label: 'خطر', n: stats.danger || 0, color: '#ef4444' }
  ];
  const dist = $('dist');
  dist.innerHTML = '';
  rows.forEach(r => {
    const pct = Math.round((r.n / total) * 100);
    dist.insertAdjacentHTML('beforeend',
      '<div class="dist-row">' +
      '<span class="dist-label">' + r.label + '</span>' +
      '<div class="dist-bar"><div class="dist-fill" style="width:' + pct + '%;background:' + r.color + '"></div></div>' +
      '<span class="dist-num">' + r.n + '</span>' +
      '</div>');
  });
}

function renderCampaigns(log) {
  const map = {};
  log.forEach(e => {
    if (e.level !== 'caution' && e.level !== 'danger') return;
    if (!map[e.host]) map[e.host] = { host: e.host, count: 0, max: 0, level: 'caution' };
    map[e.host].count++;
    if (e.score > map[e.host].max) map[e.host].max = e.score;
    if (e.level === 'danger') map[e.host].level = 'danger';
  });
  const list = Object.values(map).sort((a, b) => b.count - a.count || b.max - a.max).slice(0, 12);
  const tbody = $('campaigns').querySelector('tbody');
  tbody.innerHTML = '';
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">لا توجد أنماط متكررة بعد — السجل يجمع البيانات تلقائياً مع الاستخدام.</td></tr>';
    return;
  }
  list.forEach(c => {
    tbody.insertAdjacentHTML('beforeend',
      '<tr><td class="ltr">' + escapeHtml(c.host) + '</td>' +
      '<td>' + c.count + '</td>' +
      '<td class="ltr">' + c.max + '/100</td>' +
      '<td>' + chip(c.level) + '</td></tr>');
  });
}

function renderLog(log) {
  const tbody = $('logTable').querySelector('tbody');
  tbody.innerHTML = '';
  const rows = log.filter(e => filter === 'all' || e.level === filter).slice().reverse().slice(0, 100);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">لا توجد سجلات في هذا التصنيف.</td></tr>';
    return;
  }
  rows.forEach(e => {
    tbody.insertAdjacentHTML('beforeend',
      '<tr>' +
      '<td style="white-space:nowrap">' + fmtTime(e.ts) + '</td>' +
      '<td class="ltr">' + escapeHtml(shortUrl(e.url)) + '</td>' +
      '<td class="ltr">' + (e.score != null ? e.score + '/100' : '—') + '</td>' +
      '<td>' + chip(e.level) + '</td>' +
      '<td>' + escapeHtml((e.top || []).join(' • ')) + '</td>' +
      '<td><span class="action-tag">' + actionText(e.action) + '</span></td>' +
      '</tr>');
  });
}

function renderReports(reports) {
  const tbody = $('reportsTable').querySelector('tbody');
  tbody.innerHTML = '';
  if (!reports.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">لا توجد بلاغات — استخدم زر «الإبلاغ عن الرابط» في النافذة المنبثقة.</td></tr>';
    return;
  }
  reports.slice().reverse().forEach(r => {
    tbody.insertAdjacentHTML('beforeend',
      '<tr>' +
      '<td style="white-space:nowrap">' + fmtTime(r.ts) + '</td>' +
      '<td class="ltr">' + escapeHtml(shortUrl(r.url)) + '</td>' +
      '<td>' + (r.level ? chip(r.level) : '—') + '</td>' +
      '<td>' + escapeHtml(r.note || '') + '</td>' +
      '</tr>');
  });
}

function shortUrl(u) {
  return (u || '').length > 90 ? u.slice(0, 90) + '…' : u;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function load() {
  const d = await send({ type: 'getDashboard' });
  if (!d) return;
  currentData = d;
  renderStats(d.stats, (d.reports || []).length);
  renderCampaigns(d.log || []);
  renderLog(d.log || []);
  renderReports(d.reports || []);
}

/* الفلاتر */
document.querySelectorAll('.filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filter = btn.dataset.f;
    renderLog(currentData.log || []);
  });
});

/* التصدير: تغذية استخباراتية جاهزة للمشاركة مع الجهات المختصة */
$('exportJson').addEventListener('click', () => {
  const feed = {
    generator: 'حصن (Hisn) v' + chrome.runtime.getManifest().version,
    generatedAt: new Date().toISOString(),
    stats: currentData.stats,
    campaigns: currentData.log
      .filter(e => e.level === 'caution' || e.level === 'danger')
      .reduce((acc, e) => {
        if (!acc[e.host]) acc[e.host] = { domain: e.host, detections: 0, maxScore: 0, levels: {} };
        acc[e.host].detections++;
        acc[e.host].maxScore = Math.max(acc[e.host].maxScore, e.score || 0);
        acc[e.host].levels[e.level] = (acc[e.host].levels[e.level] || 0) + 1;
        return acc;
      }, {}),
    detections: currentData.log,
    reports: currentData.reports
  };
  download(JSON.stringify(feed, null, 2), 'pcs-threat-intel.json', 'application/json');
});

$('exportCsv').addEventListener('click', () => {
  const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = ['time,url,host,score,level,reasons,action'];
  currentData.log.forEach(e => {
    lines.push([new Date(e.ts).toISOString(), esc(e.url), esc(e.host), e.score, e.level,
      esc((e.top || []).join(' | ')), esc(e.action)].join(','));
  });
  download('\uFEFF' + lines.join('\n'), 'pcs-detections.csv', 'text/csv');
});

function download(content, name, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

$('clearBtn').addEventListener('click', async () => {
  if (!confirm('سيتم مسح كل السجلات والبلاغات والإحصاءات من هذا الجهاز. متابعة؟')) return;
  await send({ type: 'clearData' });
  load();
});

load();
