/*
 * حصن (Hisn) — NotificationWatcher (البديل 3: قراءة الإشعارات الفورية)
 *
 * NotificationListenerService الرسمي من أندرويد: يُفعَّل بموافقة المستخدم
 * من «الإعدادات ← وصول الإشعارات ← حصن» ثم يعمل في الخلفية دائماً.
 * عند وصول أي إشعار: يستخرج الروابط من نصه، يفحصها، وإن وُجد رابط خبيث
 * يرسل تنبيهاً تحذيرياً فورياً عالي الأولوية — قبل أن يفتح المستخدم الرسالة.
 *
 * الخصوصية: لا يُخزَّن نص أي إشعار؛ يُستخرج الرابط فقط ويُفحص ويُنسى.
 */
package com.hisn.shield

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.text.TextUtils
import java.util.concurrent.ConcurrentHashMap

class NotificationWatcher : NotificationListenerService() {

    private val recentChecks = ConcurrentHashMap<String, Long>()

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val n = sbn?.notification ?: return
        if (sbn.packageName == packageName) return          // إشعارات حصن نفسها
        if (isSystemNoise(sbn.packageName)) return          // نظام غير مفيد فحصه

        val extras = n.extras
        val texts = mutableListOf<String>()
        for (key in arrayOf(
            Notification.EXTRA_TITLE, Notification.EXTRA_TEXT,
            Notification.EXTRA_BIG_TEXT, Notification.EXTRA_SUB_TEXT
        )) {
            val cs = extras.getCharSequence(key)
            if (!TextUtils.isEmpty(cs)) texts.add(cs.toString())
        }
        if (texts.isEmpty()) return

        val urls = extractUrls(texts.joinToString(" "))
        if (urls.isEmpty()) return

        val server = Prefs(this).serverBase
        ScanApi.executor.execute {
            for (url in urls.take(MAX_URLS_PER_NOTIF)) {
                /* تخزين مؤقت: الرابط الذي فُحص خلال 10 دقائق لا يُفحص مرتين */
                val last = recentChecks[url] ?: 0
                val now = System.currentTimeMillis()
                if (now - last < 10 * 60 * 1000L) continue
                recentChecks[url] = now
                if (recentChecks.size > 500) recentChecks.clear()

                val verdict = try {
                    ScanApi.scan(url, "notification", server)
                } catch (e: Exception) {
                    ScanApi.scanLocal(url)
                }
                if (verdict.level == "danger" || verdict.level == "caution") {
                    postWarning(sbn.packageName, url, verdict)
                }
            }
        }
    }

    /* ================= استخراج الروابط ================= */

    private val URL_RE = Regex(
        "(?:https?://|www\\.)[A-Za-z0-9\\-._~:/?#\\[\\]@!$&'()*+,;=%]+",
        RegexOption.IGNORE_CASE
    )

    private fun extractUrls(text: String): List<String> {
        val out = LinkedHashSet<String>()
        for (m in URL_RE.findAll(text)) {
            var u = m.value.trim().trimEnd('.', ',', ')', ']', '»', '"', '\'')
            if (!u.startsWith("http")) u = "https://$u"
            if (u.contains('.')) out.add(u)
            if (out.size >= MAX_URLS_PER_NOTIF * 2) break
        }
        return out.toList()
    }

    /* حزم النظام التي لا تحمل روابط فعلية معظم الوقت — توفير للبطارية */
    private fun isSystemNoise(pkg: String): Boolean = pkg in setOf(
        "com.android.systemui", "com.android.settings", "com.android.deskclock",
        "com.android.calendar", "com.android.providers.downloads"
    )

    /* ================= التنبيه التحذيري الفوري ================= */

    private fun postWarning(sourceApp: String, url: String, verdict: ScanApi.Verdict) {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notif_channel_name),
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = getString(R.string.notif_channel_desc)
                enableVibration(true)
            }
            nm.createNotificationChannel(ch)
        }

        val open = PendingIntent.getActivity(
            this, url.hashCode(),
            Intent(this, WarningActivity::class.java).apply {
                putExtra(WarningActivity.EXTRA_URL, url)
                putExtra(WarningActivity.EXTRA_SCORE, verdict.score)
                putExtra(WarningActivity.EXTRA_LEVEL, verdict.level)
                putExtra(WarningActivity.EXTRA_AMBER, verdict.level == "caution")
                putExtra(WarningActivity.EXTRA_REASONS, verdict.reasons.toTypedArray())
                putExtra(WarningActivity.EXTRA_OFFICIAL_URL, verdict.officialUrl)
                putExtra(WarningActivity.EXTRA_OFFICIAL_HOST, verdict.officialDomain)
                putExtra(WarningActivity.EXTRA_CLOUD, verdict.cloud)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val host = try { java.net.URI(url).host ?: url } catch (e: Exception) { url }
        val body = "المصدر: $sourceApp\n" +
            "الرابط: $host\n" +
            "الحكم: ${verdict.levelText} (${verdict.score}/100)"

        /* منشئ الباني يعتمد الإصدار: قناة الإشعارات API 26+ فقط،
           وما دونها يستخدم الباني القديم مع أولوية عالية */
        val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_shield)
                .setContentTitle(getString(R.string.notif_warning_title))
                .setContentText("المصدر: $sourceApp — الرابط: $host — ${verdict.levelText} ${verdict.score}/100")
                .setStyle(Notification.BigTextStyle().bigText(body))
                .setContentIntent(open)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_ALARM)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setSmallIcon(R.drawable.ic_shield)
                .setContentTitle(getString(R.string.notif_warning_title))
                .setContentText("المصدر: $sourceApp — الرابط: $host — ${verdict.levelText} ${verdict.score}/100")
                .setStyle(Notification.BigTextStyle().bigText(body))
                .setContentIntent(open)
                .setAutoCancel(true)
                .setPriority(Notification.PRIORITY_HIGH)
                .setCategory(Notification.CATEGORY_ALARM)
        }

        try {
            nm.notify(NOTIF_BASE_ID + (url.hashCode() and 0x7FFFFFFF) % 1000, b.build())
        } catch (e: Exception) { /* قناة مغلقة أو أذن غُيّرت */ }
    }

    companion object {
        private const val CHANNEL_ID = "hisn_warnings"
        private const val NOTIF_BASE_ID = 47000
        private const val MAX_URLS_PER_NOTIF = 3
    }
}
