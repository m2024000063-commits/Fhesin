/*
 * حصن (Hisn) — WarningActivity: شاشة التحذير الحمراء
 * تظهر فقط عندما يوقف حصن فتح رابط خبيث: الدرجة، الأسباب بالعربية،
 * الموقع الرسمي الصحيح عند انتحال جهة معروفة، وتجاوز واعٍ مؤقت (10 دقائق).
 */
package com.hisn.shield

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class WarningActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_warning)

        val url = intent.getStringExtra(EXTRA_URL) ?: ""
        val score = intent.getIntExtra(EXTRA_SCORE, 0)
        val amber = intent.getBooleanExtra(EXTRA_AMBER, false)
        val reasons = intent.getStringArrayExtra(EXTRA_REASONS) ?: emptyArray()
        val officialUrl = intent.getStringExtra(EXTRA_OFFICIAL_URL)
        val officialHost = intent.getStringExtra(EXTRA_OFFICIAL_HOST)
        val cloud = intent.getBooleanExtra(EXTRA_CLOUD, false)

        val title = findViewById<TextView>(R.id.warnTitle)
        val body = findViewById<TextView>(R.id.warnBody)
        val scoreChip = findViewById<TextView>(R.id.warnScore)
        val reasonsBox = findViewById<LinearLayout>(R.id.warnReasons)
        val officialBtn = findViewById<Button>(R.id.btnOfficial)
        val continueBtn = findViewById<Button>(R.id.btnContinue)
        val backBtn = findViewById<Button>(R.id.btnBack)
        val root = findViewById<View>(R.id.warnRoot)

        if (amber) {
            root.setBackgroundColor(Color.parseColor("#1C1408"))
            title.text = getString(R.string.warning_caution_title)
            title.setTextColor(Color.parseColor("#FBBF24"))
            body.text = getString(R.string.warning_caution_body)
            continueBtn.visibility = View.VISIBLE
        } else {
            root.setBackgroundColor(Color.parseColor("#1C0808"))
            title.text = getString(R.string.warning_title)
            title.setTextColor(Color.parseColor("#F87171"))
            body.text = getString(R.string.warning_danger_body)
        }

        scoreChip.text = (if (amber) "🟡 " else "🔴 ") + "$score/100" +
            if (cloud) "  · فحص سحابي" else "  · فحص محلي"

        reasonsBox.removeAllViews()
        if (reasons.isEmpty()) {
            val t = TextView(this)
            t.text = "• رابط غير معروف المصدر — تعامل بحذر"
            t.setTextColor(Color.parseColor("#E2E8F0"))
            t.textSize = 14f
            reasonsBox.addView(t)
        } else {
            reasons.take(5).forEach { r ->
                val t = TextView(this)
                t.text = "• $r"
                t.setTextColor(Color.parseColor("#E2E8F0"))
                t.textSize = 14f
                t.setPadding(0, dp(6), 0, dp(6))
                reasonsBox.addView(t)
            }
        }

        /* النطاق المستهدف لعرضه بوضوح */
        val hostText = findViewById<TextView>(R.id.warnHost)
        try { hostText.text = Uri.parse(url).host ?: url } catch (e: Exception) { hostText.text = url }

        if (officialUrl != null && officialHost != null) {
            officialBtn.visibility = View.VISIBLE
            officialBtn.text = "${getString(R.string.open_official)}: $officialHost"
            officialBtn.setOnClickListener {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(officialUrl)))
                } catch (e: Exception) { }
                finish()
            }
        } else {
            officialBtn.visibility = View.GONE
        }

        continueBtn.setOnClickListener {
            /* تجاوز واعٍ — يصمد 10 دقائق لهذا المضيف فقط ثم يعود الحجب */
            val host = try { Uri.parse(url).host ?: "" } catch (e: Exception) { "" }
            if (host.isNotBlank()) Prefs(this).setAllowedOnce(host)
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } catch (e: Exception) { }
            finish()
        }

        backBtn.setOnClickListener { finish() }
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_SCORE = "score"
        const val EXTRA_LEVEL = "level"
        const val EXTRA_AMBER = "amber"
        const val EXTRA_REASONS = "reasons"
        const val EXTRA_OFFICIAL_URL = "officialUrl"
        const val EXTRA_OFFICIAL_HOST = "officialHost"
        const val EXTRA_CLOUD = "cloud"
    }
}
