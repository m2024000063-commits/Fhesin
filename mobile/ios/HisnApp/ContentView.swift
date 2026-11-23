/*
 * حصن (Hisn) — ContentView.swift
 * لوحة الحالة الرئيسية: حالة معترض الروابط، حالة فلتر الرسائل،
 * عنوان الخادم السحابي، وفحص يدوي سريع.
 */

import SwiftUI

struct ContentView: View {
    @AppStorage("hisn_server") private var serverBase: String = ""

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("الخادم السحابي")) {
                    TextField("https://hisn-yourname.vercel.app", text: $serverBase)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                    Text("الفحص يعمل بالخادم السحابي مع سقوط تلقائي إلى القواعد المحلية المدمجة عند غياب الشبكة.")
                        .font(.footnote).foregroundColor(.secondary)
                }

                Section(header: Text("🛡️ معترض الروابط الذكي")) {
                    Text("أي رابط تشاركه من واتساب أو الرسائل أو الإيميل إلى «حصن» يُفحص فوراً: آمن؟ يُفتح في المتصفح الداخلي خلال أجزاء من الثانية. خبيث؟ شاشة تحذير حمراء.")
                        .font(.footnote).foregroundColor(.secondary)
                    Text("أضف حصن إلى أنشطة زر المشاركة من المشاركة ← أكثر ← تفعيل حصن، أو اجعله المتصفح الافتراضي من: الإعدادات ← حصن ← تطبيق المتصفح الافتراضي (إن ظهر الخيار).")
                        .font(.footnote).foregroundColor(.secondary)
                }

                Section(header: Text("📩 فلتر الرسائل النصية (SMS)")) {
                    Text("بعد تثبيت التطبيق مع ملحق MessageFilterExtension (يتطلب موافقة Apple على الصلاحية — انظر دليل البناء):")
                        .font(.footnote).foregroundColor(.secondary)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("1. الإعدادات ← الرسائل ← الرسائل غير المعروفة والمزعجة.")
                        Text("2. فعّل «تصفية الرسائل غير المعروفة».")
                        Text("3. اختر «حصن» كمُصفِّي.")
                    }
                    .font(.footnote)
                    Text("من بعدها كل رسالة من مرسل غير معروف تُفحص تلقائياً في الخلفية؛ الرسائل التي تحمل رابطاً خبيثاً تنتقل إلى مجلد «الرسائل غير المرغوب فيها» مع تنبيه.")
                        .font(.footnote).foregroundColor(.secondary)
                }

                Section(header: Text("⚡ فحص يدوي سريع")) {
                    ManualScanView(serverBase: serverBase)
                }
            }
            .navigationTitle("حصن — درع الروابط")
        }
    }
}

struct ManualScanView: View {
    let serverBase: String
    @State private var input: String = ""
    @State private var result: String? = nil
    @State private var isScanning: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("الصق أي رابط هنا…", text: $input)
                .keyboardType(.URL)
                .autocapitalization(.none)
                .disableAutocorrection(true)
            Button {
                scanNow()
            } label: {
                if isScanning { ProgressView() } else { Text("افحص") }
            }
            .buttonStyle(.borderedProminent)
            if let r = result {
                Text(r).font(.footnote)
            }
        }
    }

    private func scanNow() {
        var v = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !v.isEmpty else { return }
        if v.contains(" ") {
            result = "الرابط يحتوي فراغات — انسخه كاملاً دون فراغات"
            return
        }
        if !v.lowercased().hasPrefix("http") { v = "https://" + v }
        isScanning = true
        result = nil
        ScanService.scan(url: v, source: "direct", serverBase: serverBase) { verdict in
            isScanning = false
            let icon: String
            switch verdict.level {
            case "danger": icon = "🔴"
            case "caution": icon = "🟡"
            case "safe": icon = "🟢"
            default: icon = "⚪️"
            }
            var lines = ["\(icon) \(verdict.levelText.isEmpty ? verdict.level : verdict.levelText) — \(verdict.score)/100" +
                         (verdict.cloud ? "  · فحص سحابي" : "  · فحص محلي")]
            verdict.reasons.prefix(3).forEach { lines.append("• " + $0) }
            result = lines.joined(separator: "\n")
        }
    }
}
