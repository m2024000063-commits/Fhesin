'use strict';
/*
 * حصن (Hisn) — اختبارات محرك الكشف: node scripts/test_engine.js
 * تغطي: انتحال الجهات، Typosquatting، Homoglyphs، المختصرات، IP، خدعة @،
 * مصدر السياق، المقارنة الفورية، نص العرض، فحص النماذج، وحالات آمنة لمنع الإيجابيات الكاذبة.
 * صفر dependencies — تعمل على أي Node حديث وتُرجع رمز خطأ عند أي فشل.
 */
const ENGINE = require('../extension/rules/engine.js');
const DATA = require('../extension/rules/data.js');

let passed = 0, failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  failures.push({ name, detail: detail || '' });
  console.error('  FAIL: ' + name + (detail ? ' — ' + detail : ''));
}

function analyze(url, source) {
  return ENGINE.analyze(url, { source: source || 'direct' });
}

function hasReason(res, code) {
  return res.reasons.some(r => r.code === code);
}

/* ================= 1) انتحال الجهات المحمية ================= */
{
  const r = analyze('https://emiratesnbd-secure-verify.com/login');
  check('بنك مقلد مركب → خطر', r.level === 'danger', 'الدرجة ' + r.score);
  check('بنك مقلد → سبب BRAND أو TYPO', hasReason(r, 'BRAND') || hasReason(r, 'TYPO'));
  check('بنك مقلد → المقارنة الفورية موجودة', !!r.comparison && r.comparison.officialHost === 'emiratesnbd.com');
  check('بنك مقلد → سبب KEYWORDS واحد فقط', !hasReason(r, 'KEYWORDS') ||
    r.reasons.filter(x => x.code === 'KEYWORDS').length === 1);
}
{
  const r = analyze('https://adcb-secure-login.com');
  check('انتحال ADCB مع login/secure → خطر', r.level === 'danger');
  check('انتحال ADCB → عقوبة مركّبة COMPOUND', hasReason(r, 'COMPOUND'));
}
{
  const r = analyze('https://bankfab-verify.top');
  check('انتحال FAB مع لاحقة خطرة → خطر', r.level === 'danger');
}
{
  const r = analyze('https://dib-otp.com');
  check('انتحال DIB مع otp → خطر', r.level === 'danger');
}
{
  const r = analyze('https://adib.ae.verified-secure.top');
  check('نطاق يخفي الجهة داخل السلسلة → خطر', r.level === 'danger');
}
{
  const r = analyze('https://emiratesnbd.com.emiratesnbd-secure.xyz/login?otp=1');
  check('نطاق فرعي خبيث فوق اسم الجهة → خطر', r.level === 'danger', 'الدرجة ' + r.score);
}

/* ================= 2) Homoglyphs وPunycode ================= */
{
  const r = analyze('https://еmiratesnbd.com'); // حرف е السيريلي
  check('homoglyph سيريلي → خطر', r.level === 'danger');
  check('homoglyph → سبب HOMOGLYPH', hasReason(r, 'HOMOGLYPH'));
  check('homoglyph → حرف مُستبدل معروض', Array.isArray(r.comparison.substituted) && r.comparison.substituted.length > 0);
}
{
  const cmp = ENGINE.compare('https://еmiratesnbd.com');
  check('compare() → الموقع الرسمي صحيح', !!cmp && cmp.officialHost === 'emiratesnbd.com');
  check('compare() → الفرق يحصر الحرف المزيّف', cmp.diff.fakeMid.length > 0);
}
{
  const r = analyze('https://xn--mgbml9cbca.com');
  check('punycode → سبب PUNYCODE', hasReason(r, 'PUNYCODE'));
}
{
  const r = analyze('https://wikipedia.org');
  check('نطاق لاتيني سليم → بلا سبب punycode', !hasReason(r, 'PUNYCODE') && !hasReason(r, 'NONLATIN'));
}

/* ================= 3) عناوين IP (بعد الإصلاح) ================= */
{
  const r = analyze('http://192.168.1.5/otp');
  check('IP مع otp → خطر (عقبة مركّبة جديدة)', r.level === 'danger', 'الدرجة ' + r.score);
  check('IP → سبب IPHOST', hasReason(r, 'IPHOST'));
  check('IP → لا سبب DEEPSUB وهمي (إصلاح registrableDomain)', !hasReason(r, 'DEEPSUB'));
  check('IP → النطاق المسجل هو العنوان نفسه', r.registrable === '192.168.1.5');
}
{
  const r = analyze('http://192.168.1.1');
  check('IP عادي (راوتر منزلي) → ليس خطراً', r.level !== 'danger', 'الدرجة ' + r.score);
}

/* ================= 4) خدعة معلومات المستخدم (@) ================= */
{
  const r = analyze('https://bank.com@evil.xyz');
  check('خدعة @ → خطر بعد رفع الوزن', r.level === 'danger', 'الدرجة ' + r.score);
  check('خدعة @ → سبب USERINFO', hasReason(r, 'USERINFO'));
}
{
  const r = analyze('https://example.com');
  check('رابط عادي → بلا سبب USERINFO', !hasReason(r, 'USERINFO'));
}

/* ================= 5) المختصرات واللاحقات والكلمات ================= */
{
  const r = analyze('https://bit.ly/gift-prize');
  check('رابط مختصر → مشبوه مع سبب SHORTENER', r.level === 'caution' && hasReason(r, 'SHORTENER'));
}
{
  const r = analyze('https://prize-winner.xyz');
  check('لاحقة خطرة + كلمات → مشبوه على الأقل', r.level === 'caution' || r.level === 'danger');
  check('لاحقة خطرة → سبب TLD', hasReason(r, 'TLD'));
}
{
  const r = analyze('https://verify-secure.top');
  check('verify- يُحتسب مرة واحدة (إصلاح العد المزدوج)', r.reasons.filter(x => x.code === 'KEYWORDS').length === 1);
}

/* ================= 6) النطاقات الرسمية (منع الإيجابيات الكاذبة) ================= */
[
  ['https://www.emiratesnbd.com', 'Emirates NBD'],
  ['https://www.adcb.com', 'ADCB'],
  ['https://www.adib.ae', 'ADIB'],
  ['https://bankfab.com', 'FAB'],
  ['https://www.rakbank.ae', 'RAKBANK'],
  ['https://www.mashreq.com', 'Mashreq'],
  ['https://www.dubaipolice.gov.ae', 'شرطة دبي'],
  ['https://adpolice.gov.ae', 'شرطة أبوظبي'],
  ['https://icp.gov.ae', 'ICP'],
  ['https://mohap.gov.ae', 'MOHAP'],
  ['https://www.etisalat.ae', 'e&'],
  ['https://www.du.ae', 'du'],
  ['https://u.ae', 'البوابة الرسمية'],
  ['https://centralbank.ae', 'CBUAE']
].forEach(([url, name]) => {
  const r = analyze(url);
  check('رسمي آمن: ' + name, r.level === 'safe' && hasReason(r, 'OFFICIAL'),
    'النتيجة ' + r.level + '/' + r.score);
});
{
  const r = analyze('https://fabricstore.com');
  check('«fab» داخل كلمة → بلا انتحال', r.level !== 'danger' && !hasReason(r, 'BRAND') && !hasReason(r, 'TYPO'),
    'النتيجة ' + r.level);
}
{
  const r = analyze('https://sibling-store.com');
  check('«sib» داخل كلمة → بلا انتحال', !hasReason(r, 'BRAND'));
}

/* ================= 7) مصدر السياق ================= */
{
  const r = analyze('https://wikipedia.org', 'message');
  check('مصدر رسالة → +SOURCE', hasReason(r, 'SOURCE'));
}
{
  const r = analyze('https://wikipedia.org', 'direct');
  check('مصدر مباشر → بلا +SOURCE', !hasReason(r, 'SOURCE'));
}

/* ================= 8) حالات غير قابلة للفحص ================= */
[
  ['not a url', 'رابط غير صالح'],
  ['', 'رابط غير صالح'],
  ['ftp://files.example.com', 'صفحة نظام'],
  ['file:///C:/x.html', 'ملف محلي']
].forEach(([url, why]) => {
  const r = analyze(url);
  check('غير قابل للفحص: ' + JSON.stringify(url), r.scannable === false && r.level === 'na');
});

/* ================= 9) النص الجاهز للعرض (buildDisplay) ================= */
{
  const d = ENGINE.buildDisplay(analyze('https://adcb-secure-login.com'));
  check('buildDisplay → يبدأ برمز الخطر', d.indexOf('🔴') === 0);
  check('buildDisplay → يحتوي الدرجة', d.indexOf('/100') !== -1);
  check('buildDisplay → يحتوي أسباباً', d.indexOf('• ') !== -1);
}

/* ================= 10) فحص النماذج (analyzeForms) ================= */
{
  const v = ENGINE.analyzeForms(
    { passwords: 1, fieldNames: ['otp', 'cardnumber'], crossOrigin: true }, { pageScore: 60 });
  check('نموذج جمع بيانات كامل → خطر', v.level === 'danger');
}
{
  const v = ENGINE.analyzeForms(
    { passwords: 0, fieldNames: ['email'], crossOrigin: false }, { pageScore: 0 });
  check('نموذج بريد عادي → آمن', v.level === 'safe');
}

/* ================= 11) استخراج النطاق المسجل ================= */
check('registrable: sub.domain.com', ENGINE.registrableDomain('sub.domain.com') === 'domain.com');
check('registrable: www.adpolice.gov.ae', ENGINE.registrableDomain('www.adpolice.gov.ae') === 'adpolice.gov.ae');
check('registrable: عنوان IP يبقى كما هو', ENGINE.registrableDomain('10.0.0.1') === '10.0.0.1');

/* ================= 12) تكامل قاعدة البيانات ================= */
check('عدد الجهات المحمية = 27', DATA.protectedEntities.length === 27,
  'الفعلي ' + DATA.protectedEntities.length);
{
  const dupes = {};
  let bad = false;
  for (const ent of DATA.protectedEntities) {
    if (dupes[ent.domain]) { bad = true; console.error('  تكرار نطاق: ' + ent.domain); }
    dupes[ent.domain] = true;
    if (!Array.isArray(ent.tokens)) bad = true;
  }
  check('لا نطاقات مكررة + tokens مصفوفة', !bad);
}
{
  const kws = DATA.riskyKeywords.map(k => k.kw);
  check('لا كلمات مفتاحية مكررة', new Set(kws).size === kws.length);
}
check('وزن userinfo مرفوع إلى 45', DATA.config.weights.userinfo === 45);
check('عقبة IP+كلمات مضافة = 15', DATA.config.weights.ipKeywordCompound === 15);
check('إصدار المحرك 2.3.0', ENGINE.version === '2.3.0', 'الفعلي ' + ENGINE.version);

/* ================= الخلاصة ================= */
console.log('\nمحرك حصن: ' + passed + ' نجح / ' + failed + ' فشل — المحرك v' + ENGINE.version);
if (failed) {
  console.error('فشل ' + failed + ' اختباراً');
  process.exit(1);
}
