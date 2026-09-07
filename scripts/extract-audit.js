const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const { SECTIONS } = require('./template');

// ---- text cleanup ----
// Masks calendar dates and clock times inside free-text auditor comments —
// these can let a store's team narrow down or identify which day/time slot
// an anonymous mystery audit visit happened, potentially identifying the
// auditor. Masks the specific date/time phrase in place (not the whole
// sentence), since the surrounding text is usually the substantive feedback.
// Durations ("served within 15 minutes") are left alone — they don't reveal
// *when* a visit happened, only how long something took.
function maskSensitiveDateTime(text) {
  if (!text) return text;
  let masked = text;
  // Clock times: 12-hour AM/PM ("7:48 PM", "08: 06 PM") and 24-hour "hours" forms
  // ("13:47 hours", "2100 hours").
  masked = masked.replace(/\d{1,2}:\s?\d{2}\s*[AP]M/gi, '[time removed]');
  masked = masked.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\s*hours\b/gi, '[time removed]');
  masked = masked.replace(/\b\d{3,4}\s*hours\b/gi, '[time removed]');
  // Explicit calendar dates: "22 August", "August 22nd, 2026", "2026-08-22", "22-08-2026".
  const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';
  masked = masked.replace(new RegExp('\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:' + MONTHS + ')(?:,?\\s*\\d{4})?\\b', 'gi'), '[date removed]');
  masked = masked.replace(new RegExp('\\b(?:' + MONTHS + ')\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?\\b', 'gi'), '[date removed]');
  masked = masked.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '[date removed]');
  masked = masked.replace(/\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/g, '[date removed]');
  return masked;
}

function cleanText(raw) {
  // strip the repeated page-header banner ("Aug 2026 | <store> ... TG"),
  // which can wrap across 2 lines for stores with longer addresses
  let text = raw.replace(/\n[A-Z][a-z]+ \d{4} \| [\s\S]{0,400}? TG\n/g, '\n');
  return text
    .split('\n')
    .filter(line => {
      const t = line.trim();
      if (!t) return true;
      if (/^copyright/i.test(t)) return false;
      if (/^--\s*\d+\s*of\s*\d+\s*--$/i.test(t)) return false;
      if (/^\d+:\d{2}(\s*\/\s*\d+:\d{2})?$/.test(t)) return false; // video player timestamps
      return true;
    })
    .join('\n');
}

function findScoreAfter(text, fromIdx, toIdx) {
  const boundary = toIdx === -1 ? text.length : toIdx;
  const slice = text.slice(fromIdx, boundary);

  // Anchor tightly on the "N/A / Yes / No" options block that immediately
  // follows every scored question, then only look a short distance past it
  // for a score fraction. This prevents runaway matches into unrelated
  // later text (an address, a later question, a leaked header) when a
  // question has no score because N/A was selected.
  const optionsMatch = slice.match(/N\/A\s*\n\s*Yes\s*\n\s*No\s*\n/);
  if (optionsMatch) {
    const searchFrom = optionsMatch.index + optionsMatch[0].length;
    const lookahead = slice.slice(searchFrom, searchFrom + 20);
    const m = lookahead.match(/^\s*(\d+)\s*\/\s*(\d+)/);
    return m ? { earned: parseInt(m[1], 10), possible: parseInt(m[2], 10) } : null;
  }

  // The 1-10 recommendation scale question has no N/A/Yes/No block —
  // anchor on its enumerated "0\n1\n2...\n10\n" option list instead.
  const scaleMatch = slice.match(/(?:^|\n)0\s*\n1\s*\n2\s*\n3\s*\n4\s*\n5\s*\n6\s*\n7\s*\n8\s*\n9\s*\n10\s*\n/);
  if (scaleMatch) {
    const searchFrom = scaleMatch.index + scaleMatch[0].length;
    const lookahead = slice.slice(searchFrom, searchFrom + 20);
    const m = lookahead.match(/^\s*(\d+)\s*\/\s*(\d+)/);
    return m ? { earned: parseInt(m[1], 10), possible: parseInt(m[2], 10) } : null;
  }

  return null;
}

function extractSections(text) {
  const detail = {};
  const sectionsOut = {};
  const comments = {};

  // locate each section header's start index, in template order
  const sectionIdx = SECTIONS.map(s => ({
    key: s.key,
    idx: text.indexOf(s.match),
  }));

  SECTIONS.forEach((sectionDef, i) => {
    const startIdx = sectionIdx[i].idx;
    if (startIdx === -1) {
      console.warn(`  ! Section not found: ${sectionDef.key}`);
      return;
    }
    const endIdx = i + 1 < SECTIONS.length && sectionIdx[i + 1].idx !== -1
      ? sectionIdx[i + 1].idx
      : text.length;
    const sectionText = text.slice(startIdx, endIdx);

    // locate each question within this section's text window
    const qPositions = sectionDef.questions.map(q => ({
      ...q,
      idx: sectionText.indexOf(q.match),
    }));

    const rows = [];
    let earnedSum = 0, possibleSum = 0;

    qPositions.forEach((q, qi) => {
      if (q.idx === -1) {
        console.warn(`    ! Question not found in ${sectionDef.key}: "${q.match}"`);
        return;
      }
      const nextIdx = qi + 1 < qPositions.length && qPositions[qi + 1].idx !== -1
        ? qPositions[qi + 1].idx
        : sectionText.length;
      const score = findScoreAfter(sectionText, q.idx, nextIdx);
      if (score === null) {
        // N/A - excluded from detail + denominator, matches existing schema behavior
        return;
      }
      rows.push([q.label, score.earned, score.possible]);
      earnedSum += score.earned;
      possibleSum += score.possible;
    });

    detail[sectionDef.key] = rows;
    sectionsOut[sectionDef.key] = possibleSum > 0
      ? Math.round((earnedSum / possibleSum) * 100)
      : 0;

    // extract comment: from comment match text to end of section
    const cIdx = sectionText.indexOf(sectionDef.comment.match);
    if (cIdx !== -1) {
      let commentText = sectionText.slice(cIdx + sectionDef.comment.match.length);
      // strip leading punctuation/newline, stop at "File Upload" marker if present
      commentText = commentText.replace(/^[.\s]+/, '');
      const fileUploadIdx = commentText.search(/\n?\d+\.\s*File Upload/);
      if (fileUploadIdx !== -1) commentText = commentText.slice(0, fileUploadIdx);
      commentText = commentText.replace(/\n+/g, ' ').trim();
      comments[sectionDef.key] = maskSensitiveDateTime(commentText);
    } else {
      console.warn(`    ! Comment not found in ${sectionDef.key}`);
      comments[sectionDef.key] = '';
    }
  });

  const overallEarned = Object.values(detail).flat().reduce((s, r) => s + r[1], 0);
  const overallPossible = Object.values(detail).flat().reduce((s, r) => s + r[2], 0);
  const overall = overallPossible > 0 ? Math.round((overallEarned / overallPossible) * 100) : 0;

  return { detail, sections: sectionsOut, comments, overall, overallEarned, overallPossible };
}

function extractOverview(text) {
  const out = {};

  const dateMatch = text.match(/Date of Audit\s*\n?\s*(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) out.auditDate = dateMatch[1];

  const billMatch = text.match(/Bill No\.?:?\s*([A-Z0-9]+)\s*\n?\s*Bill Amount:?\s*₹?([\d,]+)/i);
  if (billMatch) {
    out.billNo = billMatch[1];
    out.billAmount = billMatch[2];
  }

  const staffMatch = text.match(/interacted with during your visit\s*\n(.+?)\n/);
  if (staffMatch) out.staffMention = staffMatch[1].trim();

  // items ordered block: between "Items Ordered" and "Please mention the names"
  const itemsMatch = text.match(/Items Ordered\s*\n([\s\S]*?)\n7\./);
  if (itemsMatch) {
    out.itemsOrderedRaw = itemsMatch[1].trim();
  }

  // serving time free-text (order taking process, "order taking time & order serving time").
  // Bounded on the NEXT KNOWN question's literal text rather than a generic
  // "\n<digit>." pattern — the answer itself often contains its own numbered
  // list (e.g. "1. Item A ... 2. Item B ..."), which a generic digit-dot
  // boundary would mistake for the next form question and truncate on.
  const servingMatch = text.match(/order serving time for each ordered items\?\s*\n([\s\S]*?)\n(?:\d+\.\s*)?Did the Service staff recommend any product items from the menu/);
  if (servingMatch) out.servingRaw = servingMatch[1].trim();

  return out;
}

function parseClockTime(str) {
  const m = str.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

// Finds all clock-time mentions in a chunk of text, in both 12-hour AM/PM
// form ("8:15 PM") and 24-hour "HH:MM hours" form ("20:06 hours"), returning
// them in reading order with their minutes-since-midnight value.
function findTimesInText(text) {
  const found = [];
  const re12 = /\d{1,2}:\s?\d{2}\s*[AP]M/gi;
  let m;
  while ((m = re12.exec(text)) !== null) {
    const mins = parseClockTime(m[0].replace(/\s+/g, ''));
    if (mins !== null) found.push({ index: m.index, raw: m[0], minutes: mins });
  }
  const re24 = /\b([01]?\d|2[0-3]):([0-5]\d)\s*hours\b/gi;
  while ((m = re24.exec(text)) !== null) {
    found.push({ index: m.index, raw: m[0], minutes: parseInt(m[1], 10) * 60 + parseInt(m[2], 10) });
  }
  found.sort((a, b) => a.index - b.index);
  return found;
}

// Strategy 0: any line with exactly two clock times on it — take the
// absolute difference as the serving time. Deliberately wording- and
// format-independent: no leading item number required, works with either
// 12-hour or 24-hour times, and the item name is read either from before
// the times (dash-separated, e.g. "Item - Ordered at ... received at ...")
// or from a trailing "for <item>" clause (e.g. "...received at ... for Item").
function parseTwoTimesPerLine(servingRaw) {
  const results = [];
  servingRaw.split('\n').forEach(rawLine => {
    const line = rawLine.trim();
    if (!line) return;
    const times = findTimesInText(line);
    if (times.length !== 2) return;

    let item = null;
    const forMatch = line.match(/\bfor\s+([^\n]+?)\s*\.?\s*$/i);
    if (forMatch && line.indexOf(forMatch[0]) > times[1].index) {
      item = forMatch[1].trim();
    } else {
      const dashIdx = line.search(/\s-\s/);
      const cutIdx = dashIdx !== -1 ? dashIdx : times[0].index;
      item = line.slice(0, cutIdx).replace(/^\s*\d+\.\s*/, '').trim();
    }
    if (!item) return;

    let delta = Math.abs(times[1].minutes - times[0].minutes);
    if (delta > 12 * 60) delta = 24 * 60 - delta; // guard against a midnight-spanning pair
    results.push([item, delta]);
  });
  return results;
}

// Finds a clock time associated with the moment the order was placed/taken,
// checking both word orders since reports phrase this differently
// ("order was taken at 8:15 PM" vs "at 8:15 PM ... order was placed").
function findOrderTakenTime(text) {
  let m = text.match(/(?:order (?:was )?(?:taken|placed)|placed the order|were ordered)[^\n]*?(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (m) return parseClockTime(m[1]);
  m = text.match(/(\d{1,2}:\d{2}\s*[AP]M)[^\n]*?(?:order (?:was )?(?:taken|placed)|placed the order|were ordered)/i);
  if (m) return parseClockTime(m[1]);
  return null;
}

// Finds "<description> served <time>" clauses in narrative text, checking
// both word orders ("8:28 PM – X was served" and "X was served at 8:28 PM").
function extractServeLines(servingRaw) {
  const lines = [];
  let re = /(\d{1,2}:\d{2}\s*[AP]M)\s*[–-]\s*([^\n.]*?served[^\n.]*)/gi;
  let m;
  while ((m = re.exec(servingRaw)) !== null) {
    lines.push({ time: m[1], desc: m[2] });
  }
  re = /([^\n.]*?served[^\n.]*?at\s*(\d{1,2}:\d{2}\s*[AP]M))/gi;
  while ((m = re.exec(servingRaw)) !== null) {
    lines.push({ time: m[2], desc: m[1] });
  }
  return lines;
}

function wordOverlap(itemName, desc) {
  const itemWords = itemName.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const descLower = desc.toLowerCase();
  return itemWords.filter(w => descLower.includes(w)).length;
}

// Sanity check for Strategy 1's results: every extracted item name must
// share at least one real word with something actually on the items-ordered
// list, and no entry may have a zero-minute (identical-time) delta — both
// are strong signs the "two times on a line" match fired on a coincidental
// pair of unrelated timestamps in flowing prose, not a genuine structured
// per-item entry, and the whole batch should be discarded rather than trusted.
function twoTimesResultsPlausible(twoTimes, items) {
  if (!items.length) return true; // nothing to cross-check against — trust it
  return twoTimes.every(([name, delta]) => {
    if (delta === 0) return false;
    if (name.length < 3) return false;
    return items.some(item => wordOverlap(item, name) > 0 || wordOverlap(name, item) > 0);
  });
}

// Serving time = order-served time minus order-taken time. Several report
// phrasings are seen in practice, tried in order of precision/confidence:
//   0. Explicit joint-serving statement: "...served together, just 9 minutes
//      after the order was placed" — applies directly to every ordered item,
//      since it's a definitive final statement (and can override an earlier,
//      merely-promised/estimated duration mentioned elsewhere in the same text).
//   1. Any line with exactly two clock times — take the difference (strategy
//      above), independent of wording, numbering, or 12h/24h format.
//   2. Direct duration: "...served within 15 minutes" — used as-is.
//   3. Narrative with one shared order-taken time and separate per-item
//      "served at" mentions — each item matched to its best-word-overlap
//      unclaimed mention, to correctly split dishes that share a word
//      (e.g. two "Chicken ..." items).
// Rejects a candidate item name that's actually a leaked sentence fragment
// rather than a real dish name — either implausibly long, or containing a
// word that only shows up in narrative prose ("was", "served", "namely",
// "both", etc.), never in an actual dish name in this dataset.
function looksLikeSentenceFragment(name) {
  if (!name) return true;
  const words = name.trim().split(/\s+/);
  if (words.length > 6) return true;
  const blocklist = ['we', 'was', 'were', 'placed', 'namely', 'both', 'items', 'received', 'ordered', 'please', 'kindly', 'informed', 'staff', 'served'];
  const lower = name.toLowerCase();
  return blocklist.some(w => new RegExp('\\b' + w + '\\b', 'i').test(lower));
}

function parseServingInner(servingRaw, itemsOrderedRaw) {
  if (!servingRaw) return [];

  const items = [];
  if (itemsOrderedRaw) {
    itemsOrderedRaw.split('\n').forEach(line => {
      const m = line.match(/^\d+\.\s*(.+)$/);
      if (!m) return;
      // Strips a trailing "- Nqty" or bare "- N" quantity marker some
      // reports leave attached to the item name (e.g. "Kebab - 1qty" or
      // just "Kebab - 1").
      const name = m[1].trim().replace(/\s*[–-]\s*\d+\s*(qty)?\s*$/i, '').trim();
      if (name) items.push(name);
    });
  }

  // Strategy 0: explicit joint-serving override, e.g. "9 minutes after the
  // order was placed" — applies to every ordered item when present.
  const jointMatch = servingRaw.match(/(\d+)\s*minutes after (?:the )?order (?:was )?(?:placed|taken)/i);
  if (jointMatch && items.length) {
    const mins = parseInt(jointMatch[1], 10);
    return items.map(item => [item, mins]);
  }

  // Strategy 1: any line with exactly two clock times. Only trusted when it
  // finds a result for EVERY ordered item AND each result plausibly matches a
  // real ordered item — partial or implausible matches are a sign this fired
  // accidentally on narrative prose (where a PDF line-wrap can put two
  // unrelated timestamps together), so the whole batch is discarded in favor
  // of the narrative strategy below rather than trusting a coincidental hit.
  const twoTimes = parseTwoTimesPerLine(servingRaw);
  if (twoTimes.length && (!items.length || twoTimes.length === items.length) && twoTimesResultsPlausible(twoTimes, items)) {
    return twoTimes;
  }

  if (!items.length) return [];

  const results = [];

  // Strategy 2: direct "X minutes" phrasing.
  items.forEach(item => {
    const words = item.split(/\s+/).filter(w => w.length > 3).sort((a, b) => b.length - a.length);
    for (const w of words) {
      const re = new RegExp(w + '[^.]*?(\\d+)\\s*minutes', 'i');
      const m = servingRaw.match(re);
      if (m) { results.push([item, parseInt(m[1], 10)]); break; }
    }
  });
  if (results.length) return results;

  // Strategy 3: shared order-taken time + best-overlap per-item served mentions.
  const orderTakenTime = findOrderTakenTime(servingRaw);
  if (orderTakenTime === null) return [];

  const serveLines = extractServeLines(servingRaw);
  const usedIdx = new Set();
  items.forEach(item => {
    let bestIdx = -1, bestScore = 0;
    serveLines.forEach((line, idx) => {
      if (usedIdx.has(idx)) return;
      const score = wordOverlap(item, line.desc);
      if (score > bestScore) { bestScore = score; bestIdx = idx; }
    });
    if (bestIdx !== -1) {
      usedIdx.add(bestIdx);
      const servedTime = parseClockTime(serveLines[bestIdx].time);
      if (servedTime !== null) {
        let delta = servedTime - orderTakenTime;
        if (delta < 0) delta += 24 * 60; // guard against midnight rollover
        results.push([item, delta]);
      }
    }
  });
  return results;
}

// Public entry point: runs the actual extraction logic above, then filters
// out any result whose item name looks like a leaked sentence fragment
// rather than a real dish name — applied once here so every strategy/return
// path above is covered uniformly, instead of needing to remember to filter
// at each individual return statement.
function parseServing(servingRaw, itemsOrderedRaw) {
  return parseServingInner(servingRaw, itemsOrderedRaw)
    .filter(([name]) => !looksLikeSentenceFragment(name));
}

async function extractAudit(pdfBuffer, storeCode, storeMaster) {
  const parser = new PDFParse({ data: pdfBuffer });
  const result = await parser.getText();
  const cleaned = cleanText(result.text);

  // use only the detailed pass: from the first "1. OVERVIEW" marker onward
  const overviewIdx = cleaned.indexOf('1. OVERVIEW');
  if (overviewIdx === -1) throw new Error('Could not locate detailed pass (1. OVERVIEW marker not found)');
  const detailedText = cleaned.slice(overviewIdx);

  const { detail, sections, comments, overall } = extractSections(detailedText);
  const overview = extractOverview(detailedText);
  const serving = parseServing(overview.servingRaw, overview.itemsOrderedRaw);

  const master = storeMaster.find(s => s.code === storeCode);
  if (!master) {
    console.warn(`  ! Store code ${storeCode} not found in store master`);
  }

  const monthLabel = overview.auditDate
    ? new Date(overview.auditDate).toLocaleString('en-US', { month: 'short', year: 'numeric' })
    : null;

  const report = {
    name: master ? master.name : storeCode,
    am: master ? master.am : null,
    rm: master ? master.rm : null,
    region: master ? master.region : null,
    type: master ? master.type : null,
    code: storeCode,
    month: monthLabel,
    overall,
    sections,
    serving,
    detail,
    comments,
  };

  return report;
}

module.exports = { extractAudit, cleanText, extractSections, extractOverview };
