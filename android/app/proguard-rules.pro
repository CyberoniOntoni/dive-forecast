# R8 rules for the release build. Libraries bring their own (kotlinx.serialization, Room, OkHttp, MapLibre, Coil);
# keep this file to what the app itself needs.

# Readable crash traces in Play Console: keep line numbers, hide the source file names behind one name.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# kotlinx.serialization: keep each @Serializable class's generated serializer and companion, so the API models,
# saved navigation keys and offline areas still decode after shrinking. The library's own rules cover the usual case;
# these name the app's package so a lookup by serializer<T>() on a nested or generic class cannot be stripped. Tested
# on a phone with them (18 Nov 2026); drop them only with another release run on a device.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers @kotlinx.serialization.Serializable class app.fiftybar.divecurrent.** {
    *** Companion;
    static ** INSTANCE;
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class app.fiftybar.divecurrent.**$$serializer { *; }
