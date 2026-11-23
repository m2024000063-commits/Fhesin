/*
 * حصن (Hisn) — الإعدادات المحفوظة (SharedPreferences)
 * مفاتيح pcs_* متوافقة مع تسميات الإضافة حتى يسهل التوحيد مستقبلاً.
 */
package com.hisn.shield

import android.content.Context
import android.content.SharedPreferences

class Prefs(ctx: Context) {
    private val sp: SharedPreferences =
        ctx.getSharedPreferences("hisn_prefs", Context.MODE_PRIVATE)

    var serverBase: String
        get() = sp.getString(KEY_SERVER, "") ?: ""
        set(v) = sp.edit().putString(KEY_SERVER, v.trim()).apply()

    /* التجاوز اليدوي: مضيف أُذن به مؤقتاً من شاشة التحذير (10 دقائق) */
    fun isAllowedOnce(host: String): Boolean {
        val now = System.currentTimeMillis()
        val map = sp.getStringSet(KEY_ALLOWED, emptySet())?.toMutableSet() ?: mutableSetOf()
        val entry = map.firstOrNull { it.startsWith("$host|") } ?: return false
        val ts = entry.substringAfter('|').toLongOrNull() ?: return false
        if (now - ts > ALLOW_MS) {
            map.remove(entry)
            sp.edit().putStringSet(KEY_ALLOWED, map).apply()
            return false
        }
        return true
    }

    fun setAllowedOnce(host: String) {
        val map = sp.getStringSet(KEY_ALLOWED, emptySet())?.toMutableSet() ?: mutableSetOf()
        map.removeAll { it.startsWith("$host|") }
        map.add("$host|${System.currentTimeMillis()}")
        sp.edit().putStringSet(KEY_ALLOWED, map).apply()
    }

    companion object {
        private const val KEY_SERVER = "pcs_server"
        private const val KEY_ALLOWED = "pcs_allowed"
        private const val ALLOW_MS = 10L * 60 * 1000
    }
}
