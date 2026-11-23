'use strict';
/*
 * حصن (Hisn) — المنطق المشترك لدوال Vercel الخادمية (بدون أي مكتبات خارجية)
 *
 * الفحص نفسه عديم الحالة (دوال نقية فوق المحرك)، وسجل الفحوصات/البلاغات
 * يُحفظ في ذاكرة كل نسخة دالة (ephemeral) — يكفي لتجميع مؤشرات التهديدات
 * أثناء العمل، ويُعاد بناؤه تلقائياً بعد أي إعادة نشر.
 *
 * متغيرات البيئة:
 *   GEMINI_API_KEY     مفتاح Google AI Studio — يفعّل طبقة التحليل الذكي (Gemini) فوق المحرك المحلي
 *   PCS_GEMINI_MODEL   اسم النموذج (اختياري — الافتراضي gemini-2.5-flash)
 *   PCS_GEMINI_ENDPOINT تجاوز رابط Gemini (اختياري — للاختبار أو وسيط خاص)
 *   PCS_AI_ENDPOINT    رابط طبقة ذكاء اصطناعي عامة (اختياري — تُستخدم فقط إن لم يوجد مفتاح Gemini)
 *   PCS_AI_KEY         مفتاح المصادقة للطبقة العامة أعلاه (اختياري)
 */
const ENGINE = require('./engine.js');

const RATE_MAX = 120;            // أقصى طلبات لكل IP في النافذة (لكل نسخة دالة)
const RATE_WINDOW_MS = 60000;
const LOG_CAP = 500;
const REPORTS_CAP = 300;
const START = Date.now();

let scanlog = [];
let reports = [];

/* ============ حد معدل الطلبات ============ */

const hits = new Map();
function rateOk(ip) {
  const now = Date.now();
  let arr = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) { hits.set(ip, arr); return false; }
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return true;
}

/* ============ HTTP helpers ============ */

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function preflight(res) {
  setCors(res);
  res.statusCode = 204;
  res.end();
}

function send(res, status, body, contentType) {
  setCors(res);
  res.statusCode = status;
  /* ردود نصية جاهزة (format=text لاختصارات iOS) تُبَث كما هي بلا JSON */
  if (contentType && typeof body === 'string') {
    res.setHeader('Content-Type', contentType);
    res.end(body);
    return;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body, null, 2));
}

/* ============ أدوات مشتركة ============ */

function normalizeSource(s) {
  /* shortcut أُزيل نهائياً مع جهاز الاختصارات — المصادر الجديدة تخدم تطبيقات الهاتف:
     interceptor (معترض الروابط الوسيط) وnotification (مراقب إشعارات Android) */
  const allowed = ['search', 'maps', 'message', 'sms', 'chat', 'whatsapp', 'direct', 'extension', 'web', 'interceptor', 'notification', 'pwa', 'clipboard', 'bookmark'];
  s = String(s || '').toLowerCase();
  return allowed.indexOf(s) !== -1 ? s : 'direct';
}

/* ============ طبقة الذكاء الاصطناعي (Gemini) ============ */

const GEMINI_TIMEOUT_MS = 9000;      // مهلة كل محاولة — أطول من ذلك يبقى الفحص المحلي وحده
const GEMINI_TOTAL_MS = 12000;       // سقف زمني كلي لكل السلسلة — حماية لزمن استجابة الفحص
/* سلسلة النماذج (نوفمبر 2026): gemini-2.5-flash تقاعد ورد generateContent له 404 —
   وجهته الرسمية gemini-3.5-flash-lite (الأسرع والأرخص)، وflash-latest اسم مستعار
   يتبع أحدث إصدار مستقر تلقائياً. عند http_404 (نموذج غير متاح) تُجرَّب البدائل
   بالترتيب، والناجح يثبَّت للطلبات اللاحقة على الحاوية نفسها. */
const GEMINI_MODEL_CHAIN = ['gemini-3.5-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-2.5-flash'];
let geminiWorkingModel = null;

/* ردّ النموذج المفترض JSON فقط، لكن ننزع أي أسوار Markdown إن التفّت */
function parseGeminiJson(raw) {
  const text = String(raw || '').trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try { return JSON.parse(text); } catch (e) { return null; }
}

/*
 * geminiEvaluate — المحلل الذكي السياقي المتخصص بالخليج (انتحال بنوك، Typosquatting، Homoglyphs).
 * يستقبل نتيجة المحرك المحلي كسياق ليؤكدها أو يصححها، ويرد JSON عربي منظم.
 * أي فشل (لا مفتاح / مهلة / خطأ HTTP / JSON غير صالح) يعيد null — والفحص المحلي يبقى هو الحكم الأساس.
 */
async function geminiEvaluate(url, source, verdict) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const customEp = process.env.PCS_GEMINI_ENDPOINT;
  const override = process.env.PCS_GEMINI_MODEL;
  /* ترتيب المحاولات: نموذج نجح سابقاً على هذه الحاوية ← وإلا سلسلة البدائل.
     تجاوز يدوي أو نقطة نهاية مخصصة = مرشح واحد بلا تنقل. */
  const models = override ? [override]
    : (geminiWorkingModel && !customEp ? [geminiWorkingModel] : GEMINI_MODEL_CHAIN);
  const local = {
    score: verdict.score,
    level: verdict.levelText,
    registrable: verdict.registrable || verdict.host || '',
    top: verdict.reasons.slice(0, 5).map(r => r.text),
    official: verdict.comparison ? verdict.comparison.officialHost : null
  };
  const prompt = [
    'أنت محلل أمن سيبراني متخصص في كشف الروابط الخبيثة وانتحال الهوية (Phishing / Typosquatting) في العالم العربي والخليج.',
    'لديك نتيجة فحص قواعد محلية أولية — أكّدها أو صحّحها بناءً على معرفتك بالنطاقات الرسمية للبنوك والجهات الحكومية في الإمارات والخليج.',
    'افحص الرابط بدقة مع مراعاة مصدر وصوله للمستخدم:',
    '- الرابط: ' + url,
    '- مصدر الوصول: ' + source,
    '- النتيجة المحلية الأولية: ' + JSON.stringify(local),
    '',
    'أعد النتيجة بصيغة JSON فقط بدون أي نص إضافي أو علامات Markdown، وبهذا الهيكل الدقيق:',
    '{"verdict": "آمن أو مشبوه أو خطر",',
    ' "score": رقم صحيح من 0 إلى 100 يمثل درجة الأمان (100 آمن تماماً، 0 خطر مؤكد),',
    ' "reasons": ["سبب واضح ومختصر بالعربية 1", "سبب 2"],',
    ' "official_domain": "النطاق الرسمي الحقيقي إذا كان الرابط ينتحل جهة معروفة، وإلا null",',
    ' "display": "سطر واحد واضح بالعربية يبدأ برمز الحالة (🟢 أو 🟡 أو 🔴) ثم الدرجة من 100 ثم أهم سبب"}'
  ].join('\n');
  const bodyJson = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
  });
  const t0 = Date.now();
  let lastError = 'network';
  for (const model of models) {
    const endpoint = customEp ||
      ('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent');
    try {
      const ctl = new AbortController();
      const remaining = GEMINI_TOTAL_MS - (Date.now() - t0);
      const t = setTimeout(() => ctl.abort(), Math.min(GEMINI_TIMEOUT_MS, Math.max(remaining, 500)));
      const r = await fetch(endpoint + '?key=' + encodeURIComponent(key), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctl.signal,
        body: bodyJson
      });
      clearTimeout(t);
      if (!r.ok) {
        /* تشخيص آمن: رمز حالة Google فقط (مثل NOT_FOUND) — لا رسالة كاملة ولا أي قيم حساسة */
        let g = '';
        try {
          const eb = await r.json();
          if (eb && eb.error && eb.error.status) g = ':' + eb.error.status;
        } catch (e) {}
        lastError = 'http_' + r.status + g;
        /* 404 على النقطة الافتراضية = النموذج غير متاح — جرّب التالي؛
           أما مفتاح/حصة/شبكة فأبلغ عنها فوراً بلا تجربة إضافية */
        if (!customEp && r.status === 404) continue;
        return { failed: true, error: lastError };
      }
      const data = await r.json();
      geminiWorkingModel = model;
      const parsed = parseGeminiJson(data && data.candidates && data.candidates[0] &&
        data.candidates[0].content && data.candidates[0].content.parts &&
        data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text);
      if (!parsed) return { failed: true, error: 'bad_json' };
      /* score عند النموذج «درجة أمان» بينما نظامنا «درجة خطر» — نحوّل ونحرس التناقض بكلمة الحكم */
      const safety = (typeof parsed.score === 'number') ? Math.max(0, Math.min(100, parsed.score)) : 50;
      let risk = 100 - safety;
      const word = String(parsed.verdict || '');
      if (word.indexOf('خطر') !== -1) risk = Math.max(risk, 60);
      else if (word.indexOf('مشبوه') !== -1) risk = Math.max(risk, 30);
      else if (word.indexOf('آمن') !== -1 || word.indexOf('أمن') !== -1) risk = Math.min(risk, 29);
      return {
        provider: 'gemini',
        risk: Math.max(0, Math.min(100, risk)),
        reasons: (Array.isArray(parsed.reasons) ? parsed.reasons : [])
          .filter(x => typeof x === 'string' && x).slice(0, 3),
        officialDomain: (typeof parsed.official_domain === 'string' &&
          parsed.official_domain && parsed.official_domain !== 'null') ? parsed.official_domain : null,
        display: (typeof parsed.display === 'string' && parsed.display) ? parsed.display : null
      };
    } catch (e) {
      lastError = (e && e.name === 'AbortError') ? 'timeout' : 'network';
      /* نفاد السقف الزمني الكلي — لا محاولات إضافية حفاظاً على سرعة الفحص */
      if (Date.now() - t0 >= GEMINI_TOTAL_MS - 500) return { failed: true, error: lastError };
      continue;
    }
  }
  return { failed: true, error: lastError };
}

/* المرحلة 3: طبقة AI عامة (اختيارية) — تُستخدم فقط إن لم يُضبط مفتاح Gemini */
async function genericAiEvaluate(url, source, verdict) {
  const ep = process.env.PCS_AI_ENDPOINT;
  if (!ep) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.PCS_AI_KEY) headers['Authorization'] = 'Bearer ' + process.env.PCS_AI_KEY;
    const r = await fetch(ep, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url, source, verdict }),
      signal: ctl.signal
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    if (j && (typeof j.adjust === 'number' || typeof j.score === 'number')) {
      return {
        provider: 'generic',
        adjust: (typeof j.adjust === 'number') ? j.adjust : (j.score - verdict.score),
        reason: j.reason || null
      };
    }
    return null;
  } catch (e) { return null; }
}

async function aiEvaluate(url, source, verdict) {
  if (process.env.GEMINI_API_KEY) return geminiEvaluate(url, source, verdict);
  return genericAiEvaluate(url, source, verdict);
}

function applyAi(verdict, ai) {
  if (!ai || ai.failed) return verdict;
  let score, aiText, aiCode;
  if (ai.provider === 'gemini') {
    /* التحفظ: الأسوأ بين نتيجة القواعد المحلية والتحليل الذكي هو الحكم النهائي —
       المحرك المحلي يلتقط انتحال الجهات الموثقة فوراً، وGemini يضيف طبقة معرفية فوقه، ولا أحدهما يخفض الآخر. */
    score = Math.max(0, Math.min(100, Math.max(verdict.score, ai.risk)));
    aiText = '🤖 تحليل ذكي (Gemini): ' +
      (ai.reasons.length ? ai.reasons.join('؛ ') :
        (ai.risk >= 60 ? 'خطر مرتفع' : ai.risk >= 30 ? 'يستوجب الحذر' : 'لا مؤشرات خبيثة')) +
      ' — درجة الخطر الذكية ' + ai.risk + '/100';
    aiCode = 'AI_GEMINI';
  } else {
    score = Math.max(0, Math.min(100, verdict.score + ai.adjust));
    aiText = (ai.reason || 'تعديل طبقة الذكاء الاصطناعي السياقي') + ' (' + (ai.adjust >= 0 ? '+' : '') + ai.adjust + ')';
    aiCode = 'AI';
  }
  let level, levelText;
  if (score >= ENGINE.data.config.blockThreshold) { level = 'danger'; levelText = 'خطر'; }
  else if (score > ENGINE.data.config.safeMax) { level = 'caution'; levelText = 'مشبوه'; }
  else { level = 'safe'; levelText = 'آمن'; }
  const reasons = verdict.reasons.slice();
  reasons.push({ code: aiCode, text: aiText, weight: score - verdict.score });
  if (ai.provider === 'gemini' && ai.officialDomain && !verdict.comparison) {
    reasons.push({ code: 'AI_OFFICIAL', text: '🤖 النطاق الرسمي المحتمل للجهة المنتحلة: ' + ai.officialDomain, weight: 0 });
  }
  reasons.sort((a, b) => b.weight - a.weight);
  const out = Object.assign({}, verdict, { score, level, levelText, reasons, ai: true, aiProvider: ai.provider });
  if (ai.provider === 'gemini' && ai.officialDomain) out.aiOfficialDomain = ai.officialDomain;
  return out;
}

/* حالة الطبقة الذكية للاستجابة — attempted: الإعداد موجود في الخادم، error: رمز تشخيص آمن بلا تفاصيل حساسة */
function aiInfoOf(ai) {
  const attempted = Boolean(process.env.GEMINI_API_KEY || process.env.PCS_AI_ENDPOINT);
  if (!ai) return { used: false, provider: null, attempted, error: null };
  if (ai.failed) return { used: false, provider: null, attempted, error: ai.error };
  return { used: true, provider: ai.provider, attempted: true, error: null };
}

/* النتيجة كنص عربي جاهز للعرض داخل اختصار iOS (format=text) — أسطر قليلة بلا JSON */
function verdictToText(v) {
  if (!v || (!v.registrable && !v.host)) {
    return '⚠️ لم يصل رابط صحيح للحماية.\nانسخ الرابط كاملاً (من بدايته حتى نهايته) ثم أعد المحاولة، أو افحصه من الموقع مباشرة.';
  }
  const emoji = v.level === 'danger' ? '🔴' : v.level === 'caution' ? '🟡' : '🟢';
  const lines = [emoji + ' ' + v.levelText + ' (' + v.score + '/100) — ' + (v.registrable || v.host)];
  for (const r of (v.reasons || []).slice(0, 3)) lines.push('• ' + r.text);
  if (v.comparison && v.comparison.officialHost) lines.push('✅ الموقع الرسمي الصحيح: ' + v.comparison.officialHost);
  if (v.level === 'danger') lines.push('⛔ لا تفتح الرابط ولا تُدخل أي بيانات.');
  else if (v.level === 'caution') lines.push('⚠️ تقدّم بحذر — لا تُدخل بيانات حساسة.');
  else lines.push('الرابط يبدو مطابقاً لجهة معروفة — وابقَ متيقظاً دائماً.');
  lines.push('———');
  lines.push('فحص حصن · المحرك v' + ENGINE.version + (v.ai ? ' · تحليل ذكي 🤖' : ''));
  return lines.join('\n');
}

/* ============ المعالجات ============ */

async function scan(urlParam, source, fmt) {
  if (!urlParam) return { status: 400, body: { ok: false, error: 'missing url parameter' } };
  const t0 = Date.now();
  const src = normalizeSource(source);
  const verdict = ENGINE.analyze(urlParam, { source: src });
  const ai = await aiEvaluate(urlParam, src, verdict);
  const final = applyAi(verdict, ai);
  scanlog.push({
    ts: Date.now(),
    url: urlParam,
    host: final.registrable || final.host || '',
    score: final.score,
    level: final.level,
    source: src,
    ai: Boolean(ai && !ai.failed),
    aiProvider: (ai && !ai.failed) ? ai.provider : null
  });
  if (scanlog.length > LOG_CAP) scanlog.splice(0, scanlog.length - LOG_CAP);
  /* وضع النص: يستخدمه اختصار iOS — يعرض الرد مباشرة دون تحليل JSON */
  if (String(fmt || '').toLowerCase() === 'text') {
    return { status: 200, body: verdictToText(final), textResponse: true };
  }
  return {
    status: 200,
    body: {
      ok: true,
      engine: 'hisn-engine@' + ENGINE.version,
      source: src,
      verdict: final,
      display: ENGINE.buildDisplay(final),
      /* حقول مسطّحة للتوافق مع أي مستهلك يقرأ الحكم مباشرة — دون كسر عقد verdict الكامل */
      classification: final.levelText,
      safety_score: 100 - final.score,
      official_domain: final.aiOfficialDomain ||
        (final.comparison ? final.comparison.officialHost : null),
      ai: aiInfoOf(ai),
      timing: { ms: Date.now() - t0 }
    }
  };
}

function report(body) {
  if (!body || !body.url) return { status: 400, body: { ok: false, error: 'missing url' } };
  const entry = {
    id: 'R' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ts: Date.now(),
    url: String(body.url).slice(0, 2000),
    level: body.level || null,
    score: typeof body.score === 'number' ? body.score : null,
    note: String(body.note || '').slice(0, 500),
    source: normalizeSource(body.source),
    status: 'new'
  };
  reports.push(entry);
  if (reports.length > REPORTS_CAP) reports.splice(0, reports.length - REPORTS_CAP);
  return { status: 200, body: { ok: true, report: entry } };
}

function campaignClusters(entries) {
  const map = {};
  for (const e of entries) {
    if (e.level !== 'caution' && e.level !== 'danger') continue;
    const host = e.host || 'unknown';
    if (!map[host]) map[host] = { domain: host, detections: 0, maxScore: 0, levels: {}, sources: {} };
    const c = map[host];
    c.detections++;
    c.maxScore = Math.max(c.maxScore, e.score || 0);
    c.levels[e.level] = (c.levels[e.level] || 0) + 1;
    const s = e.source || 'direct';
    c.sources[s] = (c.sources[s] || 0) + 1;
  }
  return Object.values(map)
    .sort((a, b) => b.detections - a.detections || b.maxScore - a.maxScore);
}

function threats() {
  return {
    status: 200,
    body: {
      ok: true,
      generator: 'hisn-api@' + ENGINE.version,
      generatedAt: new Date().toISOString(),
      note: 'التجميع من ذاكرة هذه النسخة من الدالة (يُعاد بناؤه بعد إعادة النشر)',
      stats: {
        scans: scanlog.length,
        reports: reports.length,
        danger: scanlog.filter(e => e.level === 'danger').length,
        caution: scanlog.filter(e => e.level === 'caution').length
      },
      campaigns: campaignClusters(scanlog).slice(0, 50),
      /* الخصوصية: العرض العام يقتصر على النطاق دون عناوين URL الكاملة أو ملاحظات المبلّغين */
      recent: scanlog.slice(-100).reverse().map(function (e) {
        return { ts: e.ts, host: e.host, score: e.score, level: e.level, source: e.source };
      }),
      reports: reports.slice(-100).reverse().map(function (r) {
        return { id: r.id, ts: r.ts, url: r.url, level: r.level, score: r.score, source: r.source, status: r.status };
      })
    }
  };
}

function health() {
  return {
    status: 200,
    body: {
      ok: true,
      service: 'hisn-api',
      version: ENGINE.version,
      uptimeSec: Math.round((Date.now() - START) / 1000),
      scans: scanlog.length,
      reports: reports.length,
      aiHook: Boolean(process.env.PCS_AI_ENDPOINT || process.env.GEMINI_API_KEY),
      aiProviders: {
        gemini: Boolean(process.env.GEMINI_API_KEY),
        generic: Boolean(process.env.PCS_AI_ENDPOINT)
      },
      /* مؤشرات تشخيصية بلا أي قيم: هل المتغيرات الاختيارية مضافة؟ — تكشف من الخارج سبب http_404 */
      aiEndpointCustom: Boolean(process.env.PCS_GEMINI_ENDPOINT),
      aiModelOverride: Boolean(process.env.PCS_GEMINI_MODEL),
      /* النموذج الفعّال (التجاوز اليدوي أو آخر نموذج ناجح من السلسلة) — بلا أسرار */
      aiModel: process.env.PCS_GEMINI_MODEL || geminiWorkingModel || GEMINI_MODEL_CHAIN[0]
    }
  };
}

module.exports = { preflight, send, rateOk, normalizeSource, scan, report, threats, health };
