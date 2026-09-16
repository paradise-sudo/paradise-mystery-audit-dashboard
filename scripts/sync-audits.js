const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { extractAudit } = require('./extract-audit');
const { mergeReport } = require('./merge-report');

// ---- config (env-driven, matches existing daily-check.js conventions) ----
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID; // "Paradise Biryani 2026" root folder
const DASHBOARD_FILE_ID = process.env.DASHBOARD_FILE_ID; // paradise_mystery_audit_data.json
const STORE_MASTER_PATH = path.join(__dirname, '..', 'data', 'store-master.json');
const PROCESSED_LOG_PATH = path.join(__dirname, '..', 'data', 'processed-files.json');
// Local-only file (not committed to the repo) — read by daily-check.js within
// the same GitHub Actions job run, so it knows which specific stores changed
// and can attach an individual screenshot for each, alongside the whole-
// dashboard one.
const SYNC_CHANGES_PATH = path.join(__dirname, '..', 'data', 'last-sync-changes.json');

function getDriveClient() {
  const credentials = JSON.parse(process.env.GDRIVE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

function loadProcessedLog() {
  if (!fs.existsSync(PROCESSED_LOG_PATH)) return {};
  return JSON.parse(fs.readFileSync(PROCESSED_LOG_PATH, 'utf8'));
}

function saveProcessedLog(log) {
  fs.writeFileSync(PROCESSED_LOG_PATH, JSON.stringify(log, null, 2));
}

// store code is derived from the subfolder name, e.g. "S1113 - Gachibowli" -> "S1113"
function extractStoreCode(folderName) {
  const m = folderName.match(/^(S\d{3,4}(?:-\d{2})?)/);
  return m ? m[1] : null;
}

async function listSubfolders(drive, parentId) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    pageSize: 200,
  });
  return res.data.files;
}

async function listPdfsInFolder(drive, folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType = 'application/pdf' and trashed = false`,
    fields: 'files(id, name, modifiedTime, md5Checksum)',
    pageSize: 100,
  });
  return res.data.files;
}

async function downloadFile(drive, fileId) {
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data);
}

async function downloadJson(drive, fileId) {
  const buf = await downloadFile(drive, fileId);
  return JSON.parse(buf.toString('utf8'));
}

async function uploadJson(drive, fileId, data) {
  await drive.files.update({
    fileId,
    media: {
      mimeType: 'application/json',
      body: JSON.stringify(data),
    },
  });
}

// Resolves the actual list of store folders to scan, handling two structures
// that can coexist side by side under the root folder:
//   1. Legacy flat: <root>/<Store Folder>/*.pdf
//   2. Month-nested: <root>/<Month Folder>/<Store Folder>/*.pdf — introduced
//      starting September 2026, and expected for every month going forward
//      (October, November, ...), without needing a code change each time.
// Any top-level folder whose name doesn't look like a store code is treated
// as a month container and searched one level deeper for store folders.
async function resolveStoreFolders(drive, rootFolderId, skipped) {
  const topLevel = await listSubfolders(drive, rootFolderId);
  const storeFolders = [];

  for (const folder of topLevel) {
    const directCode = extractStoreCode(folder.name);
    if (directCode) {
      storeFolders.push({ id: folder.id, name: folder.name, storeCode: directCode });
      continue;
    }

    // Not a store-code-named folder — treat as a month folder and look for
    // store subfolders inside it.
    const inner = await listSubfolders(drive, folder.id);
    if (!inner.length) {
      skipped.push({ folder: folder.name, reason: 'not a store folder and has no subfolders (not a recognized month folder either)' });
      continue;
    }
    inner.forEach(innerFolder => {
      const innerCode = extractStoreCode(innerFolder.name);
      if (innerCode) {
        storeFolders.push({ id: innerFolder.id, name: folder.name + ' / ' + innerFolder.name, storeCode: innerCode });
      } else {
        skipped.push({ folder: folder.name + ' / ' + innerFolder.name, reason: 'could not derive store code from folder name' });
      }
    });
  }

  return storeFolders;
}

async function run() {
  if (!DRIVE_FOLDER_ID || !DASHBOARD_FILE_ID) {
    console.error('Missing DRIVE_FOLDER_ID or DASHBOARD_FILE_ID env vars.');
    process.exit(1);
  }

  const drive = getDriveClient();
  const storeMaster = JSON.parse(fs.readFileSync(STORE_MASTER_PATH, 'utf8'));
  const processedLog = loadProcessedLog();

  console.log('Scanning store folders in Drive...');
  const skipped = [];
  const storeFolders = await resolveStoreFolders(drive, DRIVE_FOLDER_ID, skipped);
  console.log(`Resolved ${storeFolders.length} store folder(s) to scan (including any nested month folders).`);

  let newReportsCount = 0;
  const extracted = [];

  for (const folder of storeFolders) {
    const storeCode = folder.storeCode;
    const pdfs = await listPdfsInFolder(drive, folder.id);
    for (const pdf of pdfs) {
      const fileKey = pdf.id;
      const alreadyProcessed = processedLog[fileKey] && processedLog[fileKey].md5Checksum === pdf.md5Checksum;
      if (alreadyProcessed) continue;

      console.log(`Processing new/changed file: ${folder.name} / ${pdf.name}`);
      try {
        const buf = await downloadFile(drive, pdf.id);
        const report = await extractAudit(buf, storeCode, storeMaster);

        const totalQuestionsFound = Object.values(report.detail).flat().length;
        const scoresInRange = report.overall >= 0 && report.overall <= 100
          && Object.values(report.sections).every(s => s >= 0 && s <= 100);
        if (totalQuestionsFound < 20 || !report.month || !scoresInRange) {
          skipped.push({
            folder: folder.name,
            file: pdf.name,
            reason: `low-confidence extraction (${totalQuestionsFound} questions found, month=${report.month}, overall=${report.overall}%, sections=${JSON.stringify(report.sections)})`,
          });
          continue;
        }

        extracted.push(report);
        processedLog[fileKey] = {
          md5Checksum: pdf.md5Checksum,
          fileName: pdf.name,
          folderName: folder.name,
          processedAt: new Date().toISOString(),
          storeCode,
          month: report.month,
        };
        newReportsCount++;
      } catch (err) {
        skipped.push({ folder: folder.name, file: pdf.name, reason: `extraction error: ${err.message}` });
      }
    }
  }

  if (newReportsCount === 0) {
    console.log('No new audit reports found. Nothing to sync.');
    if (skipped.length) {
      console.log(`(${skipped.length} file(s) skipped:`, JSON.stringify(skipped, null, 2), ')');
    }
    fs.writeFileSync(SYNC_CHANGES_PATH, JSON.stringify([]));
    return;
  }

  console.log(`Fetching current dashboard data...`);
  const dashboardData = await downloadJson(drive, DASHBOARD_FILE_ID);

  const changedStoreCodes = [];
  extracted.forEach(report => {
    const result = mergeReport(dashboardData, report);
    console.log(`  ${result.action}: ${report.code} (${report.month}) - overall ${report.overall}%`);
    changedStoreCodes.push(report.code);
  });

  console.log('Uploading updated dashboard data to Drive...');
  await uploadJson(drive, DASHBOARD_FILE_ID, dashboardData);

  saveProcessedLog(processedLog);
  fs.writeFileSync(SYNC_CHANGES_PATH, JSON.stringify(changedStoreCodes));

  console.log(`\nDone. ${newReportsCount} report(s) synced.`);
  if (skipped.length) {
    console.log(`${skipped.length} file(s) skipped:`, JSON.stringify(skipped, null, 2));
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
