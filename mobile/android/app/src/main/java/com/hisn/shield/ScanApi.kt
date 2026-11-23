/*
 * حصن (Hisn) — عميل الفحص لأندرويد
 * يستدعي الخادم السحابي الموحد (GET /api/scan) بمهلة قصيرة، وعند تعذر الوصول
 * يسقط إلى قواعد محلية خفيفة حتى لا يتعطل الاعتراض دون شبكة.
 * صفر تبعيات: HttpURLConnection + org.json (مدمجة في النظام).
 */
package com.hisn.shield

import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors

object ScanApi {

    private const val TAG = "HisnScan"
    private const val CONNECT_TIMEOUT_MS = 2500   // أجزاء من الثانية — كما وعد المستخدم
    private const val READ_TIMEOUT_MS = 3000
    private const val FALLBACK_TIMEOUT_MS = 1500  // سقف السقوط المحلي: الاعتراض يجب أن يبقى لحظياً

    /* خيط واحد للفحص — لا يزاحم الخيط الرئيسي أبداً */
    val executor = Executors.newSingleThreadExecutor()

    data class Verdict(
        val url: String,
        val score: Int,
        val level: String,        // safe | caution | danger | na
        val levelText: String,
        val reasons: List<String>,
        val officialDomain: String?,   // النطاق الرسمي عند انتحال جهة معروفة
        val officialUrl: String?,
        val cloud: Boolean
    )

    /** الفحص الكامل: خادم أولاً ثم السقوط المحلي */
    fun scan(url: String, source: String, serverBase: String): Verdict {
        if (serverBase.isNotBlank()) {
            val cloud = scanCloud(url, source, serverBase)
            if (cloud != null) return cloud
        }
        return scanLocal(url)
    }

    /* ================= الفحص السحابي ================= */

    private fun scanCloud(url: String, source: String, serverBase: String): Verdict? {
        var conn: HttpURLConnection? = null
        return try {
            val base = serverBase.trim().trimEnd('/')
            val enc = URLEncoder.encode(url, "UTF-8")
            val u = URL("$base/api/scan?url=$enc&source=$source")
            conn = (u.openConnection() as HttpURLConnection).apply {
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                requestMethod = "GET"
                setRequestProperty("Accept", "application/json")
            }
            val code = conn.responseCode
            if (code != 200) return null
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(body)
            if (!json.optBoolean("ok", false)) return null
            val v = json.getJSONObject("verdict")
            val cmp = v.optJSONObject("comparison")
            val official = cmp?.optString("officialUrl", "")?.takeIf { it.isNotBlank() }
            Verdict(
                url = v.optString("url", url),
                score = v.optInt("score", 0),
                level = v.optString("level", "na"),
                levelText = v.optString("levelText", ""),
                reasons = v.optJSONArray("reasons")?.let { arr ->
                    (0 until arr.length()).mapNotNull { i ->
                        arr.optJSONObject(i)?.optString("text")?.takeIf { t -> t.isNotBlank() }
                    }
                } ?: emptyList(),
                officialDomain = cmp?.optString("officialHost", "")?.takeIf { it.isNotBlank() },
                officialUrl = official,
                cloud = true
            )
        } catch (e: Exception) {
            Log.w(TAG, "cloud scan failed — falling back to local: ${e.message}")
            null
        } finally {
            conn?.disconnect()
        }
    }

    /* ================= السقوط المحلي (بلا شبكة) =================
       قواعد خفيفة تحمل أخطر إشارات المحرك الكامل — تكفي لحظة انقطاع الشبكة */

    private val BAD_WORDS = listOf(
        "verify", "secure", "login", "update-account", "confirm-account", "otp",
        "gift", "prize", "winner", "free-money", "refund", "paypal-verify",
        "bank-alert", "suspended", "unlock-account", "icloud-lock", "careem-pay"
    )
    private val SHORTENERS = listOf(
        "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly",
        "rebrand.ly", "cutt.ly", "rb.gy", "shorturl.at", "tiny.cc"
    )

    fun scanLocal(url: String): Verdict {
        val u = try {
            URL(url)
        } catch (e: Exception) {
            return Verdict(url, 0, "na", "غير قابل للفحص", emptyList(), null, null, false)
        }
        val host = u.host.lowercase()
        var score = 0
        val reasons = mutableListOf<String>()

        fun add(w: Int, text: String) { score += w; reasons.add(text) }

        if (Regex("^(\\d{1,3}\\.){3}\\d{1,3}$").matches(host)) {
            add(30, "المضيف عنوان IP مباشر — نمط شائع في صفحات الاحتيال")
        }
        if (host.startsWith("xn--") || host.contains(".xn--")) {
            add(28, "اسم نطاق بحروف مشفرة دولياً — قد يحاكي موقعاً رسمياً بصرياً")
        }
        if (u.protocol == "http") {
            add(8, "اتصال غير مشفر (HTTP)")
        }
        if (SHORTENERS.any { host == it || host.endsWith(".$it") }) {
            add(16, "رابط مختصر يخفي الوجهة الحقيقية")
        }
        val lower = url.lowercase()
        val hitWord = BAD_WORDS.firstOrNull { lower.contains(it) }
        if (hitWord != null) {
            add(14, "كلمة خطرة في الرابط: \"$hitWord\"")
        }
        if (lower.contains("@")) {
            add(12, "علامة @ داخل الرابط — أسلوب تمويه قديم لكنه ما زال يعمل")
        }
        if (host.count { it == '-' } >= 3) {
            add(8, "نطاق مليء بالشرطات — نمط نطاقات مؤقتة مخلوقة للخداع")
        }
        score = score.coerceIn(0, 100)
        val level = when {
            score >= 55 -> "danger"
            score >= 15 -> "caution"
            else -> "safe"
        }
        val text = when (level) {
            "danger" -> "خطر"
            "caution" -> "مشبوه"
            else -> "آمن"
        }
        return Verdict(url, score, level, text, reasons, null, null, cloud = false)
    }
}
