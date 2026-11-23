# حصن — قواعد الخلط (proguard)
# بلا تبعيات خارجية فالقواعد أدنى حد؛ نحفظ الأنشطة لأنها مدخل intents خارجية
-keep class com.hisn.shield.InterceptorActivity { *; }
-keep class com.hisn.shield.NotificationWatcher { *; }
-keepattributes *Annotation*
