import { spawn } from 'node:child_process';
import { readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CLASP_JSON = resolve(REPO_ROOT, '.clasp.json');
const STRAY_FILES = ['Code.js', 'appsscript.json'];
const STRAY_MTIME_WINDOW_MS = 60_000;
const PLACEHOLDER_ID = 'YOUR_SCRIPT_ID_HERE';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (Number.isNaN(major) || major < 22) {
    fail(
      `Node 22 or newer is required (found ${process.versions.node}). ` +
        `Install Node 22+ from https://nodejs.org and re-run 'npm install && npm run setup'.`
    );
  }
}

function runInherit(cmd, args, opts = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { stdio: 'inherit', cwd: REPO_ROOT, ...opts });
    child.on('close', (code) => resolvePromise(code ?? 1));
    child.on('error', () => resolvePromise(1));
  });
}

function runCapture(cmd, args, opts = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      cwd: REPO_ROOT,
      ...opts,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on('close', (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
    child.on('error', (err) => resolvePromise({ code: 1, stdout, stderr: stderr + String(err) }));
  });
}

function clasp(args, { capture = false } = {}) {
  const fullArgs = ['--no-install', 'clasp', ...args];
  return capture ? runCapture('npx', fullArgs) : runInherit('npx', fullArgs);
}

async function readClaspJson() {
  if (!existsSync(CLASP_JSON)) return null;
  try {
    const raw = await readFile(CLASP_JSON, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function hasRealScriptId(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const id = obj.scriptId;
  return typeof id === 'string' && id.length > 0 && id !== PLACEHOLDER_ID;
}

async function ensureLoggedIn() {
  const status = await clasp(['show-authorized-user'], { capture: true });
  if (status.code === 0 && /logged in as/i.test(status.stdout + status.stderr)) return;

  console.log('\nNot logged in to clasp — launching browser login.');
  const loginCode = await clasp(['login']);
  if (loginCode !== 0) {
    fail(
      'clasp login failed. Make sure the Apps Script API is enabled at ' +
        'https://script.google.com/home/usersettings, then re-run `npm run setup`.'
    );
  }

  const recheck = await clasp(['show-authorized-user'], { capture: true });
  if (recheck.code !== 0 || !/logged in/i.test(recheck.stdout + recheck.stderr)) {
    fail(
      'Still not logged in after `clasp login`. Enable the Apps Script API at ' +
        'https://script.google.com/home/usersettings and re-run `npm run setup`.'
    );
  }
}

async function promptTitle() {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question('Project title [Prioritize]: ');
    const trimmed = (answer || '').trim();
    return trimmed.length === 0 ? 'Prioritize' : trimmed;
  } finally {
    rl.close();
  }
}

async function cleanupStrayFiles(startMs) {
  for (const name of STRAY_FILES) {
    const path = resolve(REPO_ROOT, name);
    if (!existsSync(path)) continue;
    try {
      const s = await stat(path);
      const mtime = s.mtimeMs;
      if (mtime >= startMs - STRAY_MTIME_WINDOW_MS && Date.now() - mtime <= STRAY_MTIME_WINDOW_MS) {
        await unlink(path);
      }
    } catch {
      // Ignore — leave files alone if we can't stat/unlink them cleanly.
    }
  }
}

async function patchClaspJson() {
  const raw = await readFile(CLASP_JSON, 'utf8');
  const obj = JSON.parse(raw);
  if (obj.rootDir === 'src') return obj;
  obj.rootDir = 'src';
  await writeFile(CLASP_JSON, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  return obj;
}

async function createProject(title) {
  const startMs = Date.now();
  const code = await clasp(['create-script', '--type', 'standalone', '--title', title]);
  if (code !== 0) {
    fail(
      'clasp create-script failed. If a project was partially created, delete .clasp.json ' +
        'and re-run `npm run setup`.'
    );
  }
  if (!existsSync(CLASP_JSON)) {
    fail('clasp create-script did not produce a .clasp.json. Re-run `npm run setup`.');
  }
  const patched = await patchClaspJson();
  await cleanupStrayFiles(startMs);
  return patched;
}

async function push(scriptId) {
  const code = await clasp(['push', '--force']);
  if (code !== 0) {
    const editUrl = `https://script.google.com/d/${scriptId}/edit`;
    fail(
      `clasp push failed. Apps Script project created: ${editUrl}\n` +
        'Fix the reported issue and re-run `npm run setup` — it will detect the existing project and retry.'
    );
  }
}

function parseDeploymentId(stdout) {
  const match =
    stdout.match(/Deployment ID:\s*([A-Za-z0-9_-]+)/) ||
    stdout.match(/Deployed\s+([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

async function deploy(scriptId) {
  const result = await clasp(['deploy', '--description', 'Deployed via npm run setup'], {
    capture: true,
  });
  if (result.code !== 0) {
    fail(
      `clasp deploy failed. Open https://script.google.com/d/${scriptId}/edit and deploy manually, ` +
        'or re-run `npm run setup`.'
    );
  }
  return result.stdout;
}

async function promptAndOpen(url) {
  if (!process.stdout.isTTY || !process.stdin.isTTY) return;
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  const rl = createInterface({ input, output });
  try {
    await rl.question('Press Enter to open the web app in your browser (Ctrl-C to skip)… ');
  } catch {
    return;
  } finally {
    rl.close();
  }
  spawn(cmd, [url], {
    stdio: 'ignore',
    detached: true,
    shell: process.platform === 'win32',
  }).unref();
}

function link(url, label = url) {
  if (!process.stdout.isTTY) return label === url ? url : `${label} (${url})`;
  return `\u001B]8;;${url}\u0007${label}\u001B]8;;\u0007`;
}

function printSuccess({ scriptId, deploymentId, rawDeployStdout, title }) {
  const header = '\n================  Prioritize deployed  ================';
  console.log(header);

  if (deploymentId) {
    const webUrl = `https://script.google.com/macros/s/${deploymentId}/exec`;
    const adminUrl = `${webUrl}?v=admin`;
    console.log(`Web app:   ${link(webUrl)}`);
    console.log(`Admin:     ${link(adminUrl)}`);
  } else {
    const editUrl = `https://script.google.com/d/${scriptId}/edit`;
    console.log('Could not parse deployment ID from clasp output.');
    console.log('Raw clasp deploy output follows:');
    console.log(rawDeployStdout);
    console.log(`Manage deployments: ${link(editUrl)}`);
  }

  const sheetName = /prioritize/i.test(title) ? title : `Prioritize — ${title}`;
  const sheetSearchUrl = `https://drive.google.com/drive/search?q=${encodeURIComponent(`type:spreadsheet ${sheetName}`)}`;
  console.log('');
  console.log(
    `Open the web app URL once — it auto-creates the backing Sheet in your Drive, named "${sheetName}".`
  );
  console.log(`Drive search fallback: ${link(sheetSearchUrl)}`);
  console.log('To redeploy after code changes: `npm run setup` (idempotent).');
  console.log('========================================================\n');

  if (deploymentId) {
    return `https://script.google.com/macros/s/${deploymentId}/exec`;
  }
  return null;
}

async function main() {
  checkNodeVersion();

  const existing = await readClaspJson();
  if (hasRealScriptId(existing)) {
    console.log(
      `Found existing .clasp.json for scriptId ${existing.scriptId}. Pushing + deploying.`
    );
    await ensureLoggedIn();
    await push(existing.scriptId);
    const stdout = await deploy(existing.scriptId);
    const deploymentId = parseDeploymentId(stdout);
    const webUrl = printSuccess({
      scriptId: existing.scriptId,
      deploymentId,
      rawDeployStdout: stdout,
      title: 'Prioritize',
    });
    if (webUrl) await promptAndOpen(webUrl);
    return;
  }

  await ensureLoggedIn();
  const title = await promptTitle();
  const claspJson = await createProject(title);
  await push(claspJson.scriptId);
  const stdout = await deploy(claspJson.scriptId);
  const deploymentId = parseDeploymentId(stdout);
  const webUrl = printSuccess({
    scriptId: claspJson.scriptId,
    deploymentId,
    rawDeployStdout: stdout,
    title,
  });
  if (webUrl) await promptAndOpen(webUrl);
}

try {
  await main();
} catch (err) {
  fail(`Unexpected error: ${err && err.message ? err.message : String(err)}`);
}
