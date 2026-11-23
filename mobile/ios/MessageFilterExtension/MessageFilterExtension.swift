/*
 * حصن (Hisn) — MessageFilterExtension.swift (البديل 4: فلتر الرسائل النصية المدمج)
 *
 * ملحق ILMessageFilterExtension الرسمي من Apple (IdentityLookup framework):
 * يعمل في الخلفية على كل رسالة SMS من مرسل «غير معروف» قبل أن تظهر للمستخدم.
 *
 * التدفق لكل رسالة:
 *  1) استخراج أول رابط من نص الرسالة — لا رابط؟ الرسالة تمر (.allow).
 *  2) فحص محلي فوري (SharedRules) — خطر صريح؟ (.junk) مباشرة دون أي شبكة.
 *  3) ليس خطراً محلياً؟ استعلام سحابي سريع (مهلة 3 ثوان) عن الخادم الموحد:
 *     خبيث → .junk (مجلد الرسائل غير المرغوب فيها) + تسجيل التنبيه.
 *     مشبوه → .junk أيضاً (الحذر أولاً) — يمكن تغييره إلى .allow حسب رغبتك.
 *     آمن → .allow (تظهر في صندوق الوارد كالمعتاد).
 *
 * ⚠️ شروط Apple الرسمية لتفعيل هذا الملحق (كلها في mobile/ios/README.md):
 *    - حساب Apple Developer مدفوع + طلب صلاحية message-filter من Apple (نموذج رسمي).
 *    - App ID مع capability «Message Filtering».
 *    - الفلترة تعمل على رسائل «المرسلين غير المعروفين» فقط — قيد نظامي من Apple.
 */

import IdentityLookup

final class MessageFilterExtension: ILMessageFilterExtension {

    private let serverBase: String = {
        /* عنوان الخادم السحابي — ضع رابط نشر Vercel هنا قبل البناء
           أو اجعله فارغاً للعمل بالقواعد المحلية فقط */
        UserDefaults(suiteName: "group.com.hisn.shield")?.string(forKey: "hisn_server")
            ?? "" /* ← أو اكتب الرابط ثابتاً هنا: "https://hisn-yourname.vercel.app" */
    }()

    override func handle(_ request: ILMessageFilterQueryRequest,
                         context: ILMessageFilterExtensionContext,
                         completion: @escaping (ILMessageFilterQueryResponse) -> Void) {

        let response = ILMessageFilterQueryResponse()
        let body = request.messageBody ?? ""

        /* 1) لا رابط في الرسالة → تمرير كامل بلا أي عمل */
        guard let url = HisnRules.firstURL(in: body) else {
            response.action = .allow
            completion(response)
            return
        }

        /* 2) الفحص المحلي الفوري — يكفي لحظة انقطاع الشبكة وأسرع قرار */
        let local = HisnRules.analyze(url)
        if local.level == .danger {
            response.action = .junk
            completion(response)
            return
        }

        /* 3) الفحص السحابي السريع (متزامن داخل الخيط المخصص للملحق) */
        let verdict = ScanService.scanBlocking(url: url, source: "sms", serverBase: serverBase)
        switch verdict.level {
        case "danger", "caution":
            /* رسالة تحمل رابطاً خبيثاً/مشبوهة → الرسائل غير المرغوب فيها */
            response.action = .junk
        default:
            response.action = .allow
        }
        completion(response)
    }

    /*
     * ملاحظة تجربة المستخدم: iOS ينقل الرسالة المصنفة .junk إلى مجلد
     * «الرسائل غير المرغوب فيها» ويظهر شارة تنبيه نظامية — لا يمكن لملحق
     * إرسال إشعار push مستقل من تلقاء نفسه (قيد Apple). التنبيه للمستخدم
     * يتم عبر سلوك النظام المذكور، والدرجة/الأسباب تُعرض في التطبيق الرئيسي
     * (ContentView) عند فتحه.
     */
}
