const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const offlineDir = __dirname;
const root = path.resolve(offlineDir, "..");
const vrDir = path.join(root, "packages", "vr");
const profilesDir = path.join(vrDir, "public", "webxr-profiles");
const dist = path.join(vrDir, "dist");
const www = path.join(offlineDir, "app", "src", "main", "assets", "www");
const PROFILE_VERSION = "1.0.19";
const PROFILES = [
  "generic-trigger",
  "generic-trigger-squeeze-thumbstick",
  "oculus-touch",
  "oculus-touch-v2",
  "oculus-touch-v3",
  "meta-quest-touch-plus",
  "meta-quest-touch-plus-v2",
  "meta-quest-touch-pro",
];

async function downloadProfiles() {
  const list = {};
  for (const name of PROFILES) {
    const profileUrl = `https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@${PROFILE_VERSION}/dist/profiles/${name}/profile.json`;
    const response = await fetch(profileUrl);
    if (!response.ok) {
      console.warn(`Skipping missing controller profile ${name}`);
      continue;
    }
    const profile = await response.json();
    const dir = path.join(profilesDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "profile.json"), JSON.stringify(profile));
    const assets = new Set();
    for (const layout of Object.values(profile.layouts || {})) {
      if (layout.assetPath) assets.add(layout.assetPath);
    }
    for (const assetName of assets) {
      const assetPath = path.join(dir, assetName);
      if (!fs.existsSync(assetPath)) {
        const assetUrl = `https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@${PROFILE_VERSION}/dist/profiles/${name}/${assetName}`;
        const assetResponse = await fetch(assetUrl);
        if (!assetResponse.ok) {
          throw new Error(`Could not download ${assetUrl}`);
        }
        fs.writeFileSync(assetPath, Buffer.from(await assetResponse.arrayBuffer()));
      }
    }
    list[name] = { path: `${name}/profile.json` };
  }
  fs.writeFileSync(path.join(profilesDir, "profilesList.json"), JSON.stringify(list));
}

function buildWeb() {
  const env = { ...process.env };
  delete env.GITHUB_PAGES;
  const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
  const build = spawnSync(process.execPath, [vite, "build"], {
    cwd: vrDir,
    env,
    stdio: "inherit",
  });
  if (build.status !== 0) process.exit(build.status || 1);
}

function packageAssets() {
  fs.rmSync(www, { recursive: true, force: true });
  fs.cpSync(dist, www, { recursive: true });
  const manifestPath = path.join(www, "manifest.webmanifest");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.start_url = "./";
    manifest.scope = "./";
    if (Array.isArray(manifest.icons)) {
      for (const icon of manifest.icons) {
        if (typeof icon.src === "string") icon.src = icon.src.replace(/^\/A3FTX\//, "./");
      }
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  }
  const index = path.join(www, "index.html");
  if (!fs.existsSync(index)) {
    console.error("Offline bundle is missing index.html");
    process.exit(1);
  }
  const html = fs.readFileSync(index, "utf8");
  if (html.includes("sosgit-app.github.io") || html.includes("/A3FTX/")) {
    console.error("The packaged page still points at the website.");
    process.exit(1);
  }
}

function copyIcon() {
  const from = path.join(vrDir, "public", "icons", "icon-512.png");
  const dir = path.join(offlineDir, "app", "src", "main", "res", "drawable-nodpi");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(from, path.join(dir, "ic_launcher.png"));
}

function writeLocalProperties() {
  const sdk = path.join(process.env.USERPROFILE, ".bubblewrap", "android_sdk");
  const line = `sdk.dir=${sdk.replace(/\\/g, "\\\\")}\n`;
  fs.writeFileSync(path.join(offlineDir, "local.properties"), line);
}

function gradleBuild() {
  const javaHome = path.join(process.env.USERPROFILE, ".bubblewrap", "jdk", "jdk-17.0.11+9");
  const env = { ...process.env, JAVA_HOME: javaHome };
  const comspec = process.env.ComSpec || "cmd.exe";
  const build = spawnSync(comspec, ["/d", "/s", "/c", "gradlew.bat", "assembleRelease"], {
    cwd: offlineDir,
    env,
    stdio: "inherit",
  });
  if (build.status !== 0) process.exit(build.status || 1);
  const built = path.join(offlineDir, "app", "build", "outputs", "apk", "release", "app-release.apk");
  const signed = path.join(offlineDir, "app-release-signed.apk");
  fs.copyFileSync(built, signed);
  console.log(`Signed offline APK: ${signed}`);
}

async function main() {
  await downloadProfiles();
  buildWeb();
  packageAssets();
  copyIcon();
  writeLocalProperties();
  gradleBuild();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
