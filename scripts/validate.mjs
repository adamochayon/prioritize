import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import Ajv from 'ajv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const MANIFEST_PATH = resolve(REPO_ROOT, 'src/appsscript.json');
const REQUIRED_FILES = [
  'src/Code.gs',
  'src/Index.html',
  'src/Admin.html',
  'src/NotAuthorized.html',
];
const SYNTAX_CHECK_FILES = ['scripts/setup.mjs', 'scripts/validate.mjs'];

const MANIFEST_SCHEMA = {
  type: 'object',
  properties: {
    timeZone: { type: 'string' },
    runtimeVersion: { type: 'string', enum: ['V8', 'DEPRECATED_ES5'] },
    exceptionLogging: { type: 'string' },
    dependencies: { type: 'object' },
    webapp: {
      type: 'object',
      required: ['executeAs', 'access'],
      properties: {
        executeAs: { type: 'string', enum: ['USER_ACCESSING', 'USER_DEPLOYING'] },
        access: {
          type: 'string',
          enum: ['MYSELF', 'DOMAIN', 'ANYONE', 'ANYONE_ANONYMOUS'],
        },
      },
    },
  },
  required: ['webapp'],
};

const failures = [];
const passes = [];

function pass(msg) {
  passes.push(msg);
}

function fail(msg) {
  failures.push(msg);
}

async function readJson(path) {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

async function checkManifestParses() {
  try {
    const parsed = await readJson(MANIFEST_PATH);
    pass('src/appsscript.json parses as JSON');
    return parsed;
  } catch (err) {
    fail(`src/appsscript.json does not parse as JSON: ${err.message}`);
    return null;
  }
}

function checkWebappKeys(manifest) {
  if (!manifest) return;
  const webapp = manifest.webapp;
  if (!webapp || typeof webapp !== 'object') {
    fail('src/appsscript.json is missing the "webapp" object');
    return;
  }
  if (typeof webapp.executeAs !== 'string') {
    fail('src/appsscript.json "webapp.executeAs" is missing or not a string');
  } else {
    pass('src/appsscript.json has webapp.executeAs');
  }
  if (typeof webapp.access !== 'string') {
    fail('src/appsscript.json "webapp.access" is missing or not a string');
  } else {
    pass('src/appsscript.json has webapp.access');
  }
}

function checkRequiredFiles() {
  for (const rel of REQUIRED_FILES) {
    const abs = resolve(REPO_ROOT, rel);
    if (!existsSync(abs)) {
      fail(`Required file missing: ${rel}`);
      continue;
    }
    const size = statSync(abs).size;
    if (size === 0) {
      fail(`Required file is empty: ${rel}`);
      continue;
    }
    pass(`Found non-empty ${rel}`);
  }
}

function checkManifestSchema(manifest) {
  if (!manifest) return;
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(MANIFEST_SCHEMA);
  if (validate(manifest)) {
    pass('src/appsscript.json matches manifest schema');
    return;
  }
  for (const err of validate.errors ?? []) {
    const at = err.instancePath || '(root)';
    fail(`manifest schema: ${at} ${err.message}`);
  }
}

function checkSyntax() {
  for (const rel of SYNTAX_CHECK_FILES) {
    const abs = resolve(REPO_ROOT, rel);
    if (!existsSync(abs)) {
      fail(`Cannot syntax-check missing file: ${rel}`);
      continue;
    }
    const result = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8' });
    if (result.status === 0) {
      pass(`node --check ${rel}`);
    } else {
      const msg = (result.stderr || result.stdout || '').trim().split('\n')[0] || 'unknown error';
      fail(`node --check ${rel}: ${msg}`);
    }
  }
}

async function main() {
  const manifest = await checkManifestParses();
  checkWebappKeys(manifest);
  checkRequiredFiles();
  checkManifestSchema(manifest);
  checkSyntax();

  for (const msg of passes) console.log(`PASS ${msg}`);
  for (const msg of failures) console.error(`FAIL ${msg}`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${passes.length} check(s) passed.`);
}

await main();
