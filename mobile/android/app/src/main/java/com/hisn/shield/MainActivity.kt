/*
 * حصن (Hisn) — MainActivity: لوحة إدارة الحماية
 * ثلاثة مفاتيح يضبطها المستخدم مرة واحدة:
 *  1) تعيين حصن متصفحاً افتراضياً (البديل 2 — معترض الروابط)
 *  2) منح وصول الإشعارات (البديل 3 — مراقب الإشعارات)
 *  3) عنوان الخادم السحابي + فحص يدوي سريع للتجربة
 */
package com.hisn.shield

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {

    private lateinit var prefs: Prefs
    private lateinit var statusInterceptor: TextView
    private lateinit var statusNotif: TextView
    private lateinit var testInput: EditText
    private lateinit var testResult: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = Prefs(this)

        statusInterceptor = findViewById(R.id.statusInterceptor)
        statusNotif = findViewById(R.id.statusNotif)
        testInput = findViewById(R.id.testInput)
        testResult = findViewById(R.id.testResult)

        findViewById<Button>(R.id.btnSetDefault).setOnClickListener {
            try {
                startActivity(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS))
            } catch (e: Exception) {
                try { startActivity(Intent(Settings.ACTION_SETTINGS)) } catch (e2: Exception) { }
            }
        }

        findViewById<Button>(R.id.btnEnableNotif).setOnClickListener {
            try {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            } catch (e: Exception) {
                Toast.makeText(this, "افتح: الإعدادات ← وصول الإشعارات", Toast.LENGTH_LONG).show()
            }
        }

        val serverInput = findViewById<EditText>(R.id.serverInput)
        serverInput.setText(prefs.serverBase)
        findViewById<Button>(R.id.btnServerSave).setOnClickListener {
            prefs.serverBase = serverInput.text.toString().trim()
            Toast.makeText(this, R.string.server_saved, Toast.LENGTH_SHORT).show()
        }

        findViewById<Button>(R.id.btnTest).setOnClickListener { runTest() }
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    private fun refreshStatus() {
        /* هل حصن هو المتصفح الافتراضي؟ نحل المعالج الافتراضي لرابط https تجريبي */
        val probe = Intent(Intent.ACTION_VIEW, Uri.parse("https://www.example.com"))
            .addCategory(Intent.CATEGORY_BROWSABLE)
        val isDefault = try {
            val ri = packageManager.resolveActivity(probe, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY)
            ri?.activityInfo?.packageName == packageName
        } catch (e: Exception) { false }
        statusInterceptor.text =
            if (isDefault) getString(R.string.default_browser_on)
            else getString(R.string.default_browser_off)

        /* وصول الإشعارات: نقرأ قائمة المستمعين المرتبطين من الإعدادات الآمنة */
        val notifEnabled = try {
            Settings.Secure.getString(
                contentResolver, "enabled_notification_listeners"
            )?.contains(packageName) == true
        } catch (e: Exception) { false }
        statusNotif.text =
            if (notifEnabled) getString(R.string.notif_access_on)
            else getString(R.string.notif_access_off)
    }

    private fun runTest() {
        var v = testInput.text.toString().trim()
        if (v.isEmpty()) return
        if (v.contains(' ')) {
            testResult.text = "الرابط يحتوي فراغات — انسخه كاملاً دون فراغات"
            return
        }
        if (!v.startsWith("http://") && !v.startsWith("https://")) v = "https://$v"
        testResult.text = getString(R.string.scanning)
        ScanApi.executor.execute {
            val verdict = try { ScanApi.scan(v, "direct", prefs.serverBase) }
            catch (e: Exception) { ScanApi.scanLocal(v) }
            runOnUiThread {
                val icon = when (verdict.level) {
                    "danger" -> getString(R.string.test_danger)
                    "caution" -> getString(R.string.test_caution)
                    "safe" -> getString(R.string.test_safe)
                    else -> "غير قابل للفحص"
                }
                testResult.text = "$icon — ${verdict.score}/100\n" +
                    verdict.reasons.take(3).joinToString("\n") { "• $it" }
            }
        }
    }
}
