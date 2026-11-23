/*
 * حصن (Hisn) — InterceptorView.swift (البديل 2 على iOS)
 *
 * الشاشة التي تستقبل الروابط الواردة إلى حصن (زر المشاركة / المتصفح الافتراضي):
 *  1) مؤشر فحص — أجزاء من الثانية (سحابة بمهلة 3 ثوان + سقوط محلي فوري).
 *  2) آمن → تحميل الصفحة مباشرة في WKWebView الداخلي دون أي شاشة وسيطة.
 *  3) مشبوه → شاشة تنبيه كهرمانية.
 *  4) خبيث → شاشة تحذير حمراء كاملة — لا تحميل إطلاقاً.
 */

import SwiftUI
import WebKit

struct IncomingLinkView: View {
    let incomingURL: URL
    let serverBase: String

    var body: some View {
        InterceptorFlow(url: incomingURL, serverBase: serverBase)
    }
}

private struct InterceptorFlow: View {
    let url: URL
    let serverBase: String

    @State private var phase: Phase = .scanning
    @State private var verdict: HisnVerdict? = nil

    enum Phase { case scanning, browsing, warnCaution, warnDanger }

    var body: some View {
        switch phase {
        case .scanning:
            VStack(spacing: 14) {
                ProgressView().scaleEffect(1.4)
                Text("جارٍ فحص الرابط…").font(.headline)
                Text(url.host ?? "").font(.caption).foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .task { runScan() }

        case .browsing:
            InlineBrowser(url: url)

        case .warnCaution:
            WarningScreen(url: url, verdict: verdict, amber: true) {
                phase = .browsing
            } onBack: {
                phase = .scanning // لن يُستخدم — زر الرجوع يغلق فقط
            }

        case .warnDanger:
            WarningScreen(url: url, verdict: verdict, amber: false) {
                phase = .scanning
            } onBack: {
                phase = .scanning
            }
        }
    }

    private func runScan() {
        ScanService.scan(url: url.absoluteString, source: "interceptor", serverBase: serverBase) { v in
            verdict = v
            switch v.level {
            case "danger": phase = .warnDanger
            case "caution": phase = .warnCaution
            default: phase = .browsing   // آمن أو غير قابل للفحص → فتح فوري
            }
        }
    }
}

/* ============ المتصفح الداخلي — يفتح بعد اجتياز الفحص ============ */

struct InlineBrowser: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.allowsBackForwardNavigationGestures = true
        wv.load(URLRequest(url: url))
        return wv
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/* ============ شاشة التحذير ============ */

struct WarningScreen: View {
    let url: URL
    let verdict: HisnVerdict?
    let amber: Bool
    let onContinue: () -> Void
    let onBack: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("⚠️").font(.system(size: 52))
                Text(amber ? "تنبيه — رابط مشبوه" : "توقف — رابط خبيث")
                    .font(.title.bold())
                    .foregroundColor(amber ? Color.orange : Color.red)

                Text(url.host ?? url.absoluteString)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundColor(.blue)

                Text(amber
                     ? "هذا الرابط مشبوه — راجع الأسباب قبل أي إجراء."
                     : "حصن أوقف فتح هذا الرابط لأنه مصنّف كخطر:\nقد يكون موقع بنك أو جهة مقلدة لسرقة بياناتك المالية أو رمز التحقق.")
                    .font(.body)

                if let v = verdict {
                    Text((amber ? "🟡 " : "🔴 ") + "\(v.score)/100" + (v.cloud ? "  · فحص سحابي" : "  · فحص محلي"))
                        .font(.footnote).foregroundColor(.secondary)

                    VStack(alignment: .leading, spacing: 6) {
                        Text("أسباب التصنيف:").font(.footnote.bold()).foregroundColor(.secondary)
                        ForEach(v.reasons.prefix(5), id: \.self) { Text("• " + $0).font(.footnote) }
                    }
                }

                if !amber, let official = verdict?.officialURL, let u = URL(string: official) {
                    Button {
                        UIApplication.shared.open(u)
                    } label: {
                        Label("فتح الموقع الرسمي الصحيح", systemImage: "arrow.up.right")
                    }
                    .buttonStyle(.bordered)
                }

                if amber {
                    Button("فتح على مسؤوليتي", action: onContinue)
                        .buttonStyle(.borderedProminent)
                        .tint(.orange)
                }

                Button("رجوع آمن", action: onBack)
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
            }
            .padding(22)
        }
        .background(amber ? Color(white: 0.96) : Color(red: 0.12, green: 0.03, blue: 0.03))
    }
}
