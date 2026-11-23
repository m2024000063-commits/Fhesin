'use strict';
/*
 * حصن (Hisn) — اختبارات البدائل الأربعة على الهاتف: node scripts/test_mobile.js
 * يتحقق أن فكرة الاختصارات أُزيلت نهائياً، وأن البدائل الأربعة مكتملة وسليمة البنية:
 *  1) الإضافة الصامتة (annotator.js + manifest v3/v2 + popup)
 *  2) معترض الروابط (مشروع Android كامل: manifest + Kotlin + Gradle)
 *  3) مراقب الإشعارات (NotificationListenerService)
 *  4) فلتر SMS الرسمي (ILMessageFilterExtension + plists + entitlements)
 * صفر dependencies: تحقق بنية XML بمحلل يدوي، وتوازن الأقواس لSwift/Kotlin،
 * وnode --check لكل ملفات JS، وJSON.parse لملفات JSON، وقراءة plists بصيغة ثنائية.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.error('  FAIL: ' + name + (detail ? ' — ' + detail : ''));
}

const ROOT = path.join(__dirname, '..');
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

/* ============ 1) إزالة الاختصارات نهائياً ============ */
{
  check('حذف api/shortcut.js نهائياً', !exists('api/shortcut.js'));
  check('حذف مجلد public/shortcut نهائياً', !exists('public/shortcut'));

  const vercel = JSON.parse(read('vercel.json'));
  const vtxt = JSON.stringify(vercel);
  check('vercel.json بلا rewrites للاختصارات', vtxt.indexOf('shortcut') === -1);
  check('vercel.json تحفظ ترويسات CORS', Array.isArray(vercel.headers) && vercel.headers.length === 1);

  const idx = read('public/index.html');
  check('index.html بلا قسم الاختصارات', idx.indexOf('id="shortcut"') === -1);
  check('index.html بلا أزرار تثبيت الاختصار', idx.indexOf('installClip') === -1 &&
    idx.indexOf('installShare') === -1 && idx.indexOf('installFile') === -1);
  check('index.html بلا روابط iCloud', idx.indexOf('HISN_ICLOUD_LINKS') === -1);
  check('index.html يحمل قسم البدائل الأربعة', idx.indexOf('id="mobile"') !== -1);
  const altCount = (idx.match(/class="altcard/g) || []).length;
  check('index.html — أربع بطاقات بدائل', altCount === 4, 'الفعلي ' + altCount);

  const readme = read('README.md');
  /* التعليق التاريخي على الإزالة مسموح — الممنوع هو بقاء دليل التثبيت أو صف API */
  check('README بلا دليل تثبيت الاختصارات',
    ['اللمس الخلفي', 'استيراد الاختصارات غير الموقّعة', 'نسخ رابط iCloud', '.shortcut', 'الوصفة اليدوية']
      .every(k => readme.indexOf(k) === -1));
  check('README يذكر البدائل الأربعة', ['الإضافة الصامتة', 'معترض الروابط', 'مراقب الإشعارات', 'فلتر الرسائل النصية']
    .every(k => readme.indexOf(k) !== -1));

  const core = read('api/_lib/core.js');
  check('core.js أزال مصدر shortcut', core.indexOf("'shortcut'") === -1);
  check('core.js أضاف مصدري interceptor وnotification',
    core.indexOf("'interceptor'") !== -1 && core.indexOf("'notification'") !== -1);

  const apiDir = fs.readdirSync(path.join(ROOT, 'api')).join(',');
  check('api/ لم يعد يحوي shortcut.js', apiDir.indexOf('shortcut') === -1);
}

/* ============ 2) البديل 1 — الإضافة الصامتة ============ */
{
  const ann = read('extension/content/annotator.js');
  check('annotator.js موجود', ann.length > 3000);
  check('annotator.js يعمل بالوضع الصامت silentDots', ann.indexOf('silentDots') !== -1);
  check('annotator.js يضع نقطة آمنة', ann.indexOf('pcs-dot-safe') !== -1);
  check('annotator.js يضع نقطة خطر', ann.indexOf('pcs-dot-danger') !== -1);
  check('annotator.js يضع نقطة وسطية', ann.indexOf('pcs-dot-caution') !== -1);
  check('annotator.js يراقب المحتوى الديناميكي MutationObserver', ann.indexOf('MutationObserver') !== -1);
  check('annotator.js يفك روابط البحث جوجل/بينج', ann.indexOf('/url') !== -1 && ann.indexOf('bing.com') !== -1);
  check('annotator.js فحص محلي بالكامل — لا fetch', ann.indexOf('fetch(') === -1);

  const css = read('extension/content/content.css');
  check('content.css يحوي أنماط النقاط', css.indexOf('.pcs-dot') !== -1 &&
    css.indexOf('pcs-pulse') !== -1);

  const m3 = JSON.parse(read('extension/manifest.json'));
  check('manifest v3 يحمل annotator.js', JSON.stringify(m3.content_scripts).indexOf('annotator.js') !== -1);
  check('manifest v3 الإصدار 2.3.0', m3.version === '2.3.0');

  const m2 = JSON.parse(read('extension/manifest.v2.json'));
  check('manifest v2 صيغة MV2', m2.manifest_version === 2);
  check('manifest v2 خلفية scripts بلا service worker',
    Array.isArray(m2.background && m2.background.scripts) && !m2.background.service_worker);
  check('manifest v2 يحمل annotator.js', JSON.stringify(m2.content_scripts).indexOf('annotator.js') !== -1);
  check('manifest v2 معرف gecko', !!(m2.browser_specific_settings && m2.browser_specific_settings.gecko &&
    m2.browser_specific_settings.gecko.id));
  check('background.html للمتغاير MV2 موجود ويحمل المحرك',
    exists('extension/background/background.html') &&
    read('extension/background/background.html').indexOf('rules/engine.js') !== -1);

  const sw = read('extension/background/service-worker.js');
  check('service-worker يحمي importScripts لـ MV2', sw.indexOf("typeof importScripts === 'function'") !== -1);
  check('service-worker يحوي silentDots الافتراضي', sw.indexOf('silentDots: true') !== -1);

  const popup = read('extension/popup/popup.html');
  check('popup يحوي مفتاح الوضع الصامت', popup.indexOf('setSilentDots') !== -1);
  const pjs = read('extension/popup/popup.js');
  check('popup.js يربط المفتاح بالإعدادات', pjs.indexOf("patch: { silentDots: e.target.checked }") !== -1);

  /* فحص صيغة JS فعلياً بـ node --check */
  ['extension/content/annotator.js', 'extension/content/content.js',
   'extension/background/service-worker.js', 'extension/popup/popup.js',
   'scripts/test_api.js', 'scripts/test_engine.js'
  ].forEach(rel => {
    try {
      execFileSync('node', ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
      check('node --check: ' + rel, true);
    } catch (e) {
      check('node --check: ' + rel, false, String(e.stderr || e.message).slice(0, 120));
    }
  });
}

/* ============ 3) البديلان 2+3 — تطبيق Android ============ */

/* محلل XML يدوي مختصر: توازن الوسوم واكتمال السمات */
function xmlChecks(rel, requiredSnippets) {
  const src = read(rel);
  check(rel + ' — XML متوازن الوسوم', xmlBalanced(src));
  requiredSnippets.forEach(s => check(rel + ' يحوي: ' + s, src.indexOf(s) !== -1));
}
function xmlBalanced(src) {
  const clean = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<![^>]*>/g, '');
  const stack = [];
  /* (\/?) في النهاية يميز الإغلاق الذاتي <true/> — لا يبلعه مجموعة السمات */
  const re = /<(\/)?([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(clean))) {
    const [, close, name, , selfClose] = m;
    if (close) { if (stack.pop() !== name) return false; }
    else if (!selfClose) stack.push(name);
  }
  return stack.length === 0;
}

{
  xmlChecks('mobile/android/app/src/main/AndroidManifest.xml', [
    '.InterceptorActivity',
    '.NotificationWatcher',
    'android.intent.action.VIEW',
    'android.intent.category.BROWSABLE',
    'android:scheme="http"',
    'android:scheme="https"',
    'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
    'android.service.notification.NotificationListenerService',
    'android.permission.INTERNET'
  ]);

  const strings = read('mobile/android/app/src/main/res/values/strings.xml');
  ['app_name', 'warning_title', 'notif_warning_title', 'btn_set_default', 'btn_enable_notif']
    .forEach(k => check('strings.xml يحوي ' + k, strings.indexOf('name="' + k + '"') !== -1));

  xmlChecks('mobile/android/app/src/main/res/layout/activity_warning.xml', [
    'warnTitle', 'warnReasons', 'btnOfficial', 'btnContinue', 'btnBack'
  ]);
  xmlChecks('mobile/android/app/src/main/res/layout/activity_interceptor.xml', ['scanStatus']);
  xmlChecks('mobile/android/app/src/main/res/layout/activity_main.xml', [
    'statusInterceptor', 'statusNotif', 'serverInput', 'testInput', 'testResult'
  ]);
  xmlChecks('mobile/android/app/src/main/res/xml/network_security_config.xml', ['cleartextTrafficPermitted']);

  const gradleApp = read('mobile/android/app/build.gradle');
  ['applicationId "com.hisn.shield"', 'minSdk 24', 'targetSdk 34', 'com.android.application']
    .forEach(k => check('app/build.gradle يحوي ' + k, gradleApp.indexOf(k) !== -1));
  check('app/build.gradle صفر تبعيات خارجية',
    !/implementation\s+'(?!android)/.test(gradleApp.replace(/\/\/.*$/gm, '')));

  const settings = read('mobile/android/settings.gradle');
  check('settings.gradle يعرّف :app', settings.indexOf("include(\":app\")") !== -1);

  /* Kotlin: توازن الأقواس + مكونات البدائل
     المنظفات واعية للمراوح (\" و\'): السلاسل ثم الحروف النصية ثم التعليقات —
     لأن الروابط داخل السلاسل تلخّص محلل التعليقات، وحروف مثل '"' تلخّص منظف السلاسل الساذج */
  function kotlinBalanced(rel) {
    const src = read(rel)
      .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
      .replace(/'(?:\\.|[^'\\\n])'/g, "''")
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    let bal = 0, paren = 0;
    for (const c of src) {
      if (c === '{') bal++;
      else if (c === '}') bal--;
      else if (c === '(') paren++;
      else if (c === ')') paren--;
      if (bal < 0 || paren < 0) return false;
    }
    return bal === 0 && paren === 0;
  }
  const ktFiles = [
    'mobile/android/app/src/main/java/com/hisn/shield/ScanApi.kt',
    'mobile/android/app/src/main/java/com/hisn/shield/Prefs.kt',
    'mobile/android/app/src/main/java/com/hisn/shield/InterceptorActivity.kt',
    'mobile/android/app/src/main/java/com/hisn/shield/WarningActivity.kt',
    'mobile/android/app/src/main/java/com/hisn/shield/MainActivity.kt',
    'mobile/android/app/src/main/java/com/hisn/shield/NotificationWatcher.kt'
  ];
  ktFiles.forEach(f => {
    check('موجود: ' + path.basename(f), exists(f));
    check('أقواس Kotlin متوازنة: ' + path.basename(f), kotlinBalanced(f));
  });

  const inter = read(ktFiles[2]);
  ['Intent.ACTION_VIEW', 'isAllowedOnce', 'ScanApi.scan', 'openWarning', 'com.android.chrome']
    .forEach(k => check('InterceptorActivity يحوي ' + k, inter.indexOf(k) !== -1));
  check('معترض يستبعد نفسه من التمرير (لا حلقة لا نهائية)', inter.indexOf('packageName') !== -1);

  const notif = read(ktFiles[5]);
  ['NotificationListenerService', 'onNotificationPosted', 'postWarning', 'IMPORTANCE_HIGH']
    .forEach(k => check('NotificationWatcher يحوي ' + k, notif.indexOf(k) !== -1));

  const scanApi = read(ktFiles[0]);
  ['/api/scan', 'scanLocal', 'scanCloud', 'Executors.newSingleThreadExecutor']
    .forEach(k => check('ScanApi يحوي ' + k, scanApi.indexOf(k) !== -1));
  check('ScanApi مهلة قصيرة (أجزاء من الثانية)', scanApi.indexOf('2500') !== -1);
}

/* ============ 4) البديلان 2-iOS + 4 — تطبيق iOS وفلتر SMS ============ */

function swiftBalanced(rel) {
  /* منظمات واعية للمراوح: السلاسل (تشمل \" والحروف داخلها) ثم التعليقات */
  const src = read(rel)
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  let bal = 0;
  for (const c of src) {
    if (c === '{') bal++;
    else if (c === '}') bal--;
    if (bal < 0) return false;
  }
  return bal === 0;
}

{
  const swiftFiles = [
    'mobile/ios/Shared/HisnRules.swift',
    'mobile/ios/HisnApp/ScanService.swift',
    'mobile/ios/HisnApp/HisnLinkShieldApp.swift',
    'mobile/ios/HisnApp/ContentView.swift',
    'mobile/ios/HisnApp/InterceptorView.swift',
    'mobile/ios/MessageFilterExtension/MessageFilterExtension.swift'
  ];
  swiftFiles.forEach(f => {
    check('موجود: ' + f.replace('mobile/ios/', ''), exists(f));
    check('أقواس Swift متوازنة: ' + path.basename(f), swiftBalanced(f));
  });

  const rules = read(swiftFiles[0]);
  ['protectedEntities', 'emiratesnbd.com', 'blockThreshold', 'firstURL', 'xn--']
    .forEach(k => check('HisnRules يحوي ' + k, rules.indexOf(k) !== -1));
  check('HisnRules عتبات مطابقة للمحرك (55/14)',
    rules.indexOf('blockThreshold = 55') !== -1 && rules.indexOf('safeMax = 14') !== -1);

  const ext = read(swiftFiles[5]);
  /* معرف نقطة الملحق com.apple.identitylookup.message-filter يُتحقق منه في Info.plist أدناه */
  ['ILMessageFilterExtension', 'ILMessageFilterQueryRequest', '.junk', '.allow',
   'handle(_ request']
    .forEach(k => check('MessageFilterExtension يحوي ' + k, ext.indexOf(k) !== -1));

  const scanSvc = read(swiftFiles[1]);
  ['/api/scan', 'scanBlocking', 'URLSession', 'timeoutInterval']
    .forEach(k => check('ScanService يحوي ' + k, scanSvc.indexOf(k) !== -1));

  const interceptor = read(swiftFiles[4]);
  ['WKWebView', 'WarningScreen', 'InlineBrowser', 'warnDanger']
    .forEach(k => check('InterceptorView يحوي ' + k, interceptor.indexOf(k) !== -1));

  /* plists: صيغة XML سليمة ومفاتيح الملحق الصحيحة */
  xmlChecks('mobile/ios/MessageFilterExtension/Info.plist', [
    'NSExtensionPointIdentifier',
    'com.apple.identitylookup.message-filter',
    'NSExtensionPrincipalClass'
  ]);
  xmlChecks('mobile/ios/HisnApp/Info.plist', ['CFBundleDisplayName']);
  const ent = read('mobile/ios/MessageFilterExtension/MessageFilterExtension.entitlements');
  check('entitlements الملحق: message-filter', ent.indexOf('com.apple.developer.message-filter') !== -1);
  const entApp = read('mobile/ios/HisnApp/HisnLinkShield.entitlements');
  check('entitlements التطبيق: message-filter + web-browser',
    entApp.indexOf('com.apple.developer.message-filter') !== -1 &&
    entApp.indexOf('com.apple.developer.web-browser') !== -1);

  check('دليل iOS موجود ومفصل', exists('mobile/ios/README.md') &&
    read('mobile/ios/README.md').indexOf('message-filter') !== -1);
}

/* ============ 5) الوثائق والصفحة ============ */
{
  check('mobile/README.md يشرح التوزيع بين المنصتين',
    exists('mobile/README.md') &&
    read('mobile/README.md').indexOf('NotificationListenerService') !== -1 &&
    read('mobile/README.md').indexOf('ILMessageFilterExtension') !== -1);
  check('safari-ios/README.md محدث للوضع الصامت',
    read('safari-ios/README.md').indexOf('الوضع الصامت') !== -1);
  const idx = read('public/index.html');
  check('index.html يشرح القيود النظامية بصدق',
    idx.indexOf('iOS تمنع قراءة إشعارات') !== -1 &&
    idx.indexOf('ألغى فلاتر SMS') !== -1);
}

/* ============ الخلاصة ============ */
console.log('\nالبدائل الأربعة: ' + passed + ' نجح / ' + failed + ' فشل');
if (failed) {
  console.error('فشل ' + failed + ' اختباراً');
  process.exit(1);
}

