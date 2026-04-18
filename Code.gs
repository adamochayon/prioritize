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
  { id: 'sso',          name: 'Single sign-on (SAML / OIDC)' },
  { id: 'mobile_app',   name: 'Native mobile apps for iOS and Android' },
  { id: 'dark_mode',    name: 'Dark mode across all product surfaces' },
  { id: 'api_v2',       name: 'Public REST API v2 with webhooks' },
  { id: 'audit_log',    name: 'Audit log and compliance export' },
  { id: 'bulk_import',  name: 'Bulk import from CSV and third-party tools' },
  { id: 'chat_ops',     name: 'Slack and Microsoft Teams integrations' },
  { id: 'ai_assist',    name: 'AI-generated summaries and smart suggestions' },
];

const DEFAULT_BUCKETS = [
  { id: 'must',   label: 'Must have',   weight: 12, cap: 3 },
  { id: 'should', label: 'Should have', weight: 6,  cap: 4 },
  { id: 'could',  label: 'Could have',  weight: 2,  cap: 4 },
  { id: 'wont',   label: "Won't have",  weight: 0,  cap: 5 },
];

// Override auto-derived display names for emails that don't title-case cleanly.
const DISPLAY_NAME_OVERRIDES = {
  // 'jane.doe@example.com': 'Jane',
};

const HEADERS = ['timestamp', 'email', 'display_name', 'assignments_json'];

const CONFIG_HEADERS = ['key', 'value'];
const ITEMS_HEADERS  = ['id', 'name', 'description', 'order'];

const DEFAULT_BLURB = 'More priorities than bandwidth — this exercise forces explicit bets. Drag each item into one of four buckets: Must have (your top 3 bets), Should have (4 items), Could have (4 items), or Won\'t have (5 things we\'re explicitly deprioritizing for now). Save anytime — resubmit to update. Results aggregate across everyone so we can see where we agree and where we don\'t.';

// ---------- Web app entry ------------------------------------------------

function isAdmin_() {
  try {
    const me = normalizeEmail_(Session.getActiveUser().getEmail());
    if (!me) return false;
    const cfg = getConfigFromSheet_();
    const admins = (cfg.adminEmails || []).map(function(e) { return String(e).trim().toLowerCase(); });
    return admins.indexOf(me) !== -1;
  } catch (e) {
    return false;
  }
}

function doGet(e) {
  const v = e && e.parameter && e.parameter.v;
  if (v === 'admin') {
    const template = isAdmin_() ? 'Admin' : 'NotAuthorized';
    return HtmlService.createTemplateFromFile(template)
      .evaluate()
      .setTitle('Prioritize')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Prioritize')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------- Config -------------------------------------------------------

function getConfig_() {
  const cfg = getConfigFromSheet_();
  const items = getItemsFromSheet_();
  return {
    items: items,
    buckets: cfg.buckets,
    title: cfg.title,
    subtitle: cfg.subtitle,
    blurb: cfg.blurb,
    mode: cfg.mode,
    resultsVisibility: cfg.resultsVisibility,
    anonymous: cfg.anonymous,
  };
}

// ---------- Identity -----------------------------------------------------

function getCurrentUser_() {
  const raw = Session.getActiveUser().getEmail();
  const email = String(raw || '').trim().toLowerCase();
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
  let id = props.getProperty('SHEET_ID');
  let ss;
  if (id) {
    try {
      ss = SpreadsheetApp.openById(id);
    } catch (err) {
      // Sheet was deleted or inaccessible — recreate.
      id = null;
    }
  }
  if (!id) {
    ss = SpreadsheetApp.create('Prioritize — Submissions');
    props.setProperty('SHEET_ID', ss.getId());
  }
  return ss;
}

function getSubmissionsSheet_() {
  const ss = getWorkbook_();
  seedDefaultsIfEmpty_(ss);
  let sheet = ss.getSheetByName('Submissions');
  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName('Submissions');
  }
  const firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (firstRow.join('|') !== HEADERS.join('|')) {
    sheet.clear();
    sheet.appendRow(HEADERS);
  }
  return sheet;
}

function getConfigSheet_() {
  const ss = getWorkbook_();
  seedDefaultsIfEmpty_(ss);
  return ss.getSheetByName('Config');
}

function getItemsSheet_() {
  const ss = getWorkbook_();
  seedDefaultsIfEmpty_(ss);
  return ss.getSheetByName('Items');
}

function getSheetUrl() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const url = id ? `https://docs.google.com/spreadsheets/d/${id}` : 'Sheet not created yet — open the web app URL first to trigger sheet creation.';
  console.log(url);
  return url;
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function readAllRows_() {
  const sheet = getSubmissionsSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  return values.map((row, i) => ({
    rowIndex: i + 2,
    timestamp: row[0],
    email: row[1],
    displayName: row[2],
    assignments: safeParse_(row[3]),
  }));
}

function safeParse_(cell) {
  if (!cell) return null;
  try {
    const parsed = JSON.parse(cell);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
  } catch (e) {
    return null;
  }
}

// ---------- Seeder -------------------------------------------------------

function seedDefaultsIfEmpty_(ss) {
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

  // Determine the admin email for seeding.
  let adminEmail = '';
  try {
    adminEmail = Session.getEffectiveUser().getEmail();
  } catch (e) {
    adminEmail = '';
  }
  if (!adminEmail) {
    try {
      adminEmail = Session.getActiveUser().getEmail();
    } catch (e) {
      adminEmail = '';
    }
  }

  const defaultConfigRows = [
    ['title',              'Prioritize'],
    ['subtitle',           'Rank the items below'],
    ['blurb',              DEFAULT_BLURB],
    ['mode',               'moscow'],
    ['buckets_json',       JSON.stringify(DEFAULT_BUCKETS)],
    ['results_visibility', 'always'],
    ['anonymous',          'false'],
    ['admin_emails',       adminEmail],
  ];

  // Read existing keys so we only add missing ones.
  const lastConfigRow = configSheet.getLastRow();
  const existingKeys = {};
  if (lastConfigRow >= 2) {
    const existing = configSheet.getRange(2, 1, lastConfigRow - 1, 2).getValues();
    existing.forEach(function(row) {
      if (row[0]) existingKeys[String(row[0])] = true;
    });
  }

  defaultConfigRows.forEach(function(pair) {
    if (!existingKeys[pair[0]]) {
      configSheet.appendRow(pair);
    }
  });

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
  if (lastItemRow < 2) {
    DEFAULT_ITEMS.forEach(function(item, index) {
      itemsSheet.appendRow([item.id, item.name, '', index]);
    });
  }
}

// ---------- Sheet readers ------------------------------------------------

function getConfigFromSheet_() {
  const sheet = getConfigSheet_();
  const last = sheet.getLastRow();
  const defaults = {
    title: 'Prioritize',
    subtitle: 'Rank the items below',
    blurb: DEFAULT_BLURB,
    mode: 'moscow',
    buckets: DEFAULT_BUCKETS,
    resultsVisibility: 'always',
    anonymous: false,
    adminEmails: [],
  };

  if (last < 2) return defaults;

  const rows = sheet.getRange(2, 1, last - 1, 2).getValues();
  const map = {};
  rows.forEach(function(row) {
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
      .map(function(s) { return s.trim().toLowerCase(); })
      .filter(function(s) { return s.length > 0; });
  }

  var anonRaw = map['anonymous'];
  var anonymous = false;
  if (anonRaw !== undefined && anonRaw !== null && anonRaw !== '') {
    var anonStr = String(anonRaw).trim().toLowerCase();
    anonymous = (anonStr === 'true' || anonStr === '1');
  }

  return {
    title:             map['title']              !== undefined ? String(map['title'])              : defaults.title,
    subtitle:          map['subtitle']           !== undefined ? String(map['subtitle'])           : defaults.subtitle,
    blurb:             map['blurb']              !== undefined ? String(map['blurb'])              : defaults.blurb,
    mode:              map['mode']               !== undefined ? String(map['mode'])               : defaults.mode,
    buckets:           buckets,
    resultsVisibility: map['results_visibility'] !== undefined ? String(map['results_visibility']) : defaults.resultsVisibility,
    anonymous:         anonymous,
    adminEmails:       adminEmails,
  };
}

function getItemsFromSheet_() {
  const sheet = getItemsSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const rows = sheet.getRange(2, 1, last - 1, ITEMS_HEADERS.length).getValues();
  const items = rows
    .filter(function(row) { return row[0] && String(row[0]).trim() !== ''; })
    .map(function(row) {
      return {
        id:          String(row[0]).trim(),
        name:        String(row[1] || '').trim(),
        description: String(row[2] || '').trim(),
        order:       Number(row[3]) || 0,
      };
    });
  items.sort(function(a, b) { return a.order - b.order; });
  return items;
}

// ---------- Config writer ------------------------------------------------

// Writes config values back to the Config sheet.
function saveConfig(payload) {
  if (!isAdmin_()) {
    throw new Error('Not authorized — admin access required.');
  }
  if (!payload || typeof payload !== 'object') throw new Error('Invalid payload');

  const sheet = getConfigSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return;

  const rows = sheet.getRange(2, 1, last - 1, 2).getValues();

  const updates = {};
  if (payload.title       !== undefined) updates['title']              = String(payload.title);
  if (payload.subtitle    !== undefined) updates['subtitle']           = String(payload.subtitle);
  if (payload.blurb       !== undefined) updates['blurb']             = String(payload.blurb);
  if (payload.mode        !== undefined) updates['mode']               = String(payload.mode);
  if (payload.buckets     !== undefined) updates['buckets_json']       = JSON.stringify(payload.buckets);
  if (payload.resultsVisibility !== undefined) updates['results_visibility'] = String(payload.resultsVisibility);
  if (payload.anonymous   !== undefined) updates['anonymous']          = String(!!payload.anonymous);
  if (payload.adminEmails !== undefined) updates['admin_emails']       = Array.isArray(payload.adminEmails) ? payload.adminEmails.join('\n') : String(payload.adminEmails);

  rows.forEach(function(row, i) {
    const key = String(row[0]);
    if (updates[key] !== undefined) {
      sheet.getRange(i + 2, 2).setValue(updates[key]);
    }
  });
}

// ---------- Validation ---------------------------------------------------

// Reads runtime items/buckets from getConfig_() to avoid hardcoded references.
function validateAssignments_(assignments) {
  if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) {
    throw new Error('assignments must be an object');
  }
  const cfg = getConfig_();
  const items   = cfg.items;
  const buckets = cfg.buckets;

  const validItemIds   = new Set(items.map(function(i) { return i.id; }));
  const validBucketIds = new Set(buckets.map(function(b) { return b.id; }));
  const gotKeys = Object.keys(assignments);

  const hasUnlimitedCap = buckets.some(function(b) { return b.cap == null || b.cap === 0; });
  if (!hasUnlimitedCap && gotKeys.length !== items.length) {
    throw new Error(`Expected ${items.length} items, got ${gotKeys.length}`);
  }
  for (const key of gotKeys) {
    if (!validItemIds.has(key)) throw new Error(`Unknown item id: ${key}`);
    if (!validBucketIds.has(assignments[key])) throw new Error(`Unknown bucket id: ${assignments[key]}`);
  }

  const counts = {};
  buckets.forEach(function(b) { counts[b.id] = 0; });
  for (const bucketId of Object.values(assignments)) counts[bucketId]++;

  for (const bucket of buckets) {
    const isUnlimited = bucket.cap == null || bucket.cap === 0;
    if (!isUnlimited && counts[bucket.id] !== bucket.cap) {
      throw new Error(`${bucket.label} must contain exactly ${bucket.cap} items (has ${counts[bucket.id]})`);
    }
  }
}

// ---------- Public API ---------------------------------------------------

/**
 * Single bootstrap call for the Rank view. Returns everything the UI needs
 * to render the first paint (config + identity + prior submission).
 */
function getBoot() {
  const me = getCurrentUser_();
  return {
    config: getConfig_(),
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

function deleteMySubmission() {
  const me = getCurrentUser_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSubmissionsSheet_();
    const rows = readAllRows_();
    const mine = rows.find((r) => normalizeEmail_(r.email) === me.email);
    if (!mine) return { ok: true, deleted: false };
    sheet.deleteRow(mine.rowIndex);
    return { ok: true, deleted: true };
  } finally {
    lock.releaseLock();
  }
}

function getResults() {
  const cfg = getConfigFromSheet_();
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
  if (!isAdmin_()) {
    throw new Error('Not authorized — admin access required.');
  }
  const cfg = getConfigFromSheet_();
  const items = getItemsFromSheet_();
  const rows = readAllRows_();
  const me = getCurrentUser_();
  return {
    config: {
      title:             cfg.title,
      subtitle:          cfg.subtitle,
      blurb:             cfg.blurb,
      mode:              cfg.mode,
      buckets:           cfg.buckets,
      resultsVisibility: cfg.resultsVisibility,
      anonymous:         cfg.anonymous,
      adminEmails:       cfg.adminEmails,
      items:             items,
    },
    stats: {
      submissionCount: rows.length,
      itemCount:       items.length,
    },
    sheetUrl: getSheetUrl(),
    me: me,
    webAppUrl: ScriptApp.getService().getUrl(),
  };
}

// Reads runtime items/buckets from getConfig_() to avoid hardcoded references.
function aggregate_(rows) {
  const cfg = getConfig_();
  const items   = cfg.items;
  const buckets = cfg.buckets;

  const bucketWeightMap = {};
  buckets.forEach(function(b) { bucketWeightMap[b.id] = b.weight; });

  const bucketCountsTemplate = {};
  buckets.forEach(function(b) { bucketCountsTemplate[b.id] = 0; });

  const itemMap = {};
  items.forEach(function(item) {
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
    items.forEach(function(item) {
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

  list.sort((a, b) => (b.score - a.score) || (a.stdev - b.stdev));
  return list;
}

function stdev_(arr) {
  if (!arr || arr.length < 2) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}
