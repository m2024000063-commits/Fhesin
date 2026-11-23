/* درع السياق الاستباقي — منطق صفحة الحجب */
'use strict';

const $ = id => document.getElementById(id);

function send(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, r => { void chrome.runtime.lastError; resolve(r); });
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const params = new URLSearchParams(location.search);
const target = params.get('t') || '';

$('targetUrl').textContent = target || 'غير معروف';

/* إصلاح: نص سطر الجدار كان يبقى «…» دائماً — الآن يُملأ حسب مصدر الحجب:
   w=scan → الفحص الفوري قبل اكتمال التحميل، و w=hard → الجدار الصلب على مستوى الشبكة */
const wallMode = params.get('w') || 'scan';
$('wallLine').textContent = wallMode === 'hard'
  ? 'أعاد الجهاز محاولة الوصول إلى هذا النطاق، فأوقف الجدار الصلب الطلب على مستوى الشبكة قبل أي تحميل.'
  : 'الفحص الفوري رصد الخطر قبل اكتمال تحميل الصفحة وأوقفها فوراً.';

/* إصلاح: لوحة المقارنة مع الموقع الرسمي كانت موجودة في HTML مخفية ولا يملؤها الكود أبداً —
   الآن تُعرض عند اكتشاف انتحال جهة (نفس بيانات comparison من المحرك) */
function renderComparison(cmp) {
  if (!cmp) return;
  $('comparePanel').style.display = 'block';
  const body = $('cmpBody');
  body.innerHTML = '';

  function cmpRow(label, prefix, mid, suffix, cls) {
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
    body.appendChild(row);
  }

  cmpRow('المشبوه:', cmp.diff.prefix, cmp.diff.fakeMid, cmp.diff.suffix, 'cmp-bad');
  cmpRow('الرسمي:', cmp.diff.prefix, cmp.diff.officialMid, cmp.diff.suffix, 'cmp-good');

  const info = document.createElement('p');
  info.className = 'cmp-info';
  info.textContent = 'الجهة المنتحلة: ' + cmp.entity + ' — نمط الانتحال: ' + cmp.kindText +
    (cmp.distance != null ? ' — بفارق ' + cmp.distance + ' حرف فقط' : '') +
    (cmp.substituted && cmp.substituted.length
      ? ' — حروف مُستبدلة: ' + cmp.substituted.map(s => s.from + '←' + s.to).join('، ')
      : '');
  body.appendChild(info);

  const go = document.createElement('a');
  go.className = 'cmp-go';
  go.href = cmp.officialUrl;
  go.target = '_blank';
  go.rel = 'noopener noreferrer';
  go.textContent = 'افتح الموقع الرسمي الصحيح ↗ ' + cmp.officialHost;
  body.appendChild(go);
}

if (target) {
  send({ type: 'analyze', url: target }).then(res => {
    if (!res) return;
    $('scoreChip').textContent = 'درجة الخطورة: ' + res.score + '/100';
    $('levelChip').textContent = 'التصنيف: ' + res.levelText;
    const list = $('reasons');
    list.innerHTML = '';
    res.reasons.forEach(r => {
      const li = document.createElement('li');
      li.textContent = r.text + (r.weight > 0 ? ' (+' + r.weight + ')' : '');
      list.appendChild(li);
    });
    renderComparison(res.comparison);
  });
}

$('backBtn').addEventListener('click', () => {
  // العودة للصفحة السابقة (نتيجة البحث أو الخريطة) إن وُجدت، وإلا صفحة جديدة فارغة
  if (history.length > 1) history.back();
  else window.location.href = 'about:blank';
});

$('reportBtn').addEventListener('click', async () => {
  const res = await send({ type: 'analyze', url: target }).catch(() => null);
  await send({
    type: 'report',
    url: target,
    score: res ? res.score : null,
    level: res ? res.level : 'danger',
    note: 'مُبلّغ عنه من صفحة الحجب (احتيال مؤكد من المستخدم)',
    source: 'interstitial'
  });
  $('reportBtn').textContent = 'تم الإبلاغ ✓';
  setTimeout(() => { $('reportBtn').textContent = 'الإبلاغ كاحتيال مؤكد'; }, 2500);
});

$('continueBtn').addEventListener('click', async () => {
  await send({ type: 'allowOnce', url: target });
  try { location.replace(target); } catch (e) { location.href = target; }
});

