const fs = require("fs");
const path = require("path");

const target = path.join(__dirname, "node_modules/@meta-quest/bubblewrap-core/dist/lib/util.js");
const original = `async function executeFile(cmd, args, env, log, cwd) {
    if (log) {
        log.debug(\`Executing command \${cmd} with args \${args}\`);
    }
    return await execFilePromise(cmd, args, { env: env, cwd: cwd });
}`;
const patched = `async function executeFile(cmd, args, env, log, cwd) {
    if (log) {
        log.debug(\`Executing command \${cmd} with args \${args}\`);
    }
    // Node 22 on Windows rejects spawning .bat/.cmd directly (spawn EINVAL).
    if (process.platform === 'win32' && /\\.(bat|cmd)$/i.test(cmd)) {
        const comspec = process.env.ComSpec || 'cmd.exe';
        return await execFilePromise(comspec, ['/d', '/s', '/c', cmd, ...args], { env: env, cwd: cwd });
    }
    return await execFilePromise(cmd, args, { env: env, cwd: cwd });
}`;

if (!fs.existsSync(target)) {
  process.exit(0);
}
const source = fs.readFileSync(target, "utf8");
if (source.includes("Node 22 on Windows")) {
  process.exit(0);
}
if (!source.includes(original)) {
  console.warn("Bubblewrap spawn patch did not match. Build may still fail on Node 22.");
  process.exit(0);
}
fs.writeFileSync(target, source.replace(original, patched));
