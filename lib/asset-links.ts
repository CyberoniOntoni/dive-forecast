/**
 * Digital Asset Links for https://50bar.app/.well-known/assetlinks.json: lets Android verify that the 50Bar app
 * (package app.fiftybar) may open 50bar.app links itself (the autoVerify intent filter in
 * android/app/src/main/AndroidManifest.xml). The fingerprints are the ones Google Play Console lists for the app
 * (Play app signing key, upload key and the third key it shows); add a key here if Play ever lists another.
 * Served as application/json by app/.well-known/assetlinks.json/route.ts; Play's check fails on any other type.
 */
export const ANDROID_PACKAGE = "app.fiftybar";

export const ANDROID_CERT_SHA256 = [
  "E1:63:26:B2:B6:CD:FD:B3:79:AC:19:B9:9E:4D:D3:32:A4:F8:F5:42:CD:6D:2A:2C:9D:09:53:DA:6C:33:6D:AE",
  "65:11:4E:3B:C2:48:EF:32:87:EC:C9:F2:4A:0E:EB:6F:5F:E0:B2:17:3A:FD:45:C6:67:9C:02:80:E1:8B:23:AE",
  "3A:72:71:09:1E:3F:5A:65:B0:8E:00:F6:D0:A9:CE:79:07:4D:6A:EA:A9:7C:7F:B1:F3:87:19:54:C5:BB:29:FC",
];

export const ASSET_LINKS = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: ANDROID_PACKAGE,
      sha256_cert_fingerprints: ANDROID_CERT_SHA256,
    },
  },
];
