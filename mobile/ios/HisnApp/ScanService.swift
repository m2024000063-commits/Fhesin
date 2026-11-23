/*
 * حصن (Hisn) — ScanService.swift
 * عميل الفحص السحابي الموحد لجميع مكونات iOS:
 * GET {server}/api/scan?url=...&source=... → JSON {ok, verdict:{score, level, levelText, reasons[], comparison}}
 * مهلة قصيرة (3 ثوان) ثم سقوط تلقائي إلى القواعد المحلية SharedRules — أجزاء من الثانية.
 */

import Foundation

struct HisnVerdict {
    let url: String
    let score: Int
    let level: String          // safe | caution | danger | na
    let levelText: String
    let reasons: [String]
    let officialURL: String?
    let cloud: Bool
}

enum ScanService {

    /// الفحص الكامل: سحابة أولاً بمهلة قصيرة، ثم السقوط المحلي الفوري
    static func scan(url: String,
                     source: String,
                     serverBase: String,
                     completion: @escaping (HisnVerdict) -> Void) {
        guard !serverBase.trimmingCharacters(in: .whitespaces).isEmpty else {
            completion(local(url)); return
        }
        cloudScan(url: url, source: source, serverBase: serverBase) { cloudResult in
            completion(cloudResult ?? local(url))
        }
    }

    /// نسخة متزامنة بخيط واحد لاستخدامها في ILMessageFilterExtension (المتطلب الرسمي)
    static func scanBlocking(url: String, source: String, serverBase: String) -> HisnVerdict {
        let sem = DispatchSemaphore(value: 0)
        var result: HisnVerdict? = nil
        scan(url: url, source: source, serverBase: serverBase) { v in
            result = v
            sem.signal()
        }
        _ = sem.wait(timeout: .now() + 5)
        return result ?? local(url)
    }

    /* ============ السحابة ============ */

    private static func cloudScan(url: String,
                                  source: String,
                                  serverBase: String,
                                  completion: @escaping (HisnVerdict?) -> Void) {
        guard let endpoint = cloudEndpoint(serverBase: serverBase, url: url, source: source),
              let target = URL(string: endpoint) else {
            DispatchQueue.main.async { completion(nil) }
            return
        }
        var req = URLRequest(url: target)
        req.timeoutInterval = 3.0
        req.httpMethod = "GET"
        URLSession.shared.dataTask(with: req) { data, response, _ in
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let data = data,
                  let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  (obj["ok"] as? Bool) == true,
                  let v = obj["verdict"] as? [String: Any] else {
                DispatchQueue.main.async { completion(nil) }
                return
            }
            let cmp = v["comparison"] as? [String: Any]
            let verdict = HisnVerdict(
                url: (v["url"] as? String) ?? url,
                score: (v["score"] as? Int) ?? 0,
                level: (v["level"] as? String) ?? "na",
                levelText: (v["levelText"] as? String) ?? "",
                reasons: ((v["reasons"] as? [[String: Any]]) ?? [])
                    .compactMap { $0["text"] as? String },
                officialURL: cmp?["officialUrl"] as? String,
                cloud: true
            )
            DispatchQueue.main.async { completion(verdict) }
        }.resume()
    }

    private static func cloudEndpoint(serverBase: String, url: String, source: String) -> String? {
        let base = serverBase.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        guard !base.isEmpty, base.lowercased().hasPrefix("https://"),
              var comps = URLComponents(string: base + "/api/scan") else { return nil }
        comps.queryItems = [
            URLQueryItem(name: "url", value: url),
            URLQueryItem(name: "source", value: source)
        ]
        return comps.string
    }

    /* ============ السقوط المحلي (SharedRules) ============ */

    static func local(_ url: String) -> HisnVerdict {
        let v = HisnRules.analyze(url)
        return HisnVerdict(
            url: url,
            score: v.score,
            level: v.level.rawValue,
            levelText: v.levelText,
            reasons: v.reasons,
            officialURL: v.officialDomain,
            cloud: false
        )
    }
}
