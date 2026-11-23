/*
 * حصن (Hisn) — InterceptorActivity (البديل 2: معترض الروابط الذكي)
 *
 * التدفق المطلوب حرفياً:
 *  1) المستخدم يضغط رابطاً في واتساب/SMS/الإيميل — النظام يفتح هذا النشاط أولاً
 *     لأن حصن معيّن «متصفحاً افتراضياً».
 *  2) الفحص يجري في الخلفية بخيط مستقل — أجزاء من الثانية (مهلة 2.5s للسحابة
 *     + سقوط محلي فوري إن فشلت الشبكة).
 *  3) آمن؟ يُمرَّر الرابط فوراً إلى المتصفح الحقيقي (كروم/سفاري) — المستخدم
 *     لا يشعر بشيء سوى ومضة شفافة.
 *  4) خبيث؟ يتوقف الفتح وتظهر شاشة تحذير حمراء مع الأسباب والموقع الرسمي.
 */
package com.hisn.shield

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.TextView
import android.widget.Toast

class InterceptorActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_interceptor)

        val raw = intent?.data?.toString() ?: run { finishSoft(); return }
        if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
            finishSoft(); return
        }

        val status = findViewById<TextView>(R.id.scanStatus)
        status.text = getString(R.string.scanning)

        val prefs = Prefs(this)
        val host = intent?.data?.host ?: ""

        /* مضيف أُذن به مؤقتاً من شاشة التحذير؟ مرر مباشرة بلا فحص مكرر */
        if (host.isNotBlank() && prefs.isAllowedOnce(host)) {
            forward(raw); return
        }

        val server = prefs.serverBase
        val source = "interceptor"

        ScanApi.executor.execute {
            val verdict = try {
                ScanApi.scan(raw, source, server)
            } catch (e: Exception) {
                ScanApi.scanLocal(raw)
            }

            runOnUiThread {
                when (verdict.level) {
                    "safe", "na" -> {
                        /* آمن: فتح فوري في المتصفح الحقيقي — أجزاء من الثانية */
                        forward(raw)
                    }
                    "caution" -> {
                        openWarning(raw, verdict, amber = true)
                    }
                    else -> {
                        /* خبيث: وقف الفتح + شاشة حمراء */
                        openWarning(raw, verdict, amber = false)
                    }
                }
            }
        }
    }

    /** تمرير فوري إلى المتصفح الحقيقي — مع استبعاد حصن نفسه (وإلا حلقة لا نهائية) */
    private fun forward(url: String) {
        try {
            val view = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                .addCategory(Intent.CATEGORY_BROWSABLE)
            /* كروم أولاً إن وجد — ثم أي متصفح آخر غير حصن */
            val chrome = packageManager.getLaunchIntentForPackage("com.android.chrome")
            if (chrome != null) {
                chrome.data = Uri.parse(url)
                chrome.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(chrome)
                finish()
                overridePendingTransition(0, 0)
                return
            }
            val resolved = packageManager.queryIntentActivities(view, 0)
                .filter { it.activityInfo.packageName != packageName }
            if (resolved.isEmpty()) {
                /* لا متصفح آخر مثبت — لا يمكن التمرير (وإلا حلقة) */
                Toast.makeText(this, "ثبّت متصفحاً حقيقياً (كروم مثلاً) ليتمكن حصن من تمرير الروابط الآمنة إليه",
                    Toast.LENGTH_LONG).show()
                try {
                    startActivity(Intent(this, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } catch (e2: Exception) { }
                finish()
                overridePendingTransition(0, 0)
                return
            }
            val chooser = Intent.createChooser(view, null)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            chooser.putExtra(
                Intent.EXTRA_EXCLUDE_COMPONENTS,
                resolved.map { it.activityInfo.toComponentName() }.toTypedArray()
            )
            startActivity(chooser)
        } catch (e: Exception) {
            Toast.makeText(this, "تعذر فتح الرابط في المتصفح", Toast.LENGTH_SHORT).show()
        }
        finish()
        /* تجاوز الانتقال الافتراضي حتى تظل الومضة شفافة وسريعة */
        overridePendingTransition(0, 0)
    }

    private fun openWarning(url: String, verdict: ScanApi.Verdict, amber: Boolean) {
        val i = Intent(this, WarningActivity::class.java).apply {
            putExtra(WarningActivity.EXTRA_URL, url)
            putExtra(WarningActivity.EXTRA_SCORE, verdict.score)
            putExtra(WarningActivity.EXTRA_LEVEL, verdict.level)
            putExtra(WarningActivity.EXTRA_AMBER, amber)
            putExtra(WarningActivity.EXTRA_REASONS, verdict.reasons.toTypedArray())
            putExtra(WarningActivity.EXTRA_OFFICIAL_URL, verdict.officialUrl)
            putExtra(WarningActivity.EXTRA_OFFICIAL_HOST, verdict.officialDomain)
            putExtra(WarningActivity.EXTRA_CLOUD, verdict.cloud)
        }
        startActivity(i)
        finish()
        overridePendingTransition(0, 0)
    }

    private fun finishSoft() {
        finish()
        overridePendingTransition(0, 0)
    }
}
