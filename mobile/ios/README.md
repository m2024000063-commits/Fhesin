# حصن على iOS — فلتر الرسائل النصية + معترض الروابط

مصادر Swift كاملة للبديلين 4 و2 على iPhone. بناء iOS يمر حتماً عبر Xcode (Apple لا تسمح بأي مسار آخر)، وهذا الدليل يجعل العملية خطوة بخطوة بدون تخمين.

## الملفات

| المجلد | الدور |
|---|---|
| `Shared/HisnRules.swift` | القواعد المحلية المشتركة (منفذ Swift لأخطر إشارات المحرك) — تُضاف إلى **كلا الهدفين** |
| `HisnApp/` | التطبيق الرئيسي: لوحة الحالة + معترض الروابط (البديل 2) + المتصفح الداخلي + شاشة التحذير |
| `MessageFilterExtension/` | ملحق فلترة الرسائل الرسمي (البديل 4): `ILMessageFilterExtension` |

## المتطلبات الصادقة قبل البدء

1. **حاسوب Mac + Xcode 15+** — لا بديل عنه لبناء أي تطبيق iOS.
2. **حساب Apple Developer مدفوع (99$/سنة)** — إلزامي للبديل 4 فقط، لأن صلاحية تصفية الرسائل **لا تُمنح للحسابات المجانية** ولا تُفعَّل تلقائياً حتى لمدفوع.
3. صلاحية `com.apple.developer.message-filter` تحتاج **طلب موافقة رسمي من Apple** (نموذج "Request Access to the SMS and MMS Filtering Entitlement" في Developer Portal) — عادة تُرد خلال أيام.
4. البديل 2 على iOS (تعيين حصن متصفحاً افتراضياً) يحتاج صلاحية `com.apple.developer.web-browser` المخصصة — تُطلب من Developer Portal أيضاً (Apps → Custom Entitlement Requests).
5. **قيد نظامي:** فلترة SMS تعمل على رسائل «المرسلين غير المعروفين» فقط (Apple تمنع فحص رسائل جهات الاتصال المحفوظة).

## خطوات البناء في Xcode (15 دقيقة)

### 1) إنشاء المشروع
- Xcode ← **File ← New ← Project ← iOS App**
  - Product Name: `HisnLinkShield` — Organization Identifier: `com.hisn.shield` — Interface: **SwiftUI** — Language: **Swift**.
- احذف ملف `ContentView.swift` المولَّد تلقائياً.
- انسخ إلى مجلد المشروع: `HisnApp/*.swift` + `Shared/HisnRules.swift` واسحبها إلى الهدف `HisnLinkShield` في Xcode (Copy items if needed ✓).
- انسخ `HisnApp/Info.plist` محله (أو انقل محتواه إلى تبويب Info في Target).
- في **Signing & Capabilities** فعّل التوقيع، وأضف الملف `HisnLinkShield.entitlements` من تبويب + Capability ← ادفع الملف المرفق.

### 2) إضافة ملحق فلترة الرسائل
- **File ← New ← Target ← Message Filter Extension** ← اسمه `MessageFilterExtension`.
- سيولّد Xcode ملفاً افتراضياً — **استبدله** بملفنا `MessageFilterExtension/MessageFilterExtension.swift`.
- استبدل `Info.plist` للملحق بملفنا، وأضف `MessageFilterExtension.entitlements`، وأضف `Shared/HisnRules.swift` + `HisnApp/ScanService.swift` إلى **هدف الملحق أيضاً** (Target Membership في Inspecter) — الملحق يحتاج القواعد المحلية وعميل الفحص.
- تأكد أن App Group (اختياري): إن أردت قراءة عنوان الخادم من إعدادات التطبيق فعّل **App Groups** للهدفين معاً بمعرف `group.com.hisn.shield` (الملحق يقرؤه أصلاً عبر UserDefaults suite بنفس الاسم؛ وبدونه اكتب الرابط ثابتاً في `MessageFilterExtension.swift`).

### 3) الرفع والتفعيل على الآيفون
- وصّل الآيفون ← اختره في Xcode ← **Run**.
- الإعدادات ← عام ← إدارة VPN والأجهزة ← وثّق حسابك (مرة واحدة للتوقيع المجاني/الخاص).
- تفعيل الفلتر: **الإعدادات ← الرسائل ← الرسائل غير المعروفة والمزعجة ← فعّل «تصفية الرسائل غير المعروفة» ← اختر حصن**.
- تفعيل معترض الروابط: زر المشاركة على أي رابط ← **أكثر ← فعّل حصن**، أو من الإعدادات عيّن حصن تطبيق المتصفح الافتراضي إن ظهر الخيار (بعد منح web-browser).

## كيف يعمل الملحق على كل رسالة؟

```
رسالة SMS من مرسل غير معروف
   └─ الملحق يستقبلها قبل العرض
        ├─ لا رابط في النص؟ → تمرير (allow) فوراً
        ├─ رابط + خطر محلي صريح (IP / انتحال جهة / punycode…)? → رسائل غير مرغوب فيها (junk)
        └─ غير حاسم؟ → استعلام سحابي (3 ثوان)
              ├─ خبيث/مشبوه → junk (مجلد «الرسائل غير المرغوب فيها» + شارة النظام)
              └─ آمن → allow (صندوق الوارد كالمعتاد)
```

iOS نفسه ينقل رسائل `junk` إلى مجلد «الرسائل غير المرغوب فيها» ويظهر تنبيه شارة — هذا هو التنبيه الرسمي الوحيد المسموح لهذا النوع من الملحقات، ولا يمكن إرسال إشعار مخصص من الملحق (قيد Apple).

## التوثيق الرسمي المرجعي
- Message Filtering: doc.apple.com — "MessageFilterExtension" (framework IdentityLookup، iOS 11+).
- Web Browser entitlement: doc.apple.com — "Preparing your app to be a default browser".
- Safari Web Extension (الإضافة الصامتة داخل Safari — البديل 1): الدليل الكامل في `safari-ios/README.md` بمستودع الجذر.
