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

// ---------- Items ---------------------------------------------------------

const ITEMS = [
  { id: 'sso',          name: 'Single sign-on (SAML / OIDC)' },
  { id: 'mobile_app',   name: 'Native mobile apps for iOS and Android' },
  { id: 'dark_mode',    name: 'Dark mode across all product surfaces' },
  { id: 'api_v2',       name: 'Public REST API v2 with webhooks' },
  { id: 'audit_log',    name: 'Audit log and compliance export' },
  { id: 'bulk_import',  name: 'Bulk import from CSV and third-party tools' },
  { id: 'chat_ops',     name: 'Slack and Microsoft Teams integrations' },
  { id: 'ai_assist',    name: 'AI-generated summaries and smart suggestions' },
];

const BUCKETS = [
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

// ---------- Web app entry ------------------------------------------------

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Prioritize')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------- Config -------------------------------------------------------

function getConfig_() {
  return { items: ITEMS, buckets: BUCKETS };
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
  return { email, displayName: deriveDisplayName_(email) };
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

function getSheet_() {
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
  const sheet = getSheet_();
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

// ---------- Validation ---------------------------------------------------

function validateAssignments_(assignments) {
  if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) {
    throw new Error('assignments must be an object');
  }
  const validItemIds = new Set(ITEMS.map(i => i.id));
  const validBucketIds = new Set(BUCKETS.map(b => b.id));
  const gotKeys = Object.keys(assignments);

  if (gotKeys.length !== ITEMS.length) {
    throw new Error(`Expected ${ITEMS.length} items, got ${gotKeys.length}`);
  }
  for (const key of gotKeys) {
    if (!validItemIds.has(key)) throw new Error(`Unknown item id: ${key}`);
    if (!validBucketIds.has(assignments[key])) throw new Error(`Unknown bucket id: ${assignments[key]}`);
  }

  const counts = {};
  BUCKETS.forEach(b => { counts[b.id] = 0; });
  for (const bucketId of Object.values(assignments)) counts[bucketId]++;

  for (const bucket of BUCKETS) {
    if (counts[bucket.id] !== bucket.cap) {
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
    me,
    mySubmission: findSubmissionByEmail_(me.email),
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
    const sheet = getSheet_();
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

function getResults() {
  const rows = readAllRows_();
  return {
    items: aggregate_(rows),
    submissions: rows.map((r) => ({
      email: r.email,
      displayName: r.displayName,
      submittedAt: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
      assignments: r.assignments,
    })),
  };
}

function aggregate_(rows) {
  const bucketWeightMap = {};
  BUCKETS.forEach(b => { bucketWeightMap[b.id] = b.weight; });

  const itemMap = {};
  ITEMS.forEach((item) => {
    itemMap[item.id] = {
      id: item.id,
      name: item.name,
      score: 0,
      bucketCounts: { must: 0, should: 0, could: 0, wont: 0 },
      voters: [],
      weights: [],
    };
  });

  rows.forEach((row) => {
    const a = row.assignments;
    if (!a || typeof a !== 'object') return;
    ITEMS.forEach((item) => {
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
