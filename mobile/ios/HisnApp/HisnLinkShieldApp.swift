/*
 * حصن (Hisn) — HisnLinkShieldApp.swift
 * التطبيق الرئيسي على iOS — يدعم البديل 2 على iPhone:
 * عندما يختار المستخدم «حصن» من زر المشاركة أو يجعله المتصفح الافتراضي
 * (iOS 14+ لتطبيقات المتصفح)، يمر أي رابط عبر الفحص أولاً:
 * آمن → يُفتح في WebKit داخلي فوراً | خبيث → شاشة تحذير حمراء.
 */

import SwiftUI

@main
struct HisnLinkShieldApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
