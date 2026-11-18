plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.kotlin.serialization)
  alias(libs.plugins.ksp)
}

/**
 * The server the app reads /api/v1 from. Release builds use the live site. Debug builds use the Next.js dev server
 * as the emulator sees it (10.0.2.2 is the host machine); set `devApiBaseUrl=https://…` in gradle.properties or
 * ~/.gradle/gradle.properties to point a debug build somewhere else, for example the live site or a PR preview.
 */
val releaseApiBaseUrl = "https://50bar.app"
val devApiBaseUrl = (findProperty("devApiBaseUrl") as String?) ?: "http://10.0.2.2:3000"

/**
 * Release signing with the Play upload key, from the environment (the `android-release` workflow writes the keystore
 * from GitHub secrets; see android/README.md § Releasing to Google Play). Without ANDROID_KEYSTORE_PATH a release
 * build is unsigned, as before. Play re-signs the app with its own app-signing key.
 */
val uploadKeystore = System.getenv("ANDROID_KEYSTORE_PATH")?.takeIf { it.isNotBlank() }?.let { file(it) }

/** Play needs every upload's versionCode higher than the last; the release workflow passes its run number. */
val appVersionCode = (findProperty("versionCode") as String?)?.toInt() ?: 1
val appVersionName = (findProperty("versionName") as String?) ?: "1.0"

android {
  namespace = "app.fiftybar.divecurrent"
  compileSdk = 37
  defaultConfig {
    applicationId = "app.fiftybar"
    minSdk = 26
    targetSdk = 37
    versionCode = appVersionCode
    versionName = appVersionName
    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    // Share links and "Open on the web" always go to the public site, whatever server the build reads.
    buildConfigField("String", "WEB_URL", "\"$releaseApiBaseUrl\"")
  }

  signingConfigs {
    if (uploadKeystore != null) {
      create("upload") {
        storeFile = uploadKeystore
        storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
        keyAlias = System.getenv("ANDROID_KEY_ALIAS")
        keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
      }
    }
  }

  buildTypes {
    debug {
      buildConfigField("String", "API_BASE_URL", "\"$devApiBaseUrl\"")
    }
    release {
      buildConfigField("String", "API_BASE_URL", "\"$releaseApiBaseUrl\"")
      if (uploadKeystore != null) signingConfig = signingConfigs.getByName("upload")
      // R8 shrinks the app; the bundle carries its mapping file, so Play decodes crash traces itself. The libraries'
      // own keep rules (kotlinx.serialization, Room, OkHttp, MapLibre) come with them; ours are in proguard-rules.pro.
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      // No ndk { debugSymbolLevel }: the only native code is MapLibre's prebuilt, already-stripped .so files, so AGP
      // has no symbols to pack (MapLibre publishes them as a separate debug-symbols archive on its GitHub releases).
    }
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  buildFeatures {
    compose = true
    aidl = false
    buildConfig = true
    shaders = false
  }

  packaging {
    resources {
      excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
  }
}

kotlin {
  jvmToolchain(17)
}

ksp {
  arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
  val composeBom = platform(libs.androidx.compose.bom)
  implementation(composeBom)
  androidTestImplementation(composeBom)

  // Core Android dependencies
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.activity.compose)

  // Arch Components
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.lifecycle.viewmodel.compose)

  // Compose
  implementation(libs.androidx.compose.ui)
  implementation(libs.androidx.compose.ui.tooling.preview)
  implementation(libs.androidx.compose.material3)
  implementation(libs.androidx.compose.material.icons.core)
  // Tooling
  debugImplementation(libs.androidx.compose.ui.tooling)
  // Instrumented tests
  androidTestImplementation(libs.androidx.compose.ui.test.junit4)
  debugImplementation(libs.androidx.compose.ui.test.manifest)

  // Network and JSON (API.md: ignore unknown fields)
  implementation(libs.okhttp)
  implementation(libs.kotlinx.serialization.json)

  // Offline copy of the last body per endpoint
  implementation(libs.androidx.room.runtime)
  implementation(libs.androidx.room.ktx)
  ksp(libs.androidx.room.compiler)

  // Map and site photos
  implementation(libs.maplibre.android)
  implementation(libs.coil.compose)
  implementation(libs.coil.network.okhttp)

  // Local tests: jUnit, coroutines, a fake server
  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)
  testImplementation(libs.okhttp.mockwebserver)

  // Instrumented tests: jUnit rules and runners
  androidTestImplementation(libs.androidx.test.core)
  androidTestImplementation(libs.androidx.test.ext.junit)
  androidTestImplementation(libs.androidx.test.runner)
  androidTestImplementation(libs.androidx.test.espresso.core)

  // Navigation
  implementation(libs.androidx.navigation3.ui)
  implementation(libs.androidx.navigation3.runtime)
  implementation(libs.androidx.lifecycle.viewmodel.navigation3)
}
