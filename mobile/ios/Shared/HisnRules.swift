/*
 * حصن (Hisn) — SharedRules.swift
 * القواعد المحلية المشتركة بين التطبيق الرئيسي وفلتر الرسائل النصية (iOS).
 * منفذ Swift مختصر لأخطر إشارات المحرك الكامل في extension/rules/engine.js:
 * تُستخدم للفحص الفوري قبل (أو بدل) الاستعلام السحابي — تمنح جواباً في أجزاء من الثانية.
 *
 * ⚠️ المصدر الوحيد للحقيقة في تعديل القواعد: extension/rules/data.js + engine.js.
 *    حافظ على توافق هذين الملفين عند أي تحديث مستقبلي للأوزان أو العتبات.
 */

import Foundation

enum HisnRules {

    /// درجة الحكم النهائية والنص العربي
    struct Verdict {
        let score: Int
        let level: Level          // safe | caution | danger | na
        let levelText: String     // آمن | مشبوه | خطر
        let reasons: [String]
        let officialDomain: String?
    }

    enum Level: String {
        case safe, caution, danger, na
    }

    static let blockThreshold = 55   // مطابق لـ CFG.blockThreshold في engine.js
    static let safeMax = 14          // مطابق لـ CFG.safeMax

    /// الجهات المحمية (نقاط الاستيراد الأساسية من data.js — يمكن توسيعها)
    static let protectedEntities: [(name: String, domain: String, tokens: [String])] = [
        ("مصرف الإمارات دبي الوطني", "emiratesnbd.com", ["emiratesnbd", "enbd"]),
        ("بنك أبوظبي الأول", "adcb.com", ["adcb"]),
        ("بنك أبوظبي الإسلامي", "adib.ae", ["adib"]),
        ("بنك الإمارات الوطني", "bankfab.com", ["bankfab", "fab"]),
        ("بنك دبي الإسلامي", "dib.ae", ["dib"]),
        ("بنك رأس الخيمة", "rakbank.ae", ["rakbank"]),
        ("مصرف المشرق", "mashreq.com", ["mashreq"]),
        ("e& اتصالات", "etisalat.ae", ["etisalat", "eand"]),
        ("du", "du.ae", ["duae"]),
        ("شرطة دبي", "dubaipolice.gov.ae", ["dubaipolice"]),
        ("شرطة أبوظبي", "adpolice.gov.ae", ["adpolice"]),
        ("الهوية والجنسية", "icp.gov.ae", ["icp", "emiratesid"])
    ]

    static let shorteners = [
        "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly",
        "rebrand.ly", "cutt.ly", "rb.gy", "shorturl.at", "tiny.cc"
    ]

    static let badWords = [
        "verify", "secure", "login", "update-account", "confirm-account", "otp",
        "gift", "prize", "winner", "free-money", "refund", "suspended",
        "unlock-account", "careem-pay", "bank-alert"
    ]

    /* ============ استخراج أول رابط من نص رسالة أو إشعار ============ */

    static let urlPattern = try! NSRegularExpression(
        pattern: "(?:https?://|www\\.)[A-Za-z0-9\\-._~:/?#\\[\\]@!$&'()*+,;=%]+",
        options: [.caseInsensitive]
    )

    /// أول رابط http(s) في النص (إن وجد) — كافٍ لفلتر SMS ومراقب الإشعارات
    static func firstURL(in text: String) -> String? {
        let ns = text as NSString
        guard let m = urlPattern.firstMatch(
            in: text, range: NSRange(location: 0, length: ns.length)
        ) else { return nil }
        var u = ns.substring(with: m.range).trimmingCharacters(in: CharacterSet(charactersIn: ".,»')]}\""))
        if !u.lowercased().hasPrefix("http") { u = "https://" + u }
        return u.contains(".") ? u : nil
    }

    /* ============ الفحص المحلي ============ */

    static func analyze(_ rawURL: String) -> Verdict {
        guard let url = URL(string: rawURL), let host = url.host?.lowercased(),
              host.contains(".") else {
            return Verdict(score: 0, level: .na, levelText: "غير قابل للفحص",
                           reasons: [], officialDomain: nil)
        }

        var score = 0
        var reasons: [String] = []
        var official: String? = nil

        func add(_ w: Int, _ text: String) { score += w; reasons.append(text) }

        /* انتحال جهة محمية: token نطاقها الرسمي موجود في مضيف ليس النطاق الرسمي */
        for e in protectedEntities {
            let hit = e.tokens.first { token in
                host.contains(token) && !hostHasExactDomain(host, e.domain)
            }
            if let t = hit {
                add(30, "احتمال انتحال «\(e.name)» — الموقع الرسمي: \(e.domain)")
                official = "https://www." + e.domain
                break
            }
        }

        if host.hasPrefix("xn--") || host.contains(".xn--") {
            add(28, "اسم نطاق بحروف دولية مشفرة (Punycode) — قد يحاكي موقعاً رسمياً بصرياً")
        }
        if isIPHost(host) {
            add(30, "المضيف عنوان IP مباشر — نمط شائع في صفحات الاحتيال")
        }
        if url.scheme?.lowercased() == "http" {
            add(8, "اتصال غير مشفر (HTTP)")
        }
        if shorteners.contains(host) || shorteners.contains(where: { host.hasSuffix("." + $0) }) {
            add(16, "رابط مختصر يخفي الوجهة الحقيقية")
        }
        let lower = rawURL.lowercased()
        if let w = badWords.first(where: { lower.contains($0) }) {
            add(14, "كلمة خطرة في الرابط: \"\(w)\"")
        }
        if lower.contains("@") {
            add(12, "علامة @ داخل الرابط — أسلوب تمويه")
        }

        score = max(0, min(100, score))
        let level: Level
        switch score {
        case blockThreshold...: level = .danger
        case (safeMax + 1)...: level = .caution
        default: level = .safe
        }
        let text: String
        switch level {
        case .danger: text = "خطر"
        case .caution: text = "مشبوه"
        case .safe: text = "آمن"
        case .na: text = "غير قابل للفحص"
        }
        return Verdict(score: score, level: level, levelText: text,
                       reasons: reasons, officialDomain: official)
    }

    /* ============ أدوات ============ */

    private static func hostHasExactDomain(_ host: String, _ domain: String) -> Bool {
        host == domain || host.hasSuffix("." + domain)
    }

    private static func isIPHost(_ host: String) -> Bool {
        let parts = host.split(separator: ".")
        guard parts.count == 4 else { return false }
        return parts.allSatisfy { s in
            let octet = Int(s)
            return octet != nil && octet! >= 0 && octet! <= 255 &&
                s.allSatisfy { $0.isNumber }
        }
    }
}
