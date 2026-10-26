# Time Sensitive Targeting SOS — offline Quest APK

This folder builds a signed APK that contains the briefing. The headset does not open `https://sosgit-app.github.io`. Launching the app serves the packaged files at `http://127.0.0.1` on the headset and hands that page to the Quest browser, which is the engine that can enter WebXR.

Package name `com.sosgitapp.a3ftx`, Horizon app `1495584703629935`, version code 3. It is signed with the same key as `quest/android.keystore`. Upload `app-release-signed.apk` in the Meta Horizon dashboard for Time Sensitive Targeting SOS.

```text
cd /d "c:\Users\MichaelHernandez\A3 FTX\offlinequest"
set PATH=%LOCALAPPDATA%\nodejs-portable\node-v22.14.0-win-x64;%PATH%
npm run build
```

The map, aircraft board, ordinance board, and controller models are inside the APK. After the app opens, choose **Start game in VR**.
