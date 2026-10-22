# Al-Rimal Quest — Meta Quest store build

This folder is the signed APK that gets uploaded to the [Meta Horizon Developer Dashboard](https://developers.meta.com/manage/). It does not contain a second copy of the game. Meta’s packaging tool wraps the live briefing at `https://sosgit-app.github.io/A3FTX/` as an immersive Quest app (`com.sosgitapp.a3ftx`).

Opening the installed app enters VR immediately. The browser site still shows the landing menu.

## Before the first signed build

1. Create the app in the Developer Dashboard and copy its numeric Horizon application id.
2. Put that id in `applicationId` in `twa-manifest.json`. Leave it as `"0"` only for a sideload test. The store upload should use the real id.
3. Commit and push this repo so these URLs are live:
   - `https://sosgit-app.github.io/A3FTX/manifest.webmanifest`
   - `https://sosgit-app.github.io/A3FTX/icons/icon-512.png`
4. From this folder, run `npm run doctor` once and let Bubblewrap install its JDK and Android SDK.

The signing key does not exist yet. The first `bubblewrap build` creates `android.keystore`. Back that file up outside this repo. Every future update must use the same key and the same package name `com.sosgitapp.a3ftx`. Passwords for that key go in `keystore.properties`, which is not committed.

## Build

```powershell
npm run update
$env:BUBBLEWRAP_KEYSTORE_PASSWORD = "<store password>"
$env:BUBBLEWRAP_KEY_PASSWORD = "<key password>"
npm run build
```

`npm run update` reads the live web manifest and writes the Android project. `npm run build` writes `app-release-signed.apk` and an `.aab`. Upload the signed APK from the dashboard’s release channel (Meta Quest Developer Hub, App Distribution, Upload).

## Digital Asset Links

An immersive Quest app will not launch until the site proves it owns this package. After the keystore exists, print its certificate:

```powershell
keytool -list -v -keystore android.keystore -alias android
```

Put the SHA-256 fingerprint into `assetlinks.json` and publish that file at:

`https://sosgit-app.github.io/.well-known/assetlinks.json`

That URL is the root of the `sosgit-app.github.io` site, not a path under `/A3FTX/`. It has to live in a repository named `SOSgit-app.github.io`.

## Do not commit

`android.keystore`, `keystore.properties`, and the built `.apk` / `.aab` files.
