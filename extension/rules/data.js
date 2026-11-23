/*
 * حصن (Hisn) — قاعدة البيانات المحلية للفحص
 * Hisn — local rules data (offline, privacy-first)
 * تُحمَّل قبل engine.js في كل من: Service Worker و Content Scripts واختبارات Node
 */
(function (root) {
  'use strict';

  var PCS_DATA = {
    version: '2.3.0',

    /*
     * الجهات المحمية: نطاقات رسمية موثقة (الإمارات).
     * tokens = مقاطع اسم الجهة التي نبحث عنها داخل أسماء النطاقات المشبوهة.
     * أي ظهور لهذا المقطع في نطاق ليس النطاق الرسمي = إشارة انتحال هوية.
     */
    protectedEntities: [
      // ===== البنوك =====
      { name: 'مصرف الإمارات دبي الوطني (Emirates NBD)', domain: 'emiratesnbd.com', tokens: ['emiratesnbd', 'enbd'] },
      { name: 'بنك أبوظبي الأول (ADCB)', domain: 'adcb.com', tokens: ['adcb'] },
      { name: 'بنك أبوظبي الإسلامي (ADIB)', domain: 'adib.ae', tokens: ['adib'] },
      { name: 'بنك الإمارات الوطني (FAB)', domain: 'bankfab.com', tokens: ['bankfab', 'fab'] },
      { name: 'بنك دبي الإسلامي (DIB)', domain: 'dib.ae', tokens: ['dib'] },
      { name: 'بنك رأس الخيمة (RAKBANK)', domain: 'rakbank.ae', tokens: ['rakbank'] },
      { name: 'مصرف المشرق (Mashreq)', domain: 'mashreq.com', tokens: ['mashreq'] },
      { name: 'البنك التجاري الدولي (CBI)', domain: 'cbi.ae', tokens: ['cbi'] },
      { name: 'بنك الشارقة الإسلامي (SIB)', domain: 'sib.ae', tokens: ['sib'] },
      { name: 'بنك الإمارات الإسلامي', domain: 'emiratesislamic.ae', tokens: ['emiratesislamic'] },
      { name: 'بنك WIO', domain: 'wio.ae', tokens: ['wio'] },
      { name: 'بنك ZAND', domain: 'zand.ae', tokens: ['zand'] },
      { name: 'البنك المركزي الإماراتي (CBUAE)', domain: 'centralbank.ae', tokens: ['centralbank', 'cbuae'] },
      { name: 'HSBC الإمارات', domain: 'hsbc.ae', tokens: ['hsbc'] },

      // ===== الجهات الحكومية =====
      { name: 'البوابة الرسمية لحكومة الإمارات', domain: 'u.ae', tokens: [] },
      { name: 'بوابة أبوظبي الرسمية', domain: 'abudhabi.ae', tokens: ['abudhabi'] },
      { name: 'بوابة دبي الرسمية', domain: 'dubai.ae', tokens: ['dubai'] },
      { name: 'شرطة أبوظبي', domain: 'adpolice.gov.ae', tokens: ['adpolice'] },
      { name: 'شرطة دبي', domain: 'dubaipolice.gov.ae', tokens: ['dubaipolice'] },
      { name: 'الهيئة الاتحادية للهوية والجنسية والجمارك وأمن المنافذ (ICP)', domain: 'icp.gov.ae', tokens: ['icp', 'emiratesid'] },
      { name: 'وزارة الداخلية', domain: 'moi.gov.ae', tokens: ['moigov'] },
      { name: 'وزارة العدل', domain: 'moj.gov.ae', tokens: ['mojgov'] },
      { name: 'وزارة الصحة والوقاية من الأمراض (MOHAP)', domain: 'mohap.gov.ae', tokens: ['mohap'] },
      { name: 'وزارة المالية', domain: 'mof.gov.ae', tokens: ['mofgov'] },
      { name: 'البنك المركزي — خدمات المستهلك', domain: 'cbuae.gov.ae', tokens: [] },

      // ===== الاتصالات والخدمات =====
      { name: 'e& (اتصالات)', domain: 'etisalat.ae', tokens: ['etisalat', 'eand'] },
      { name: 'du', domain: 'du.ae', tokens: ['duae'] }
    ],

    /*
     * لاحقات النطاقات المركبة — لاستخراج "النطاق المسجل" (registrable domain) بشكل صحيح،
     * مثال: www.adpolice.gov.ae  →  adpolice.gov.ae (وليس gov.ae)
     */
    multiSuffixes: [
      'gov.ae', 'com.ae', 'net.ae', 'org.ae', 'ac.ae', 'mil.ae', 'sch.ae',
      'gov.sa', 'com.sa', 'edu.sa', 'com.eg', 'gov.eg', 'com.jo', 'com.kw',
      'gov.qa', 'com.qa', 'gov.om', 'com.om', 'gov.bh', 'com.bh',
      'co.uk', 'org.uk', 'com.tr', 'com.au', 'co.in', 'com.pk'
    ],

    /* خدمات تقصير الروابط */
    shorteners: [
      'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly',
      'shorturl.at', 'rebrand.ly', 'rb.gy', 'tiny.cc', 'ow.ly', 'bl.ink',
      's.id', 'shorte.st', 'clck.ru', 'shrtco.de', 't.ly', 'lnkd.in',
      'v.gd', 'urlz.fr', 'soo.gd', 'x.gd'
    ],

    /* نطاقات عالية الخطورة (شائعة في حملات الاحتيال) */
    suspiciousTlds: [
      'zip', 'mov', 'top', 'xyz', 'click', 'link', 'gq', 'tk', 'ml', 'cf',
      'work', 'rest', 'loan', 'men', 'mom', 'party', 'review', 'science',
      'stream', 'download', 'racing', 'icu', 'cfd', 'sbs', 'cyou', 'buzz',
      'monster', 'quest', 'bond', 'country', 'kim', 'bar'
    ],

    /*
     * كلمات مفتاحية عالية الخطورة تُفحص داخل النطاق والمسار (وليس البارامترات)
     * الوزن يعكس ارتباطها الكلامي بحملات الاحتيال المالي.
     */
    riskyKeywords: [
      { kw: 'otp', w: 12 }, { kw: 'cashback', w: 12 }, { kw: 'prize', w: 12 },
      { kw: 'winner', w: 12 }, { kw: 'lottery', w: 12 }, { kw: 'password', w: 10 },
      { kw: 'payment', w: 10 }, { kw: 'wallet', w: 10 }, { kw: 'refund', w: 10 },
      { kw: 'fines', w: 10 }, { kw: 'penalty', w: 10 }, { kw: 'login', w: 8 },
      { kw: 'signin', w: 8 }, { kw: 'verify', w: 8 },
      /* ملاحظة إصلاح: كانت كلمة «verify-» مدرجة بجانب «verify» فتحتسب التكرار مرتين
         في النطاقات مثل verify-secure.com (‎+16 لكلمة واحدة) — أُزيلت لأن
         «verify» يغطي كل الأشكال، والشرطة ليست شرطاً. */
      { kw: 'update', w: 8 }, { kw: 'confirm', w: 8 }, { kw: 'account', w: 8 },
      { kw: 'billing', w: 8 }, { kw: 'invoice', w: 6 }, { kw: 'secure', w: 6 },
      { kw: 'security', w: 6 }, { kw: 'ibank', w: 8 }, { kw: 'netbanking', w: 8 },
      { kw: 'cancel', w: 5 }, { kw: 'urgent', w: 6 }, { kw: 'suspend', w: 8 }
    ],

    /*
     * خريطة الحروف المتشابهة بصرياً (Homoglyphs) المستخدمة في انتحال هوية النطاقات:
     * حروف سيريلية/يونانية تشبه الحروف اللاتينية.
     */
    homoglyphs: {
      'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
      'к': 'k', 'м': 'm', 'т': 't', 'н': 'h', 'в': 'b', 'і': 'i', 'ѕ': 's',
      'ԁ': 'd', 'ɡ': 'g', 'ј': 'j', 'ο': 'o', 'α': 'a', 'ε': 'e', 'ρ': 'p',
      'τ': 't', 'κ': 'k', 'ν': 'v', 'ι': 'i'
    },

    /* عتبات التقييم والأوزان */
    config: {
      safeMax: 24,          // أقل من أو يساوي: آمن
      blockThreshold: 60,   // درجة الحجب الفوري للتنقل (فوق safeMax وحتى العتبة: مشبوه)
      typoMaxDistanceShort: 2,   // مسافة تحرير مسموحة للنطاقات القصيرة
      typoMaxDistanceLong: 3,    // للنطاقات الطويلة (>= 14 حرفاً)
      typoLongLen: 14,
      keywordCap: 32,       // سقف مجموع الكلمات المفتاحية
      brandMinTokenLen: 3,  // أقل طول لمقطع اسم الجهة
      tokenTypoMinLen: 5,   // أقل طول لمقطع نطاق يُفحص بمسافة تحرير — يمنع الإيجابيات الكاذبة للمقاطع القصيرة
      tokenTypoLongLen: 6,  // من هذا الطول فصاعداً تُقبل المسافة الأطول
      tokenTypoMaxDistanceShort: 1, // مسافة تحرير مقاطع أسماء الجهات القصيرة
      tokenTypoMaxDistanceLong: 2,  // مسافة تحرير مقاطع الأسماء الطويلة — يلتقط الخطأ المركب (حذف حرف + لاحقة ثقة)
      weights: {
        brandMisuse: 45,
        compoundPenalty: 8,   // عقوبة اجتماع انتحال جهة معروفة مع كلمات ثقة خادعة (مثل secure / verify)
        ipKeywordCompound: 15, // عقوبة اجتماع عنوان IP مباشر مع كلمات خطرة (otp/login) — نمط صفحات جمع البيانات الكلاسيكي
        typoSquat: 62,
        homoglyph: 60,
        shortener: 30,
        punycode: 25,
        ipHost: 30,
        userinfo: 45,   // خدعة «@» (bank.com@evil.xyz) نمط انتحال كلاسيكي — كانت 35 فتظل «مشبوه» وهي أقوى مؤشرات الخطر
        deepSubdomains: 8,
        suspiciousTld: 15,
        insecureHttp: 6,
        nonLatin: 40
      }
    },

    /*
     * نقطة ربط الخادم المنشور على Vercel (أو أي نشر لـ api/):
     * الإضافة تعمل محلياً 100% افتراضياً، وعند تفعيل «وضع السحابة» من الإعدادات
     * الصق رابط موقعك المنشور (مثل https://your-app.vercel.app) في حقل العنوان.
     */
    cloud: {
      enabled: false,
      endpoint: '',
      timeoutMs: 2500
    },

    /* محركات البحث المدعومة لوسم النتائج */
    searchEngines: {
      'www.google.': { resultLinks: '#search a[href], #rso a[href], #tads a[href]' },
      'www.bing.com': { resultLinks: 'li.b_algo a[href]' },
      'duckduckgo.com': { resultLinks: 'article a[href], a.result__a' },
      'search.brave.com': { resultLinks: '.snippet a[href]' }
    }
  };

  root.PCS_DATA = PCS_DATA;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PCS_DATA;
  }
})(typeof self !== 'undefined' ? self : globalThis);
