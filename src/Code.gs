/**
 * Prioritize — MoSCoW / Top-N ranking web app
 *
 * Single-file backend for a Google Apps Script web app. Serves Index.html,
 * persists submissions to a Google Sheet (auto-created on first use), and
 * aggregates results.
 *
 * Deploy:
 *   1. Paste this file + Index.html + appsscript.json into a new Apps Script project.
 *   2. Deploy → New deployment → Web app.
 *      - Execute as: Me
 *      - Access:     Anyone within [your organization]
 *   3. Share the URL.
 */

// ---------- Default seeds (used only on first boot) -----------------------

const DEFAULT_ITEMS = [
  { id: 'sso', name: 'Single sign-on (SAML / OIDC)' },
  { id: 'mobile_app', name: 'Native mobile apps for iOS and Android' },
  { id: 'dark_mode', name: 'Dark mode across all product surfaces' },
  { id: 'api_v2', name: 'Public REST API v2 with webhooks' },
  { id: 'audit_log', name: 'Audit log and compliance export' },
  { id: 'bulk_import', name: 'Bulk import from CSV and third-party tools' },
  { id: 'chat_ops', name: 'Slack and Microsoft Teams integrations' },
  { id: 'ai_assist', name: 'AI-generated summaries and smart suggestions' },
];

const DEFAULT_BUCKETS = [
  { id: 'must', label: 'Must have', weight: 12, cap: 2 },
  { id: 'should', label: 'Should have', weight: 6, cap: 2 },
  { id: 'could', label: 'Could have', weight: 2, cap: 2 },
  { id: 'wont', label: "Won't have", weight: 0, cap: 2 },
];

// Override auto-derived display names for emails that don't title-case cleanly.
const DISPLAY_NAME_OVERRIDES = {
  // 'jane.doe@example.com': 'Jane',
};

const HEADERS = ['timestamp', 'email', 'display_name', 'assignments_json'];

const CONFIG_HEADERS = ['key', 'value'];
const ITEMS_HEADERS = ['id', 'name', 'description', 'order'];

const DEFAULT_BLURB =
  'Rank these items into buckets to see where the group agrees and where it splits. Save anytime — resubmit to update.';

const DEFAULT_CONFIG = {
  title: 'Prioritize',
  subtitle: '',
  blurb: DEFAULT_BLURB,
  mode: 'moscow',
  buckets: DEFAULT_BUCKETS,
  resultsVisibility: 'always',
  anonymous: false,
  adminEmails: [], // resolved at install time to the script owner's email
};

// ---------- Invocation-scoped caches -------------------------------------
// Apps Script creates a fresh script instance per invocation, so these
// module-level vars act as request-scoped caches — no cross-invocation leakage.

var _isAdminCache = null; // null = uncached; true/false = cached result
var _rowsCache = null; // null = uncached; array = cached readAllRows_ result

// ---------- Installer ----------------------------------------------------

// Appends any missing default config rows to the given Config sheet.
// adminEmail is used only when seeding the admin_emails row for the first time.
// Pass '' when calling from saveConfig (the payload's adminEmails will overwrite if present).
function seedConfigRowsIfMissing_(sheet, adminEmail) {
  const effectiveAdminEmail = adminEmail || '';
  const defaultConfigRows = [
    ['title', DEFAULT_CONFIG.title],
    ['subtitle', DEFAULT_CONFIG.subtitle],
    ['blurb', DEFAULT_CONFIG.blurb],
    ['mode', DEFAULT_CONFIG.mode],
    ['buckets_json', JSON.stringify(DEFAULT_CONFIG.buckets)],
    ['results_visibility', DEFAULT_CONFIG.resultsVisibility],
    ['anonymous', String(DEFAULT_CONFIG.anonymous)],
    ['admin_emails', effectiveAdminEmail],
  ];

  const lastRow = sheet.getLastRow();
  const existingKeys = {};
  if (lastRow >= 2) {
    const existing = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    existing.forEach(function (row) {
      if (row[0]) existingKeys[String(row[0])] = true;
    });
  }

  defaultConfigRows.forEach(function (pair) {
    if (!existingKeys[pair[0]]) {
      sheet.appendRow(pair);
    }
  });
}

function ensureInstalled_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('INSTALLED_AT')) return;

  const ss = getWorkbook_();

  // --- Config sheet ---
  let configSheet = ss.getSheetByName('Config');
  if (!configSheet) {
    configSheet = ss.insertSheet('Config');
    configSheet.appendRow(CONFIG_HEADERS);
  } else {
    const hdr = configSheet.getRange(1, 1, 1, CONFIG_HEADERS.length).getValues()[0];
    if (hdr.join('|') !== CONFIG_HEADERS.join('|')) {
      configSheet.clear();
      configSheet.appendRow(CONFIG_HEADERS);
    }
  }

  let adminEmail = '';
  try {
    adminEmail = Session.getEffectiveUser().getEmail();
  } catch (e) {
    adminEmail = '';
  }
  if (!adminEmail) {
    console.warn(
      'ensureInstalled_: getEffectiveUser() returned empty — seeding admin_emails as empty. Add an admin email manually via the Config sheet.'
    );
  }

  seedConfigRowsIfMissing_(configSheet, adminEmail);

  // --- Items sheet ---
  let itemsSheet = ss.getSheetByName('Items');
  if (!itemsSheet) {
    itemsSheet = ss.insertSheet('Items');
    itemsSheet.appendRow(ITEMS_HEADERS);
  } else {
    const hdr = itemsSheet.getRange(1, 1, 1, ITEMS_HEADERS.length).getValues()[0];
    if (hdr.join('|') !== ITEMS_HEADERS.join('|')) {
      itemsSheet.clear();
      itemsSheet.appendRow(ITEMS_HEADERS);
    }
  }

  const lastItemRow = itemsSheet.getLastRow();
  const freshItems = lastItemRow < 2;
  if (freshItems) {
    DEFAULT_ITEMS.forEach(function (item, index) {
      itemsSheet.appendRow([item.id, item.name, '', index]);
    });
  }

  // --- Submissions sheet ---
  let subSheet = ss.getSheetByName('Submissions');
  if (!subSheet) {
    // Legacy: if the first sheet was never renamed, rename it.
    subSheet = ss.getSheets()[0];
    subSheet.setName('Submissions');
    const firstRow = subSheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    if (firstRow.join('|') !== HEADERS.join('|')) {
      subSheet.clear();
      subSheet.appendRow(HEADERS);
    }
  }

  // Seed example submissions only on a fully fresh install.
  if (freshItems && subSheet.getLastRow() < 2) {
    const now = new Date();
    const exampleSubmissions = [
      [
        'alice@example.com',
        'Alice',
        {
          sso: 'must',
          mobile_app: 'must',
          dark_mode: 'should',
          api_v2: 'should',
          audit_log: 'could',
          bulk_import: 'could',
          chat_ops: 'wont',
          ai_assist: 'wont',
        },
      ],
      [
        'bob@example.com',
        'Bob',
        {
          sso: 'must',
          api_v2: 'must',
          audit_log: 'should',
          chat_ops: 'should',
          mobile_app: 'could',
          bulk_import: 'could',
          dark_mode: 'wont',
          ai_assist: 'wont',
        },
      ],
      [
        'carol@example.com',
        'Carol',
        {
          api_v2: 'must',
          audit_log: 'must',
          sso: 'should',
          ai_assist: 'should',
          chat_ops: 'could',
          bulk_import: 'could',
          mobile_app: 'wont',
          dark_mode: 'wont',
        },
      ],
      [
        'dave@example.com',
        'Dave',
        {
          sso: 'must',
          chat_ops: 'must',
          api_v2: 'should',
          ai_assist: 'should',
          audit_log: 'could',
          mobile_app: 'could',
          bulk_import: 'wont',
          dark_mode: 'wont',
        },
      ],
    ];
    exampleSubmissions.forEach(function (row) {
      subSheet.appendRow([now, row[0], row[1], JSON.stringify(row[2])]);
    });
  }

  props.setProperty('INSTALLED_AT', new Date().toISOString());
}

// ---------- Web app entry ------------------------------------------------

function isAdmin_() {
  if (_isAdminCache !== null) return _isAdminCache;
  try {
    const me = normalizeEmail_(Session.getActiveUser().getEmail());
    if (!me) {
      _isAdminCache = false;
      return false;
    }
    const cfg = getConfig_();
    const admins = (cfg.adminEmails || []).map(function (e) {
      return String(e).trim().toLowerCase();
    });
    _isAdminCache = admins.indexOf(me) !== -1;
    return _isAdminCache;
  } catch (e) {
    _isAdminCache = false;
    return false;
  }
}

function doGet(e) {
  ensureInstalled_();
  const v = e && e.parameter && e.parameter.v;
  const webAppUrl = ScriptApp.getService().getUrl();
  if (v === 'admin') {
    const isAdm = isAdmin_();
    const templateName = isAdm ? 'Admin' : 'NotAuthorized';
    const tpl = HtmlService.createTemplateFromFile(templateName);
    tpl.webAppUrl = webAppUrl;
    return tpl
      .evaluate()
      .setTitle('Prioritize')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  const indexTemplate = HtmlService.createTemplateFromFile('Index');
  indexTemplate.initialView = v === 'results' ? 'results' : 'rank';
  indexTemplate.webAppUrl = webAppUrl;
  indexTemplate.isAdmin = isAdmin_();
  return indexTemplate
    .evaluate()
    .setTitle('Prioritize')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------- Identity -----------------------------------------------------

function getCurrentUser_() {
  const raw = Session.getActiveUser().getEmail();
  const email = String(raw || '')
    .trim()
    .toLowerCase();
  if (!email) {
    throw new Error(
      'Unable to determine your identity. Please open this URL while signed in to your Google account.'
    );
  }
  return { email: email, displayName: deriveDisplayName_(email) };
}

function deriveDisplayName_(email) {
  if (DISPLAY_NAME_OVERRIDES[email]) return DISPLAY_NAME_OVERRIDES[email];
  const local = email.split('@')[0] || email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

// ---------- Sheet plumbing -----------------------------------------------

function getWorkbook_() {
  const props = PropertiesService.getScriptProperties();
  const tryOpen = (id) => {
    try {
      return SpreadsheetApp.openById(id);
    } catch (err) {
      return null;
    }
  };
  const existingId = props.getProperty('SHEET_ID');
  if (existingId) {
    const ss = tryOpen(existingId);
    if (ss) return ss;
  }
  // First run (or sheet was deleted). Serialize creation so parallel requests
  // from the initial page load don't each spawn their own workbook.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const reId = props.getProperty('SHEET_ID');
    if (reId) {
      const ss = tryOpen(reId);
      if (ss) return ss;
    }
    const projectName = DriveApp.getFileById(ScriptApp.getScriptId()).getName();
    const sheetName = /prioritize/i.test(projectName) ? projectName : `Prioritize — ${projectName}`;
    const created = SpreadsheetApp.create(sheetName);
    props.setProperty('SHEET_ID', created.getId());
    return created;
  } finally {
    lock.releaseLock();
  }
}

function getSubmissionsSheet_() {
  return getWorkbook_().getSheetByName('Submissions');
}

function getConfigSheet_() {
  return getWorkbook_().getSheetByName('Config');
}

function getItemsSheet_() {
  return getWorkbook_().getSheetByName('Items');
}

function getSheetUrl() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const url = id
    ? `https://docs.google.com/spreadsheets/d/${id}`
    : 'Sheet not created yet — open the web app URL first to trigger sheet creation.';
  console.log(url);
  return url;
}

function normalizeEmail_(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function readAllRows_() {
  if (_rowsCache !== null) return _rowsCache;
  const sheet = getSubmissionsSheet_();
  const last = sheet.getLastRow();
  if (last < 2) {
    _rowsCache = [];
    return _rowsCache;
  }
  const values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  _rowsCache = values.map((row, i) => ({
    rowIndex: i + 2,
    timestamp: row[0],
    email: row[1],
    displayName: row[2],
    assignments: safeParse_(row[3]),
  }));
  return _rowsCache;
}

function safeParse_(cell) {
  if (!cell) return null;
  try {
    const parsed = JSON.parse(cell);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

// ---------- Sheet readers ------------------------------------------------

function getConfig_() {
  const sheet = getConfigSheet_();
  const last = sheet.getLastRow();
  const defaults = DEFAULT_CONFIG;

  if (last < 2) return defaults;

  const rows = sheet.getRange(2, 1, last - 1, 2).getValues();
  const map = {};
  rows.forEach(function (row) {
    if (row[0]) map[String(row[0])] = row[1];
  });

  var buckets = defaults.buckets;
  if (map['buckets_json']) {
    try {
      buckets = JSON.parse(map['buckets_json']);
    } catch (e) {
      buckets = defaults.buckets;
    }
  }

  var adminEmails = [];
  if (map['admin_emails']) {
    adminEmails = String(map['admin_emails'])
      .split(/[\s,]+/)
      .map(function (s) {
        return s.trim().toLowerCase();
      })
      .filter(function (s) {
        return s.length > 0;
      });
  }

  var anonRaw = map['anonymous'];
  var anonymous = false;
  if (anonRaw !== undefined && anonRaw !== null && anonRaw !== '') {
    var anonStr = String(anonRaw).trim().toLowerCase();
    anonymous = anonStr === 'true' || anonStr === '1';
  }

  return {
    title: map['title'] !== undefined ? String(map['title']) : defaults.title,
    subtitle: map['subtitle'] !== undefined ? String(map['subtitle']) : defaults.subtitle,
    blurb: map['blurb'] !== undefined ? String(map['blurb']) : defaults.blurb,
    mode: map['mode'] !== undefined ? String(map['mode']) : defaults.mode,
    buckets: buckets,
    resultsVisibility:
      map['results_visibility'] !== undefined
        ? String(map['results_visibility'])
        : defaults.resultsVisibility,
    anonymous: anonymous,
    adminEmails: adminEmails,
  };
}

function getItemsFromSheet_() {
  const sheet = getItemsSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const rows = sheet.getRange(2, 1, last - 1, ITEMS_HEADERS.length).getValues();
  const items = rows
    .filter(function (row) {
      return row[0] && String(row[0]).trim() !== '';
    })
    .map(function (row) {
      return {
        id: String(row[0]).trim(),
        name: String(row[1] || '').trim(),
        description: String(row[2] || '').trim(),
        order: Number(row[3]) || 0,
      };
    });
  items.sort(function (a, b) {
    return a.order - b.order;
  });
  return items;
}

// ---------- Config writer ------------------------------------------------

// Writes config values back to the Config sheet.
function saveConfig(payload) {
  ensureInstalled_();
  if (!isAdmin_()) {
    throw new Error('Not authorized — admin access required.');
  }
  if (!payload || typeof payload !== 'object') throw new Error('Invalid payload');

  // --- Stateless cap validation (no sheet mutation; safe outside the lock) ---
  // Determine effective item count for validation only.
  const effectiveItems = payload.items !== undefined ? payload.items : getItemsFromSheet_();

  // Derive the intended mode for validation purposes (may be stale re: modeChanging,
  // but the authoritative check happens inside the lock).
  const newModeForValidation = payload.mode !== undefined ? String(payload.mode) : null;

  // --- MoSCoW cap-sum validation ---
  if (payload.buckets !== undefined && newModeForValidation !== 'topn') {
    const buckets = payload.buckets;
    for (const b of buckets) {
      if (!b.cap || Number(b.cap) < 1) {
        throw new Error('Bucket "' + (b.label || b.id) + '" cap must be 1 or greater.');
      }
    }
    const capSum = buckets.reduce(function (s, b) {
      return s + Number(b.cap);
    }, 0);
    if (capSum !== effectiveItems.length) {
      throw new Error(
        'Bucket caps must sum to the number of items (' +
          effectiveItems.length +
          '). ' +
          'Current sum: ' +
          capSum +
          '. Adjust caps before saving.'
      );
    }
  }

  // --- Top-N cap validation ---
  if (payload.buckets !== undefined && newModeForValidation === 'topn') {
    const topBucket = payload.buckets.find(function (b) {
      return b.id === 'top';
    });
    if (topBucket) {
      if (!(topBucket.cap >= 1 && topBucket.cap <= effectiveItems.length)) {
        throw new Error(
          'Top-N cap must be between 1 and the number of items (' + effectiveItems.length + ').'
        );
      }
    }
  }

  // --- Acquire a single lock that spans all mutations ---
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // --- Read current mode and items inside the lock to avoid TOCTOU ---
    const currentCfg = getConfig_();
    const currentMode = currentCfg.mode;
    const newMode = payload.mode !== undefined ? String(payload.mode) : currentMode;
    const modeChanging = newMode !== currentMode;

    // --- Items-change detection (set membership only; renames/reorders don't count) ---
    let itemsChanging = false;
    if (payload.items !== undefined) {
      const currentItems = getItemsFromSheet_();
      const currentIds = new Set(
        currentItems.map(function (i) {
          return i.id;
        })
      );
      const newIds = new Set(
        payload.items
          .map(function (i) {
            return String(i.id || '').trim();
          })
          .filter(Boolean)
      );
      if (currentIds.size !== newIds.size) {
        itemsChanging = true;
      } else {
        for (const id of currentIds) {
          if (!newIds.has(id)) {
            itemsChanging = true;
            break;
          }
        }
      }
    }

    // --- Mode-change guard ---
    if (modeChanging && !payload.confirmSubmissionsWipe) {
      throw new Error('MODE_CHANGE_NEEDS_CONFIRM');
    }

    // --- Items-change guard ---
    const existingRows = readAllRows_();
    if (itemsChanging && existingRows.length > 0 && !payload.confirmItemsChangeWipe) {
      throw new Error('ITEMS_CHANGE_NEEDS_CONFIRM');
    }

    // --- Wipe submissions if mode or items are changing (wipe once) ---
    const shouldWipeSubmissions = (modeChanging || itemsChanging) && existingRows.length > 0;
    if (shouldWipeSubmissions) {
      const subSheet = getSubmissionsSheet_();
      const lastSub = subSheet.getLastRow();
      if (lastSub >= 2) {
        subSheet.deleteRows(2, lastSub - 1);
      }
      _rowsCache = null;
    }

    const sheet = getConfigSheet_();

    // Ensure all default config rows exist; heals a manually wiped Config sheet.
    seedConfigRowsIfMissing_(sheet, '');

    const last = sheet.getLastRow();
    const rows = sheet.getRange(2, 1, last - 1, 2).getValues();

    // --- When switching Top-N → MoSCoW with empty/no buckets, re-seed MoSCoW defaults ---
    let bucketsToSave = payload.buckets;
    if (modeChanging && newMode === 'moscow' && (!bucketsToSave || bucketsToSave.length === 0)) {
      bucketsToSave = DEFAULT_BUCKETS;
    }

    const updates = {};
    if (payload.title !== undefined) updates['title'] = String(payload.title);
    if (payload.subtitle !== undefined) updates['subtitle'] = String(payload.subtitle);
    if (payload.blurb !== undefined) updates['blurb'] = String(payload.blurb);
    if (payload.mode !== undefined) updates['mode'] = String(payload.mode);
    if (bucketsToSave !== undefined) updates['buckets_json'] = JSON.stringify(bucketsToSave);
    if (payload.resultsVisibility !== undefined)
      updates['results_visibility'] = String(payload.resultsVisibility);
    if (payload.anonymous !== undefined) updates['anonymous'] = String(!!payload.anonymous);
    if (payload.adminEmails !== undefined)
      updates['admin_emails'] = Array.isArray(payload.adminEmails)
        ? payload.adminEmails.join('\n')
        : String(payload.adminEmails);

    rows.forEach(function (row, i) {
      const key = String(row[0]);
      if (updates[key] !== undefined) {
        sheet.getRange(i + 2, 2).setValue(updates[key]);
      }
    });

    // --- Write items to Items sheet if provided ---
    if (payload.items !== undefined) {
      const itemsSheet = getItemsSheet_();
      const lastItem = itemsSheet.getLastRow();
      if (lastItem >= 2) {
        itemsSheet.deleteRows(2, lastItem - 1);
      }
      const itemRows = payload.items.map(function (item, index) {
        return [
          String(item.id || '').trim(),
          String(item.name || '').trim(),
          String(item.description || '').trim(),
          index,
        ];
      });
      if (itemRows.length > 0) {
        itemsSheet.getRange(2, 1, itemRows.length, 4).setValues(itemRows);
      }
    }
  } finally {
    lock.releaseLock();
  }

  return { ok: true };
}

// ---------- Validation ---------------------------------------------------

// Reads runtime items/buckets from config to avoid hardcoded references.
function validateAssignments_(assignments) {
  if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) {
    throw new Error('assignments must be an object');
  }
  const cfg = getConfig_();
  const items = getItemsFromSheet_();
  const buckets = cfg.buckets;
  const mode = cfg.mode;

  const validItemIds = new Set(
    items.map(function (i) {
      return i.id;
    })
  );
  const validBucketIds = new Set(
    buckets.map(function (b) {
      return b.id;
    })
  );
  const gotKeys = Object.keys(assignments);

  for (const key of gotKeys) {
    if (!validItemIds.has(key)) throw new Error(`Unknown item id: ${key}`);
    if (!validBucketIds.has(assignments[key]))
      throw new Error(`Unknown bucket id: ${assignments[key]}`);
  }

  if (mode === 'topn') {
    // Top-N: only the 'top' bucket is used; unassigned items are the implicit rest.
    const topBucket = buckets.find(function (b) {
      return b.id === 'top';
    });
    if (!topBucket) throw new Error('Top-N config is missing a "top" bucket');
    const topCount = gotKeys.filter(function (k) {
      return assignments[k] === 'top';
    }).length;
    if (topCount !== topBucket.cap) {
      throw new Error(`Top must contain exactly ${topBucket.cap} items (has ${topCount})`);
    }
    return;
  }

  // MoSCoW: all items must be assigned, all caps strictly enforced.
  if (gotKeys.length !== items.length) {
    throw new Error(`Expected ${items.length} items, got ${gotKeys.length}`);
  }

  const counts = {};
  buckets.forEach(function (b) {
    counts[b.id] = 0;
  });
  for (const bucketId of Object.values(assignments)) counts[bucketId]++;

  for (const bucket of buckets) {
    if (counts[bucket.id] !== bucket.cap) {
      throw new Error(
        `${bucket.label} must contain exactly ${bucket.cap} items (has ${counts[bucket.id]})`
      );
    }
  }
}

// ---------- Public API ---------------------------------------------------

/**
 * Single bootstrap call for the Rank view. Returns everything the UI needs
 * to render the first paint (config + identity + prior submission).
 */
function getBoot() {
  ensureInstalled_();
  const me = getCurrentUser_();
  const cfg = getConfig_();
  const items = getItemsFromSheet_();
  return {
    config: {
      items: items,
      buckets: cfg.buckets,
      title: cfg.title,
      subtitle: cfg.subtitle,
      blurb: cfg.blurb,
      mode: cfg.mode,
      resultsVisibility: cfg.resultsVisibility,
      anonymous: cfg.anonymous,
    },
    me: me,
    mySubmission: findSubmissionByEmail_(me.email),
    isAdmin: isAdmin_(),
    webAppUrl: ScriptApp.getService().getUrl(),
  };
}

function findSubmissionByEmail_(email) {
  const key = normalizeEmail_(email);
  if (!key) return null;
  const rows = readAllRows_();
  const mine = rows.find((r) => normalizeEmail_(r.email) === key);
  if (!mine) return null;
  return {
    email: mine.email,
    displayName: mine.displayName,
    assignments: mine.assignments,
    submittedAt: mine.timestamp instanceof Date ? mine.timestamp.toISOString() : mine.timestamp,
  };
}

function saveSubmission(payload) {
  ensureInstalled_();
  const me = getCurrentUser_();
  const assignments = payload && payload.assignments;
  validateAssignments_(assignments);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSubmissionsSheet_();
    const rows = readAllRows_();
    const existing = rows.find((r) => normalizeEmail_(r.email) === me.email);

    const now = new Date();
    const record = [now, me.email, me.displayName, JSON.stringify(assignments)];

    if (existing) {
      sheet.getRange(existing.rowIndex, 1, 1, HEADERS.length).setValues([record]);
    } else {
      sheet.appendRow(record);
    }
    _rowsCache = null;
    return {
      ok: true,
      email: me.email,
      displayName: me.displayName,
      overwritten: !!existing,
      submittedAt: now.toISOString(),
    };
  } finally {
    lock.releaseLock();
  }
}

function deleteAllSubmissions() {
  ensureInstalled_();
  if (!isAdmin_()) {
    throw new Error('Not authorized — admin access required.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSubmissionsSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      sheet.deleteRows(2, lastRow - 1);
    }
    _rowsCache = null;
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function deleteMySubmission() {
  ensureInstalled_();
  const me = getCurrentUser_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSubmissionsSheet_();
    const rows = readAllRows_();
    const mine = rows.find((r) => normalizeEmail_(r.email) === me.email);
    if (!mine) return { ok: true, deleted: false };
    sheet.deleteRow(mine.rowIndex);
    _rowsCache = null;
    return { ok: true, deleted: true };
  } finally {
    lock.releaseLock();
  }
}

function getResults() {
  ensureInstalled_();
  const cfg = getConfig_();
  const admin = isAdmin_();

  if (!admin) {
    const rv = cfg.resultsVisibility;
    if (rv === 'admin_only') {
      return { gated: 'admin_only', items: [], submissions: [] };
    }
    if (rv === 'after_submit') {
      const me = getCurrentUser_();
      const sub = findSubmissionByEmail_(me.email);
      if (!sub) {
        return { gated: 'submit_first', items: [], submissions: [] };
      }
    }
  }

  const rows = readAllRows_();
  const shouldAnonymize = cfg.anonymous && !admin;

  let items = aggregate_(rows);
  if (shouldAnonymize) {
    items = items.map((item) => ({
      ...item,
      voters: item.voters.map((v) => ({ voter: 'Anonymous', bucket: v.bucket })),
    }));
  }

  const submissions = rows.map((r) => ({
    email: shouldAnonymize ? '' : r.email,
    displayName: shouldAnonymize ? 'Anonymous' : r.displayName,
    submittedAt: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
    assignments: r.assignments,
  }));

  return {
    items: items,
    submissions: submissions,
  };
}

function getAdminBoot() {
  ensureInstalled_();
  if (!isAdmin_()) {
    throw new Error('Not authorized — admin access required.');
  }
  const cfg = getConfig_();
  const items = getItemsFromSheet_();
  const rows = readAllRows_();
  const me = getCurrentUser_();
  return {
    config: {
      title: cfg.title,
      subtitle: cfg.subtitle,
      blurb: cfg.blurb,
      mode: cfg.mode,
      buckets: cfg.buckets,
      resultsVisibility: cfg.resultsVisibility,
      anonymous: cfg.anonymous,
      adminEmails: cfg.adminEmails,
      items: items,
    },
    stats: {
      submissionCount: rows.length,
      itemCount: items.length,
    },
    sheetUrl: getSheetUrl(),
    me: me,
    webAppUrl: ScriptApp.getService().getUrl(),
  };
}

// Reads runtime items/buckets from config to avoid hardcoded references.
function aggregate_(rows) {
  const cfg = getConfig_();
  const items = getItemsFromSheet_();
  const buckets = cfg.buckets;

  const bucketWeightMap = {};
  buckets.forEach(function (b) {
    bucketWeightMap[b.id] = b.weight;
  });

  const bucketCountsTemplate = {};
  buckets.forEach(function (b) {
    bucketCountsTemplate[b.id] = 0;
  });

  const itemMap = {};
  items.forEach(function (item) {
    itemMap[item.id] = {
      id: item.id,
      name: item.name,
      score: 0,
      bucketCounts: Object.assign({}, bucketCountsTemplate),
      voters: [],
      weights: [],
    };
  });

  rows.forEach((row) => {
    const a = row.assignments;
    if (!a || typeof a !== 'object') return;
    items.forEach(function (item) {
      const bucketId = a[item.id];
      if (!bucketId || bucketWeightMap[bucketId] === undefined) return;
      const entry = itemMap[item.id];
      const w = bucketWeightMap[bucketId];
      entry.score += w;
      entry.bucketCounts[bucketId]++;
      entry.voters.push({ voter: row.displayName || row.email, bucket: bucketId });
      entry.weights.push(w);
    });
  });

  const list = Object.values(itemMap).map((entry) => ({
    id: entry.id,
    name: entry.name,
    score: entry.score,
    bucketCounts: entry.bucketCounts,
    voters: entry.voters,
    stdev: stdev_(entry.weights),
  }));

  list.sort((a, b) => b.score - a.score || a.stdev - b.stdev);
  return list;
}

function stdev_(arr) {
  if (!arr || arr.length < 2) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}
