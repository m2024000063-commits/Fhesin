/*
 * حصن (Hisn) — محرك الكشف والتحليل
 * Hisn — detection engine (pure JS, بيئة محايدة)
 * يعمل في: Service Worker + Content Scripts + Node (الاختبارات)
 * لا يعتمد على أي مكتبة خارجية، ولا يرسل أي بيانات خارج الجهاز.
 */
(function (root) {
  'use strict';

  var DATA = root.PCS_DATA;
  /* في بيئة Node (الاختبارات): تحميل data.js تلقائياً إن لم يُحمَّل قبله */
  if (!DATA && typeof require === 'function' && typeof module !== 'undefined') {
    DATA = require('./data.js');
    root.PCS_DATA = DATA;
  }
  var CFG = DATA.config;

  /* ================= أدوات مساعدة ================= */

  function deHomoglyph(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      out += (DATA.homoglyphs[ch] !== undefined) ? DATA.homoglyphs[ch] : ch;
    }
    return out;
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = new Array(b.length + 1);
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var cur = [i];
      for (var j2 = 1; j2 <= b.length; j2++) {
        var cost = a[i - 1] === b[j2 - 1] ? 0 : 1;
        cur[j2] = Math.min(prev[j2] + 1, cur[j2 - 1] + 1, prev[j2 - 1] + cost);
      }
      prev = cur;
    }
    return prev[b.length];
  }

  /* استخراج النطاق المسجل (eTLD+1 مبسّط مع دعم اللواحق المركبة)
     إصلاح: عناوين IP تُعاد كما هي — كان الاستخراج يفكك 192.168.1.5 إلى «1.5»
     فيُحسب عمق نطاقات فرعية وهمي (+DEEPSUB) وتُبنى قاعدة الجدار الصلب على
     نطاق «1.5» غير صحيح. */
  function registrableDomain(host) {
    if (IP_RE.test(host)) return host;
    var labels = host.split('.').filter(function (l) { return l.length > 0; });
    if (labels.length <= 2) return labels.join('.');
    var last2 = labels.slice(-2).join('.');
    for (var i = 0; i < DATA.multiSuffixes.length; i++) {
      if (last2 === DATA.multiSuffixes[i]) {
        return labels.slice(-3).join('.');
      }
    }
    return last2;
  }

  /*
   * مطابقة مقطع اسم الجهة داخل label حدودياً — لتقليل الإيجابيات الكاذبة:
   * يُقبل: label === token، أو token محاط بشرطات، أو token في البداية/النهاية بحدود.
   */
  function tokenInLabel(label, token) {
    var idx = label.indexOf(token);
    if (idx === -1) return false;
    var before = idx === 0 ? '' : label[idx - 1];
    var after = (idx + token.length >= label.length) ? '' : label[idx + token.length];
    var okBefore = (before === '' || before === '-');
    var okAfter = (after === '' || after === '-');
    return okBefore && okAfter;
  }

  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  var IP_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  var NON_LATIN_RE = /[\u0400-\u04FF\u0370-\u03FF\u0590-\u05FF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u30FF]/;

  /* ================= المحرك الرئيسي ================= */

  function notScannable(rawUrl, why) {
    return {
      scannable: false,
      url: rawUrl,
      host: '', registrable: '', simulated: null,
      score: 0, level: 'na',
      levelText: why || 'غير قابلة للفحص',
      reasons: [{ code: 'NA', text: why || 'صفحة نظام أو ملف محلي — خارج نطاق الفحص', weight: 0 }]
    };
  }

  /*
   * analyze(rawUrl, opts) — الفحص الكامل للرابط.
   * يدعم وضع المحاكاة الديمو عبر بارامتر ?pcs_simulate=<domain> :
   * يقيّم النطاق المحدد في البارامتر بدلاً من النطاق الفعلي (لأغراض العرض دون تعديل DNS).
   * opts.source — سياق مصدر الرابط (المرحلة 1: الالتقاط السياقي):
   *   'search' | 'maps' | 'message' | 'sms' | 'chat' | 'direct' (افتراضي)
   */
  function analyze(rawUrl, opts) {
    opts = opts || {};
    var url;
    try { url = new URL(rawUrl); } catch (e) { return notScannable(rawUrl, 'رابط غير صالح'); }

    var scheme = url.protocol.replace(':', '');
    if (scheme !== 'http' && scheme !== 'https') {
      return notScannable(rawUrl, scheme === 'file' ? 'ملف محلي — خارج نطاق الفحص' : 'صفحة نظام — خارج نطاق الفحص');
    }

    var reasons = [];
    function add(code, text, weight) { reasons.push({ code: code, text: text, weight: weight }); return weight; }

    var host = (url.hostname || '').toLowerCase().replace(/\.$/, '');
    /* استخراج النطاق الخام كما ورد في النص (قبل أي تحويل IDNA إلى Punycode) */
    var rawHost = '';
    try {
      var rawPart = rawUrl.slice(rawUrl.indexOf('://') + 3);
      rawPart = rawPart.split(/[/?#]/)[0];
      var atIdx = rawPart.lastIndexOf('@');
      if (atIdx !== -1) rawPart = rawPart.slice(atIdx + 1);
      rawHost = rawPart.toLowerCase().replace(/\.$/, '');
    } catch (e) { rawHost = host; }

    /* وضع المحاكاة الديمو */
    var simulated = null;
    try {
      var sim = url.searchParams ? url.searchParams.get('pcs_simulate') : null;
      if (sim && /^[a-z0-9.\-]+$/i.test(sim)) simulated = sim.toLowerCase();
    } catch (e) { /* لا شيء */ }

    /* النطاق الخاضع للتقييم: الوهمي إن وجد، وإلا الفعلي */
    var evalHost = simulated || host;
    var evalReg = registrableDomain(evalHost);
    var evalLabels = evalHost.split('.').filter(function (l) { return l && l !== 'www'; });

    /* فحص إضافي على النطاق الخام (يلتقط Homoglyphs قبل تحويل IDNA) */
    var regs = [evalReg];
    var rawLabels = [];
    if (rawHost && rawHost !== evalHost) {
      regs.push(registrableDomain(rawHost));
      rawLabels = rawHost.split('.').filter(function (l) { return l && l !== 'www'; });
    }

    /* طبقة إزالة الحروف المتشابهة بصرياً قبل المطابقة — تلتقط انتحال punycode الممزوج (емiratesnbd-secure.com) */
    var labelSets = [evalLabels];
    if (rawLabels.length) labelSets.push(rawLabels);
    var dhEvalLabels = evalLabels.map(deHomoglyph);
    if (dhEvalLabels.join('.') !== evalLabels.join('.')) labelSets.push(dhEvalLabels);
    var dhRawLabels = rawLabels.map(deHomoglyph);
    if (dhRawLabels.length && dhRawLabels.join('.') !== rawLabels.join('.')) labelSets.push(dhRawLabels);
    var typoHosts = regs.slice();
    for (var ri = 0; ri < regs.length; ri++) {
      var dhReg = deHomoglyph(regs[ri]);
      if (typoHosts.indexOf(dhReg) === -1) typoHosts.push(dhReg);
    }

    var score = 0;

    if (simulated) add('SIM', 'وضع المحاكاة: التقييم على النطاق «' + simulated + '»', 0);

    /* --- مطابقة الجهات المحمية (exact → homoglyph → typo → brand) --- */
    var entities = DATA.protectedEntities;
    var hit = null, kind = null, n = entities.length, i, ent, dist, maxD, tokenDist = 0;

    for (i = 0; i < n; i++) {
      if (regs.indexOf(entities[i].domain) !== -1) { hit = entities[i]; kind = 'official'; break; }
    }
    if (!hit) {
      for (i = 0; i < n; i++) {
        ent = entities[i];
        var homoMatch = regs.some(function (rg) {
          return deHomoglyph(rg) === ent.domain && rg !== ent.domain;
        });
        if (homoMatch) { hit = ent; kind = 'homoglyph'; break; }
      }
    }
    if (!hit) {
      for (i = 0; i < n; i++) {
        ent = entities[i];
        if (ent.domain.length < 5) continue; // تجنب حجب نطاقات رسمية قصيرة بفروق ضئيلة
        maxD = (ent.domain.length >= CFG.typoLongLen) ? CFG.typoMaxDistanceLong : CFG.typoMaxDistanceShort;
        for (var th = 0; th < typoHosts.length; th++) {
          if (Math.abs(ent.domain.length - typoHosts[th].length) > maxD) continue;
          dist = levenshtein(typoHosts[th], ent.domain);
          if (dist > 0 && dist <= maxD) { hit = ent; kind = 'typo'; break; }
        }
        if (hit) break;
      }
    }
    if (!hit) {
      outer:
      for (i = 0; i < n; i++) {
        ent = entities[i];
        for (var t = 0; t < ent.tokens.length; t++) {
          var tok = ent.tokens[t];
          if (tok.length < CFG.brandMinTokenLen) continue;
          for (var s = 0; s < labelSets.length; s++) {
            var labelGroup = labelSets[s];
            for (var l = 0; l < labelGroup.length; l++) {
              if (tokenInLabel(labelGroup[l], tok)) { hit = ent; kind = 'brand'; break outer; }
            }
          }
        }
      }
    }

    /* طبقة رابعة: تشابه إملائي على مستوى مقاطع النطاق — تلتقط الخطأ المركب مثل
       emiratsnbd-secure-verify.com (حذف حرف من اسم الجهة + لاحقة ثقة خادعة)،
       حيث تفشل مطابقة النطاق المسجل الكامل ومطابقة الاسم الحرفية معاً.
       حماية من الإيجابيات الكاذبة: المقاطع القصيرة (أقل من tokenTypoMinLen)
       مستثناة تماماً، والمسافة الأطول (2) تُقبل فقط للمقاطع الطويلة. */
    if (!hit) {
      outer2:
      for (i = 0; i < n; i++) {
        ent = entities[i];
        for (var s2 = 0; s2 < labelSets.length; s2++) {
          var labelGroup2 = labelSets[s2];
          for (var l2 = 0; l2 < labelGroup2.length; l2++) {
            var parts = labelGroup2[l2].split('-');
            for (var p2 = 0; p2 < parts.length; p2++) {
              var ftok = parts[p2];
              for (var t2 = 0; t2 < ent.tokens.length; t2++) {
                var off = ent.tokens[t2];
                var minLen = Math.min(ftok.length, off.length);
                if (minLen < CFG.tokenTypoMinLen) continue;
                var maxTD = (minLen >= CFG.tokenTypoLongLen) ? CFG.tokenTypoMaxDistanceLong : CFG.tokenTypoMaxDistanceShort;
                if (Math.abs(ftok.length - off.length) > maxTD) continue;
                var dTok = levenshtein(ftok, off);
                if (dTok > 0 && dTok <= maxTD) { hit = ent; kind = 'typoToken'; tokenDist = dTok; break outer2; }
              }
            }
          }
        }
      }
    }

    if (hit && kind === 'official') {
      add('OFFICIAL', 'نطاق رسمي موثق: ' + hit.name, -200);
    } else if (hit && kind === 'homoglyph') {
      score += add('HOMOGLYPH', 'انتحال هوية «' + hit.name + '» بحروف متشابهة بصرياً — الموقع الرسمي الصحيح: ' + hit.domain, CFG.weights.homoglyph);
    } else if (hit && kind === 'typo') {
      score += add('TYPO', 'النطاق قريب جداً من موقع «' + hit.name + '» الرسمي (بفارق ' + dist + ' حرف فقط) — الموقع الرسمي الصحيح: ' + hit.domain, CFG.weights.typoSquat);
    } else if (hit && kind === 'typoToken') {
      score += add('TYPO', 'النطاق يحتوي اسم «' + hit.name + '» بفارق ' + tokenDist + ' حرف داخل تركيبة نطاق مزيّفة — الموقع الرسمي الصحيح: ' + hit.domain, CFG.weights.typoSquat);
    } else if (hit && kind === 'brand') {
      score += add('BRAND', 'النطاق يستخدم اسم «' + hit.name + '» لكنه ليس موقعه الرسمي — الموقع الرسمي الصحيح: ' + hit.domain, CFG.weights.brandMisuse);
    }

    /* بيانات المقارنة الفورية بين الرابط المشبوه والموقع الرسمي (تُعرض في كل الواجهات) */
    var shownHost = (!simulated && rawHost && rawHost !== evalHost) ? rawHost : evalHost;
    var comparison = (hit && kind !== 'official') ? buildComparison(hit, kind, shownHost, evalReg, (kind === 'typoToken') ? tokenDist : dist, [shownHost, evalHost]) : null;

    /* --- مختصر روابط --- */
    if (DATA.shorteners.indexOf(evalReg) !== -1) {
      score += add('SHORTENER', 'رابط مختصر يخفي الوجهة الحقيقية', CFG.weights.shortener);
    }

    /* --- Punycode / أحرف غير لاتينية --- */
    var hasPuny = evalLabels.some(function (l) { return l.indexOf('xn--') === 0; });
    if (hasPuny) {
      score += add('PUNYCODE', 'النطاق مشفر بصيغة Punycode (xn--) — تُستخدم غالباً في الانتحال البصري', CFG.weights.punycode);
    }
    if (!hasPuny && NON_LATIN_RE.test(rawHost) && !simulated) {
      score += add('NONLATIN', 'النطاق يحتوي أحرفاً غير لاتينية قد تُستخدم لانتحال الهوية', CFG.weights.nonLatin);
    }

    /* --- عنوان IP بدل النطاق --- */
    if (IP_RE.test(evalHost)) {
      score += add('IPHOST', 'الرابط يشير إلى عنوان IP مباشرة بدلاً من نطاق موثوق', CFG.weights.ipHost);
    }

    /* --- معلومات مستخدم في الرابط (@) --- */
    if (url.username) {
      score += add('USERINFO', 'الرابط يحتوي على «@» لتخفي الوجهة الحقيقية عن المستخدم', CFG.weights.userinfo);
    }

    /* --- كلمات مفتاحية خطرة (في النطاق والمسار فقط، وليس البارامترات) --- */
    var kwText = evalHost + '/' + safeDecode(url.pathname);
    var kwScore = 0, kwHits = [];
    for (var k = 0; k < DATA.riskyKeywords.length; k++) {
      if (kwText.indexOf(DATA.riskyKeywords[k].kw) !== -1) {
        kwScore += DATA.riskyKeywords[k].w;
        kwHits.push(DATA.riskyKeywords[k].kw);
      }
    }
    if (kwScore > 0) {
      kwScore = Math.min(kwScore, CFG.keywordCap);
      score += kwScore;
      add('KEYWORDS', 'كلمات مفتاحية مرتبطة بالاحتيال المالي: ' + kwHits.join('، '), kwScore);
    }

    /* --- الخطأ المركب: انتحال جهة معروفة + كلمات ثقة خادعة في نطاق واحد --- */
    if (hit && kind !== 'official' && kwScore > 0 && CFG.weights.compoundPenalty > 0) {
      score += add('COMPOUND', 'نمط احتيال مركّب: انتحال «' + hit.name + '» مع كلمات ثقة خادعة (مثل secure / verify / login) — من أقوى مؤشرات صفحات الاحتيال', CFG.weights.compoundPenalty);
    }

    /* --- الخطأ المركب الثاني: عنوان IP مباشر + كلمات خطرة — نمط صفحات جمع البيانات الكلاسيكي --- */
    if (IP_RE.test(evalHost) && kwScore > 0 && CFG.weights.ipKeywordCompound > 0) {
      score += add('COMPOUND', 'عنوان IP مباشر مع كلمات مرتبطة بالاحتيال (مثل otp / login) — نمط كلاسيكي لصفحات جمع بيانات البطاقات والرموز', CFG.weights.ipKeywordCompound);
    }

    /* --- عمق النطاقات الفرعية --- */
    var regParts = evalReg.split('.').length;
    if (evalLabels.length - regParts >= 2) {
      score += add('DEEPSUB', 'عدد كبير من النطاقات الفرعية — نمط شائع في إخفاء الوجهة', CFG.weights.deepSubdomains);
    }

    /* --- لاحقة خطرة --- */
    var tld = evalLabels[evalLabels.length - 1];
    if (evalLabels.length && DATA.suspiciousTlds.indexOf(tld) !== -1) {
      score += add('TLD', 'لاحقة نطاق عالية الخطورة (.' + tld + ') — شائعة في حملات الاحتيال', CFG.weights.suspiciousTld);
    }

    /* --- اتصال غير مشفر --- */
    if (scheme === 'http') {
      score += add('HTTP', 'اتصال غير مشفر (HTTP) — يمكن اعتراض البيانات', CFG.weights.insecureHttp);
    }

    /* --- سياق المصدر (المرحلة 1: الالتقاط السياقي) --- */
    var source = opts.source || 'direct';
    if (source === 'message' || source === 'sms' || source === 'chat' || source === 'whatsapp') {
      score += add('SOURCE', 'الرابط وصل عبر رسالة — أحد أشيع مصادر الاحتيال المالي', 6);
    } else if (source === 'maps' && score >= 15) {
      score += add('SOURCE', 'رابط داخل بطاقة خريطة — تحقق من الجهة قبل أي إجراء', 5);
    }

    /* --- الحكم النهائي --- */
    score = Math.max(0, Math.min(100, score));
    var level, levelText;
    if (score >= CFG.blockThreshold) { level = 'danger'; levelText = 'خطر'; }
    else if (score > CFG.safeMax) { level = 'caution'; levelText = 'مشبوه'; }
    else { level = 'safe'; levelText = 'آمن'; }

    reasons.sort(function (a, b) { return b.weight - a.weight; });

    return {
      scannable: true,
      url: rawUrl,
      host: evalHost,
      registrable: evalReg,
      simulated: simulated,
      source: opts.source || 'direct',
      score: score,
      level: level,
      levelText: levelText,
      reasons: reasons,
      comparison: comparison
    };
  }

  /* ================= المقارنة الفورية مع الموقع الرسمي ================= */

  /*
   * تقسيم النطاقين إلى: بداية مشتركة + وسط مختلف + نهاية مشتركة،
   * لتعرض الواجهات الجزء المُزيَّف مضاءً مقابل الجزء الرسمي — فوراً ودون أي طلب شبكة.
   */
  function diffParts(fake, official) {
    var p = 0;
    while (p < fake.length && p < official.length && fake[p] === official[p]) p++;
    var s = 0;
    while (s < (fake.length - p) && s < (official.length - p) &&
           fake[fake.length - 1 - s] === official[official.length - 1 - s]) s++;
    return {
      prefix: fake.slice(0, p),
      fakeMid: fake.slice(p, fake.length - s),
      officialMid: official.slice(p, official.length - s),
      suffix: fake.slice(fake.length - s)
    };
  }

  function buildComparison(ent, kind, shownHost, evalReg, dist, scanHosts) {
    var c = {
      entity: ent.name,
      kind: kind,
      kindText: kind === 'homoglyph' ? 'حروف متشابهة بصرياً مُستبدلة'
        : kind === 'typo' ? 'تشابه إملائي (Typosquatting)'
        : kind === 'typoToken' ? 'تشابه إملائي في اسم الجهة (Typosquatting)'
        : 'استخدام اسم الجهة في نطاق غير رسمي',
      fakeHost: shownHost,
      officialHost: ent.domain,
      officialUrl: 'https://' + ent.domain
    };
    if (kind === 'typo' || kind === 'typoToken') c.distance = (typeof dist === 'number') ? dist : levenshtein(evalReg, ent.domain);
    if (kind === 'homoglyph') {
      c.substituted = [];
      var seen = {};
      var hosts = scanHosts || [shownHost];
      for (var h = 0; h < hosts.length; h++) {
        var hh = hosts[h] || '';
        for (var i = 0; i < hh.length; i++) {
          var ch = hh[i];
          if (DATA.homoglyphs[ch] !== undefined && !seen[ch]) {
            seen[ch] = true;
            c.substituted.push({ from: ch, to: DATA.homoglyphs[ch] });
          }
        }
      }
    }
    c.diff = diffParts(shownHost, ent.domain);
    return c;
  }

  /*
   * compare(rawUrl) — المقارنة الجاهزة بين رابط مشبوه وموقعه الرسمي المطابق.
   * ترجع null إن لم يوجد انتحال (رابط عادي أو نطاق رسمي نفسه).
   */
  function compare(rawUrl) {
    var res = analyze(rawUrl, {});
    if (!res || !res.comparison) return null;
    return Object.assign({}, res.comparison, {
      score: res.score,
      level: res.level,
      levelText: res.levelText
    });
  }

  /* ================= فحص النماذج (Content Script) ================= */

  var SENSITIVE_PATTERNS = [
    { re: /otp|verification|verifycode|smscode/i, w: 12, label: 'رمز تحقق (OTP)' },
    { re: /card|pan|ccnum|cardnumber/i, w: 10, label: 'رقم بطاقة' },
    { re: /cvv|cvc|securitycode/i, w: 10, label: 'رمز CVV' },
    { re: /pin\b|pincode/i, w: 10, label: 'الرقم السري PIN' },
    { re: /iban|accountno|accountnum/i, w: 10, label: 'رقم حساب / IBAN' }
  ];

  /*
   * analyzeForms(info, ctx) — تقييم خطر نموذج على الصفحة الحالية.
   * info: { passwords: عدد حقول كلمة المرور, fieldNames: [أسماء/معرفات الحقول], crossOrigin: bool, hasAction: bool }
   * ctx:  { pageScore: درجة الصفحة الحالية }
   */
  function analyzeForms(info, ctx) {
    var reasons = [];
    var score = 0;
    function add(text, w) { score += w; reasons.push({ code: 'FORM', text: text, weight: w }); }

    if (info.passwords > 0) add('النموذج يطلب كلمة مرور', 40);

    var found = {};
    var names = (info.fieldNames || []).join(' ');
    for (var i = 0; i < SENSITIVE_PATTERNS.length; i++) {
      var p = SENSITIVE_PATTERNS[i];
      if (p.re.test(names) && !found[p.label]) {
        found[p.label] = true;
        add('النموذج يطلب ' + p.label, p.w);
      }
    }

    if (info.crossOrigin) add('النموذج يرسل البيانات إلى موقع آخر غير الموقع الحالي', 20);

    var pagePart = ctx && ctx.pageScore ? Math.round(ctx.pageScore * 0.25) : 0;
    if (pagePart > 0) add('الصفحة نفسها مصنفة كمشبوهة (+' + pagePart + ')', pagePart);

    score = Math.min(100, score);
    var level, levelText;
    if (score >= 45) { level = 'danger'; levelText = 'خطر'; }
    else if (score >= 20) { level = 'caution'; levelText = 'مشبوه'; }
    else { level = 'safe'; levelText = 'آمن'; }

    reasons.sort(function (a, b) { return b.weight - a.weight; });
    return { score: score, level: level, levelText: levelText, reasons: reasons };
  }

  /* ================= نص العرض الجاهز ================= */

  /*
   * buildDisplay(v) — نص عربي جاهز للعرض في تنبيهات iOS Shortcuts والإشعارات.
   * مثال: «🔴 خطر — الدرجة 73/100» ثم أهم 3 أسباب.
   */
  function buildDisplay(v) {
    var icons = { safe: '🟢', caution: '🟡', danger: '🔴', na: '⚪' };
    var icon = (v && icons[v.level]) || '⚪';
    var head = icon + ' ' + ((v && v.levelText) || 'غير معروف') + ' — الدرجة ' + ((v && v.score) || 0) + '/100';
    var top = [];
    if (v && v.reasons) {
      for (var i = 0; i < v.reasons.length && top.length < 3; i++) {
        if (v.reasons[i].weight > 0) top.push('• ' + v.reasons[i].text);
      }
    }
    return top.length ? head + '\n' + top.join('\n') : head;
  }

  /* ================= الواجهة العامة ================= */

  var ENGINE = {
    version: DATA.version,
    analyze: analyze,
    compare: compare,
    analyzeForms: analyzeForms,
    buildDisplay: buildDisplay,
    registrableDomain: registrableDomain,
    deHomoglyph: deHomoglyph,
    levenshtein: levenshtein,
    data: DATA,

    levels: {
      safe: { text: 'آمن', color: '#16a34a', icon: '✓' },
      caution: { text: 'مشبوه', color: '#d97706', icon: '!' },
      danger: { text: 'خطر', color: '#dc2626', icon: '✕' },
      na: { text: 'غير قابل للفحص', color: '#6b7280', icon: '–' }
    }
  };

  root.PCS_ENGINE = ENGINE;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ENGINE;
  }
})(typeof self !== 'undefined' ? self : globalThis);

