/* ================= ACCESS GATE (Firebase Auth: signup/login) =================
   Separate from the Google Sign-In block below, which is only for the
   optional "Sync to Google Drive" feature once someone is already inside
   the dashboard. This gate controls whether they can see the dashboard at
   all — nobody without an account (created via the OTP-verified signup
   flow, restricted to @paradisefoodcourt.in) gets past it. */
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBAsO1CXgej9HLYAiu_yFKfzL0AEGpqCSk',
  authDomain: 'paradise-audit-auth.firebaseapp.com',
  projectId: 'paradise-audit-auth',
  storageBucket: 'paradise-audit-auth.firebasestorage.app',
  messagingSenderId: '662693849724',
  appId: '1:662693849724:web:5fdf518c41687a6ff737f9',
};
const FIREBASE_FUNCTIONS_REGION = 'asia-south1';
const SIGNUP_ALLOWED_DOMAIN = 'paradisefoodcourt.in';

firebase.initializeApp(FIREBASE_CONFIG);
const fbAuth = firebase.auth();
const fbFunctions = firebase.app().functions(FIREBASE_FUNCTIONS_REGION);
fbAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

let pendingSignupEmail = null;

function showAuthMsg(elId, text, isErr){
  const el = document.getElementById(elId);
  el.textContent = text;
  el.className = 'auth-msg ' + (isErr ? 'err' : 'ok');
}

function friendlyAuthError(e){
  const code = e && e.code;
  if(code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found'){
    return 'Incorrect email or password.';
  }
  if(code === 'auth/too-many-requests') return 'Too many attempts. Please wait a bit and try again.';
  if(code === 'auth/invalid-email') return 'Enter a valid email address.';
  return (e && e.message) || 'Something went wrong. Please try again.';
}
function friendlyFunctionError(e){
  return (e && e.message) || 'Something went wrong. Please try again.';
}

function switchAuthTab(tab){
  document.getElementById('authTabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('authTabSignup').classList.toggle('active', tab === 'signup');
  document.getElementById('loginForm').style.display = tab === 'login' ? 'flex' : 'none';
  document.getElementById('signupStep1').style.display = tab === 'signup' ? 'flex' : 'none';
  document.getElementById('signupStep2').style.display = 'none';
  document.getElementById('signupStep3').style.display = 'none';
  document.getElementById('loginMsg').textContent = '';
  document.getElementById('signupStep1Msg').textContent = '';
}

function initAuthGate(){
  document.getElementById('authTabLogin').onclick = () => switchAuthTab('login');
  document.getElementById('authTabSignup').onclick = () => switchAuthTab('signup');

  document.getElementById('loginBtn').onclick = async () => {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if(!email || !password){ showAuthMsg('loginMsg', 'Enter email and password.', true); return; }
    showAuthMsg('loginMsg', 'Signing in…', false);
    try{
      await fbAuth.signInWithEmailAndPassword(email, password);
    }catch(e){
      showAuthMsg('loginMsg', friendlyAuthError(e), true);
    }
  };

  document.getElementById('sendOtpBtn').onclick = async () => {
    const email = document.getElementById('signupEmail').value.trim().toLowerCase();
    if(!email.endsWith('@' + SIGNUP_ALLOWED_DOMAIN)){
      showAuthMsg('signupStep1Msg', 'Only @' + SIGNUP_ALLOWED_DOMAIN + ' email addresses can sign up.', true);
      return;
    }
    showAuthMsg('signupStep1Msg', 'Sending code…', false);
    try{
      const requestSignupOtp = fbFunctions.httpsCallable('requestSignupOtp');
      await requestSignupOtp({ email });
      pendingSignupEmail = email;
      document.getElementById('signupEmailConfirm').textContent = email;
      document.getElementById('otpInput').value = '';
      document.getElementById('signupStep1').style.display = 'none';
      document.getElementById('signupStep2').style.display = 'flex';
      showAuthMsg('signupStep2Msg', 'Code sent — check your inbox.', false);
    }catch(e){
      showAuthMsg('signupStep1Msg', friendlyFunctionError(e), true);
    }
  };

  document.getElementById('resendOtpBtn').onclick = async () => {
    if(!pendingSignupEmail) return;
    showAuthMsg('signupStep2Msg', 'Resending code…', false);
    try{
      const requestSignupOtp = fbFunctions.httpsCallable('requestSignupOtp');
      await requestSignupOtp({ email: pendingSignupEmail });
      showAuthMsg('signupStep2Msg', 'New code sent — check your inbox.', false);
    }catch(e){
      showAuthMsg('signupStep2Msg', friendlyFunctionError(e), true);
    }
  };

  document.getElementById('verifyOtpBtn').onclick = async () => {
    const otp = document.getElementById('otpInput').value.trim();
    if(!otp){ showAuthMsg('signupStep2Msg', 'Enter the code.', true); return; }
    showAuthMsg('signupStep2Msg', 'Verifying…', false);
    try{
      const verifySignupOtp = fbFunctions.httpsCallable('verifySignupOtp');
      await verifySignupOtp({ email: pendingSignupEmail, otp });
      document.getElementById('signupStep2').style.display = 'none';
      document.getElementById('signupStep3').style.display = 'flex';
    }catch(e){
      showAuthMsg('signupStep2Msg', friendlyFunctionError(e), true);
    }
  };

  document.getElementById('createAccountBtn').onclick = async () => {
    const pw = document.getElementById('newPassword').value;
    const pw2 = document.getElementById('newPasswordConfirm').value;
    if(pw.length < 8){ showAuthMsg('signupStep3Msg', 'Password must be at least 8 characters.', true); return; }
    if(pw !== pw2){ showAuthMsg('signupStep3Msg', 'Passwords do not match.', true); return; }
    showAuthMsg('signupStep3Msg', 'Creating account…', false);
    try{
      const completeSignup = fbFunctions.httpsCallable('completeSignup');
      const result = await completeSignup({ email: pendingSignupEmail, password: pw });
      await fbAuth.signInWithCustomToken(result.data.token);
    }catch(e){
      showAuthMsg('signupStep3Msg', friendlyFunctionError(e), true);
    }
  };

  document.getElementById('appSignOutBtn').onclick = () => fbAuth.signOut();
}
initAuthGate();

let dashboardInitStarted = false;
fbAuth.onAuthStateChanged((user) => {
  const gate = document.getElementById('authGate');
  const appContent = document.getElementById('appContent');
  if(user){
    gate.style.display = 'none';
    appContent.style.display = 'block';
    if(!dashboardInitStarted){
      dashboardInitStarted = true;
      initDashboard();
    }
  } else {
    gate.style.display = 'flex';
    appContent.style.display = 'none';
  }
});

/* ================= CONFIG ================= */
/* Public read-only access so the dashboard can auto-refresh on open with NO sign-in.
   This is the sole Drive mechanism in use — there is no manual save/load or
   sign-in UI; the backend automation writes to this file, the dashboard only reads it. */
const DRIVE_API_KEY = 'AIzaSyDhKnb44lpQcyAD6JZeSphXB5T4TFQkz1k';
const DRIVE_DATA_FILE_ID = '1FeH2F60ZEWr3sBUfRYbPDaz-biTI6-wz';

/* ---------- Master store mapping ---------- */
const MASTER = JSON.parse(document.getElementById('master-data').textContent);
const MASTER_BY_CODE = {};
MASTER.forEach(m => MASTER_BY_CODE[m.code] = m);

/* ---------- Logo ---------- */
const LOGO_B64 = document.getElementById('logo-data').textContent.trim();
document.getElementById('logoImg').src = 'data:image/png;base64,' + LOGO_B64;
document.getElementById('authLogoImg').src = 'data:image/png;base64,' + LOGO_B64;

/* ---------- Seed data: the 3 real audited stores ---------- */
const SEED_REPORTS = [
{code:'S1129', month:'Aug 2026', overall:79,
 sections:{'Ambience':93,'Order Taking':65,'F&B Quality':100,'Billing':85,'Recommendation':75},
 serving:[['Reshmi Kebab',13],['Nizami Biryani',21]],
 detail:{
  'Ambience':[['Welcome & comfortable',1,1],['Placards/lighting working',1,1],['No flies/insects',2,2],['Entrance/counter clean',2,2],['AC comfortable',1,1],['Music volume comfortable',0,1],['Restroom maintained',3,3],['Cleaning chart updated',2,2],['No tissues on floor',1,1],['Signage clean & lit',1,1]],
  'Order Taking':[['Greeted promptly',0,1],['Staff attentive',1,1],['Guided to table',0,1],['Water bottle pre-placed',0,1],['Menu presented',1,1],['Suggestive selling done',0,1],['Order repeated correctly',1,1],['Staff introduced self',0,1],['Loyalty pass recommended',0,1],['Dish announced before serving',0,2],['Satisfaction checked',2,2],['Finger bowl w/ lemon',2,2],['Table cleared in 5 min',2,2],['Staff well groomed',2,2]],
  'F&B Quality':[['Quality standards met',2,2],['Taste satisfactory',2,2],['Correct condiments',1,1]],
  'Billing':[['Hassle free',2,2],['Contact details taken',0,1],['Billed within 90s',2,2],['Multiple payment options',1,1],['Bill/receipt issued',5,5],['Feedback via SMS/Google',0,1],['Staff thanked at end',1,1]],
  'Recommendation':[['Memorable service',2,2],['Likelihood to recommend',7,10]]
 },
 comments:{
  'Ambience':'Signage well-lit and visible; entrance clean; hygiene satisfactory; AC comfortable; seating well organised, clutter-free. However, no music was playing. Washroom clean, hygienic, all fixtures working.',
  'Order Taking':'No staff at entrance to greet, table selected ourselves. Menus placed, well maintained. No pre-placed water bottle, had to request one. Mounika did not introduce herself but was attentive, responsive, pleasant smile. Order repeated correctly, spice level accommodated. Dishes not proactively announced before serving. No loyalty pass or offers mentioned.',
  'F&B Quality':'Both dishes served as ordered, appropriate portion size, satisfactory presentation and taste. Served at suitable temperature, correct cutlery/tissues/condiments provided.',
  'Billing':'Billing process smooth, accurate, prompt. Cash accepted, correct bill provided. No issues with billing or revenue leakage. No contact number requested. No SMS/Google feedback request made. Staff thanked us at the end.',
  'Recommendation':'Positives: clean, tidy, well-maintained outlet; signage visible; menus well maintained; staff attentive and courteous; order repeated correctly with spice accommodation; food served correctly with good taste/portion/temperature; billing smooth and accurate; staff well-groomed; finger bowl provided, table cleared promptly. Negatives: no greeting at entrance, no pre-placed water, no staff introduction, no suggestive selling or loyalty pass, dishes not announced before serving, no feedback request during billing.'
 }},
{code:'S1101-05', month:'Aug 2026', overall:66,
 sections:{'Ambience':67,'Order Taking':56,'F&B Quality':75,'Billing':69,'Recommendation':75},
 serving:[['Fry Piece Chicken Biryani',9],['Nizami Chicken Biryani',5],['Falooda',5]],
 detail:{
  'Ambience':[['Welcome & comfortable',1,1],['Placards/lighting working',1,1],['No flies/insects',2,2],['Entrance/counter clean',2,2],['AC comfortable',1,1],['Music volume comfortable',1,1],['Restroom maintained',0,3],['Cleaning chart updated',0,2],['No tissues on floor',1,1],['Signage clean & lit',1,1]],
  'Order Taking':[['Greeted promptly',1,1],['Staff attentive',1,1],['Guided to table',1,1],['Water bottle pre-placed',0,1],['Water preference asked',1,1],['Menu presented',1,1],['Suggestive selling done',0,1],['Order repeated correctly',0,1],['Staff introduced self',0,1],['Loyalty pass recommended',0,1],['Dish announced before serving',0,2],['Satisfaction checked',0,2],['Finger bowl w/ lemon',0,2],['Table cleared in 5 min',2,2],['Staff well groomed',2,2]],
  'F&B Quality':[['Quality standards met',2,2],['Hot/cold served right temp',2,2],['Taste satisfactory',0,2],['Correct condiments',1,1],['Takeaway packing norms',1,1]],
  'Billing':[['Hassle free',2,2],['Contact details taken',0,1],['Billed within 90s',0,2],['Multiple payment options',1,1],['Bill/receipt issued',5,5],['Feedback via SMS/Google',0,1],['Staff thanked at end',1,1]],
  'Recommendation':[['Memorable service',2,2],['Likelihood to recommend',7,10]]
 },
 comments:{
  'Ambience':'Signage well maintained and illuminated, promotional placards impressive. Security checked belongings at entrance. Female staff greeted proactively with folded hands, escorted to table, helped charge phone (tipped Rs 30 via UPI). AC maintained, music played. Washroom door not well maintained, floor wet and had visible stains though fixtures worked. Cleaning checklist displayed but not updated.',
  'Order Taking':'Staff proactively assisted with table and took order. Confirmed item availability, recommended Nizami vs Fry Piece options. No water bottle pre-placed, staff asked and brought chilled water. Order not repeated or serving time proactively informed - had to ask; informed ~10 min, served on time. Recommended ice cream/Falooda when asked but did not proactively suggest food items. No loyalty pass info given. Table not cleared proactively after meal; finger bowl only on request.',
  'F&B Quality':'Appearance satisfactory, served at appropriate temperature. Taste could be improved; portion size could be increased for two people. Mirchi ka Salaan was noticeably sour and did not complement the biryani. Remaining food packed properly in branded packaging.',
  'Billing':'Billing requested ~9:05 PM, hassle-free with multiple payment options. Paid cash, staff returned correct change. Billing time on receipt incorrectly recorded as 8:07 PM instead of actual 9:07 PM. No feedback requested. Staff helped charge phone, accepted Rs 30 UPI tip.',
  'Recommendation':'Positives: well-groomed staff, impressive signage/placards, appealing greeting gesture, satisfactory service, well-maintained ambiance. Negatives: no preplaced water bottle, incorrect bill timestamp, restroom door/cleaning chart not maintained, no self-suggested items/loyalty pass/offers, order not repeated or dishes named before serving, no satisfaction check, finger bowl only on request.'
 }},
{code:'S1142', month:'Aug 2026', overall:64,
 sections:{'Ambience':53,'Order Taking':61,'F&B Quality':100,'Billing':69,'Recommendation':58},
 serving:[['Chicken Tikka Kebab',9],['Nizami Chicken Biryani',9]],
 detail:{
  'Ambience':[['Welcome & comfortable',1,1],['Placards/lighting working',0,1],['No flies/insects',2,2],['Entrance/counter clean',2,2],['AC comfortable',1,1],['Music volume comfortable',1,1],['Restroom maintained',0,3],['Cleaning chart updated',0,2],['No tissues on floor',0,1],['Signage clean & lit',1,1]],
  'Order Taking':[['Greeted promptly',0,1],['Staff attentive',1,1],['Guided to table',0,1],['Water bottle pre-placed',1,1],['Menu presented',1,1],['Veg/non-veg asked',1,1],['Suggestive selling done',0,1],['Order repeated correctly',0,1],['Staff introduced self',0,1],['Loyalty pass recommended',0,1],['Dish announced before serving',2,2],['Staff pleasing smile',0,1],['Finger bowl w/ lemon',0,2],['Table cleared in 5 min',2,2],['Staff well groomed',2,2]],
  'F&B Quality':[['Quality standards met',2,2],['Hot/cold served right temp',2,2],['Taste satisfactory',2,2],['Correct condiments',1,1]],
  'Billing':[['Hassle free',0,2],['Contact details taken',0,1],['Billed within 90s',2,2],['Multiple payment options',1,1],['Bill/receipt issued',5,5],['Feedback via SMS/Google',0,1],['Staff thanked at end',1,1]],
  'Recommendation':[['Memorable service',0,2],['Likelihood to recommend',7,10]]
 },
 comments:{
  'Ambience':'Exterior signage well-lit, properly maintained. Indoor temperature comfortable, soft music playing. Water bottle available at each table. Restroom needs improvement: WC flush not operational (notice displayed), wash-area cabinet damaged. Tissue and biryani rice observed on dining floor; table had visible stain. Two ceiling lights not functioning.',
  'Order Taking':'No staff available to greet or assist with seating; table chosen independently. Staff said "Yes, sir" without greeting, did not introduce herself. Recommended mutton over chicken; used phone while taking order (felt unprofessional). Revised order (mutton to chicken) not clearly reconfirmed. No proactive veg/non-veg enquiry or offer-of-the-day communication; had to ask. Finger bowl only provided after request.',
  'F&B Quality':'Nizami Biryani flavorful, well-prepared, rich in taste. Chicken Tikka Kebab tender, well-cooked, enjoyable. Highly satisfied with food quality, taste, presentation and portion.',
  'Billing':'Bill folder initially provided without the bill inside. Total ₹827, paid ₹1,000 cash — initially only ₹70 returned instead of ₹173, corrected after flagging to Laxmi who apologised and coordinated with billing counter. Contact number not requested or recorded. All major payment options available.',
  'Recommendation':'Positives: clean well-lit signage, comfortable temperature, appropriate music volume, water bottle already on table, food served hot and well-presented, tasty biryani and kebab, cutlery/tissues/condiments provided. Negatives: no staff greeting or seating assistance, unprofessional phone use while ordering, revised order not reconfirmed, no proactive recommendations or offers, restroom WC flush broken and countertop damaged, dining area cleanliness lapses, billing change discrepancy needing correction.'
 }}
];

const SECTION_NAMES = ['Ambience','Order Taking','F&B Quality','Billing','Recommendation'];

/* ---------- Quarter helpers: Q1 Feb-Apr, Q2 May-Jul, Q3 Aug-Oct, Q4 Nov-Jan ---------- */
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function parseMonthYear(monthStr){
  if(!monthStr) return null;
  const parts = monthStr.trim().split(/\s+/);
  const monIdx = MONTH_NAMES.indexOf(parts[0]);
  const year = parseInt(parts[1], 10);
  if(monIdx === -1 || isNaN(year)) return null;
  return {month: monIdx + 1, year};
}
function getQuarterInfo(monthStr){
  const my = parseMonthYear(monthStr);
  if(!my) return {key: -1, label: 'Unknown'};
  const {month, year} = my;
  let q, qYear, range;
  if(month >= 2 && month <= 4){ q = 1; qYear = year; range = 'Feb–Apr'; }
  else if(month >= 5 && month <= 7){ q = 2; qYear = year; range = 'May–Jul'; }
  else if(month >= 8 && month <= 10){ q = 3; qYear = year; range = 'Aug–Oct'; }
  else { q = 4; range = 'Nov–Jan'; qYear = (month === 1) ? year - 1 : year; }
  const key = qYear * 10 + q;
  const label = 'Q' + q + ' FY' + String(qYear).slice(-2) + ' (' + range + ')';
  return {key, label, q, qYear};
}
function allQuartersSorted(){
  const map = {};
  state.reports.forEach(r => {
    const info = getQuarterInfo(r.month);
    if(info.key === -1) return;
    map[info.key] = info.label;
  });
  return Object.entries(map).sort((a,b) => b[0]-a[0]).map(([key,label]) => ({key:Number(key), label}));
}
function previousQuarterKey(key){
  const quarters = allQuartersSorted().map(q => q.key).sort((a,b)=>b-a);
  const idx = quarters.indexOf(key);
  return (idx !== -1 && idx < quarters.length - 1) ? quarters[idx+1] : null;
}
function reportsForQuarterKey(key){
  return state.reports.filter(r => getQuarterInfo(r.month).key === key);
}

/* ---------- App state ---------- */
let state = {
  reports: [],
  thresholds: {pass: 79, review: 65},
  view: 'central',
  entity: null
};

/* ---------- Attach master fields to a report by code ---------- */
function enrich(r){
  const m = MASTER_BY_CODE[r.code] || {};
  return Object.assign({name: m.name || r.code, am: m.am || 'Unassigned', rm: m.rm || 'Unassigned', region: m.region || 'Unassigned', type: m.type || 'Unassigned'}, r);
}

/* ---------- Classification: Pass >80, Review 70-80, Critical <70 (overall score only) ---------- */
function classify(v){
  if(v > state.thresholds.pass) return 'pass';
  if(v >= state.thresholds.review) return 'review';
  return 'critical';
}
function tierMeta(cls){
  if(cls === 'pass') return {label:'Pass', color:'var(--pass)'};
  if(cls === 'review') return {label:'Review', color:'var(--review)'};
  return {label:'Critical', color:'var(--fail)'};
}

/* ---------- Public read-only Drive fetch (no sign-in needed) — used to auto-refresh on page open.
   This is the ONLY Drive mechanism the dashboard uses: it silently reads the
   latest data on every page load via a public API key. There is no manual
   sign-in, save, or load UI — the backend automation (GitHub Action) is what
   writes new data to this file; the dashboard only ever reads it. ---------- */
async function fetchPublicDriveData(){
  if(DRIVE_API_KEY.startsWith('PASTE_') || DRIVE_DATA_FILE_ID.startsWith('PASTE_')){
    return null; // not configured yet — caller falls back to browser storage
  }
  try{
    const url = 'https://www.googleapis.com/drive/v3/files/' + DRIVE_DATA_FILE_ID + '?alt=media&key=' + DRIVE_API_KEY;
    const res = await fetch(url);
    if(!res.ok) return null;
    return await res.text();
  }catch(e){
    return null;
  }
}

/* ---------- Normalize serving-time entries to [product, minutes] only.
   Protects against old data (synced to Drive before this fix) that still
   carries exact clock times — strips them the moment data loads. ---------- */
function stripExactServingTimes(reports){
  reports.forEach(r => {
    if(!Array.isArray(r.serving)) return;
    r.serving = r.serving.map(entry => [entry[0], entry[entry.length - 1]]);
  });
  return reports;
}

/* ---------- Drop serving-time entries whose "product name" is actually a
   leaked sentence fragment (e.g. "We placed the order for..." or "Biryani
   was served at") rather than a real dish name. Defensive display-layer
   cleanup — the backend extractor now filters these going forward, but this
   retroactively hides any already-synced store's bad entries without
   needing to re-process the original PDF. Also cleans a trailing "- N"
   quantity marker some reports leave attached to the item name. ---------- */
function looksLikeSentenceFragment(name){
  if(!name) return true;
  const words = String(name).trim().split(/\s+/);
  if(words.length > 6) return true;
  const blocklist = ['we','was','were','placed','namely','both','items','received','ordered','please','kindly','informed','staff','served'];
  const lower = String(name).toLowerCase();
  return blocklist.some(w => new RegExp('\\b' + w + '\\b', 'i').test(lower));
}
function cleanServingEntries(reports){
  reports.forEach(r => {
    if(!Array.isArray(r.serving)) return;
    r.serving = r.serving
      .map(entry => {
        let name = entry[0];
        if(typeof name === 'string') name = name.replace(/\s*[-–]\s*\d+\s*$/, '').trim();
        return [name, entry[entry.length - 1]];
      })
      .filter(([name]) => !looksLikeSentenceFragment(name));
  });
  return reports;
}

/* ---------- Mask calendar dates / clock times inside comment text.
   Defensive display-layer cleanup — the backend extractor already masks
   these going forward, but this retroactively protects any store whose
   comments were synced before that fix existed, without needing to
   re-process the original PDF. Masks the specific date/time phrase, not
   the whole sentence, since the rest is usually substantive feedback.
   Durations (e.g. "served within 15 minutes") are left untouched. ---------- */
function maskCommentDateTimes(reports){
  const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';
  const dateRe1 = new RegExp('\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:' + MONTHS + ')(?:,?\\s*\\d{4})?\\b', 'gi');
  const dateRe2 = new RegExp('\\b(?:' + MONTHS + ')\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?\\b', 'gi');
  reports.forEach(r => {
    if(!r.comments) return;
    Object.keys(r.comments).forEach(sec => {
      let text = r.comments[sec];
      if(!text) return;
      text = text.replace(/\d{1,2}:\s?\d{2}\s*[AP]M/gi, '[time removed]');
      text = text.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\s*hours\b/gi, '[time removed]');
      text = text.replace(/\b\d{3,4}\s*hours\b/gi, '[time removed]');
      text = text.replace(dateRe1, '[date removed]');
      text = text.replace(dateRe2, '[date removed]');
      text = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '[date removed]');
      text = text.replace(/\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/g, '[date removed]');
      r.comments[sec] = text;
    });
  });
  return reports;
}

/* ---------- Persistence: local ---------- */
function hasClaudeStorage(){
  return typeof window.storage !== 'undefined' && window.storage && typeof window.storage.get === 'function';
}
async function loadLocal(){
  // 1. Try a public (no sign-in) fetch from Drive first, so everyone opening the link
  //    sees the latest synced data automatically.
  const publicData = await fetchPublicDriveData();
  if(publicData){
    try{
      const parsed = JSON.parse(publicData);
      state.reports = maskCommentDateTimes(cleanServingEntries(stripExactServingTimes(parsed.reports || [])));
      state.thresholds = parsed.thresholds || state.thresholds;
      await saveLocal(false); // cache the CLEANED version locally, and auto-sync it back to Drive if signed in
      return;
    }catch(e){ /* fall through to local storage below */ }
  }
  // 2. Fall back to whatever's cached in this browser, or seed data if nothing at all.
  try{
    let raw = null;
    if(hasClaudeStorage()){
      const res = await window.storage.get('paradise_reports');
      raw = res ? res.value : null;
    } else {
      raw = localStorage.getItem('paradise_reports');
    }
    if(raw){
      const parsed = JSON.parse(raw);
      state.reports = maskCommentDateTimes(cleanServingEntries(stripExactServingTimes(parsed.reports || [])));
      state.thresholds = parsed.thresholds || state.thresholds;
    } else {
      state.reports = maskCommentDateTimes(cleanServingEntries(stripExactServingTimes(SEED_REPORTS.map(enrich))));
    }
  }catch(e){
    state.reports = maskCommentDateTimes(cleanServingEntries(stripExactServingTimes(SEED_REPORTS.map(enrich))));
  }
}
async function saveLocal(showMsg){
  const payload = JSON.stringify({reports: state.reports, thresholds: state.thresholds});
  try{
    if(hasClaudeStorage()){ await window.storage.set('paradise_reports', payload); }
    else { localStorage.setItem('paradise_reports', payload); }
    if(showMsg) flashStatus('Saved to this browser.', false);
  }catch(e){
    if(showMsg) flashStatus('Could not save locally: ' + e.message, true);
  }
}
function flashStatus(text, isErr){
  const msg = document.getElementById('storageMsg');
  if(!msg) return;
  msg.textContent = text;
  msg.className = 'status-msg ' + (isErr ? 'err' : 'ok');
}

/* ---------- Filtering by view ---------- */
function filteredReports(){
  const list = state.reports;
  if(state.view === 'central' || !state.entity) return list;
  if(state.view === 'store') return list.filter(r => r.code === state.entity);
  if(state.view === 'am') return list.filter(r => r.am === state.entity);
  if(state.view === 'rm') return list.filter(r => r.rm === state.entity);
  if(state.view === 'region') return list.filter(r => r.region === state.entity);
  if(state.view === 'type') return list.filter(r => r.type === state.entity);
  if(state.view === 'quarter') return list.filter(r => getQuarterInfo(r.month).label === state.entity);
  if(state.view === 'class') return list.filter(r => classify(r.overall) === state.entity);
  return list;
}

/* ---------- View tabs ---------- */
const TAB_DEFS = [
  ['central','Central'],['region','City'],['quarter','Quarter'],['rm','Zonal manager'],
  ['am','Area manager'],['type','Store type'],['store','Store']
];
function renderTabs(){
  const el = document.getElementById('viewTabs');
  el.innerHTML = '';
  TAB_DEFS.forEach(([key,label]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = key === state.view ? 'active' : '';
    b.onclick = () => { state.view = key; state.entity = null; renderEntityPicker(); renderAll(); };
    el.appendChild(b);
  });
}
function entityOptionsFor(view){
  if(view === 'quarter'){
    return allQuartersSorted().map(q => q.label);
  }
  const set = new Set();
  state.reports.forEach(r => {
    if(view === 'am') set.add(r.am);
    if(view === 'rm') set.add(r.rm);
    if(view === 'region') set.add(r.region);
    if(view === 'type') set.add(r.type);
    if(view === 'store') set.add(r.code);
  });
  return [...set];
}
function renderEntityPicker(){
  const row = document.getElementById('entityPickerRow');
  const sel = document.getElementById('entityPicker');
  const classRow = document.getElementById('classFilterRow');
  if(state.view === 'central'){
    row.style.display = 'none';
    classRow.style.display = 'none';
    return;
  }
  if(state.view === 'class'){
    row.style.display = 'none';
    classRow.style.display = 'flex';
    const label = state.entity === 'pass' ? 'Pass' : state.entity === 'review' ? 'Review' : 'Critical';
    document.getElementById('classFilterLabel').textContent = 'Showing: ' + label + ' stores';
    document.getElementById('classFilterClearBtn').onclick = () => {
      state.view = 'central'; state.entity = null; renderTabs(); renderEntityPicker(); renderAll();
    };
    return;
  }
  classRow.style.display = 'none';
  const opts = entityOptionsFor(state.view);
  row.style.display = opts.length ? 'flex' : 'none';
  sel.innerHTML = '';
  opts.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o; opt.textContent = o;
    sel.appendChild(opt);
  });
  if(opts.length){
    if(!state.entity || !opts.includes(state.entity)){ state.entity = opts[0]; }
    sel.value = state.entity;
  }
  sel.onchange = () => { state.entity = sel.value; renderAll(); };
}

/* ---------- Hero overall score + pass/review/critical counts ---------- */
function setMetricRatio(cardId, count, total){
  const card = document.getElementById(cardId);
  if(!card) return;
  let ratioEl = card.querySelector('.metric-ratio');
  if(!ratioEl){
    ratioEl = document.createElement('p');
    ratioEl.className = 'metric-ratio small-note';
    ratioEl.style.cssText = 'margin:3px 0 0;';
    card.appendChild(ratioEl);
  }
  if(total > 0){
    const pct = Math.round((count / total) * 100);
    ratioEl.textContent = count + '/' + total + ' \u00b7 ' + pct + '%';
  } else {
    ratioEl.textContent = '';
  }
}
function updateMetricLabels(){
  const passLbl = document.querySelector('#metricPassCard .lbl');
  const reviewLbl = document.querySelector('#metricReviewCard .lbl');
  const critLbl = document.querySelector('#metricCritCard .lbl');
  if(passLbl) passLbl.textContent = 'Pass (>' + state.thresholds.pass + '%)';
  if(reviewLbl) reviewLbl.textContent = 'Review (' + state.thresholds.review + '-' + state.thresholds.pass + '%)';
  if(critLbl) critLbl.textContent = 'Critical (<' + state.thresholds.review + '%)';
}
function renderHero(list){
  const heroScore = document.getElementById('heroScore');
  const heroBadge = document.getElementById('heroBadge');
  const passEl = document.getElementById('passCount');
  const reviewEl = document.getElementById('reviewCount');
  const critEl = document.getElementById('critCount');
  const totalEl = document.getElementById('totalCount');
  updateMetricLabels();
  if(!list.length){
    heroScore.textContent = '—';
    heroBadge.textContent = '';
    passEl.textContent = reviewEl.textContent = critEl.textContent = totalEl.textContent = '0';
    setMetricRatio('metricPassCard', 0, 0);
    setMetricRatio('metricReviewCard', 0, 0);
    setMetricRatio('metricCritCard', 0, 0);
    return;
  }
  const avg = Math.round(list.reduce((a,r)=>a+r.overall,0)/list.length);
  const cls = classify(avg);
  const t = tierMeta(cls);
  heroScore.textContent = avg + '%';
  heroBadge.textContent = t.label;
  heroBadge.className = 'badge ' + cls;
  const passCount = list.filter(r => classify(r.overall) === 'pass').length;
  const reviewCount = list.filter(r => classify(r.overall) === 'review').length;
  const critCount = list.filter(r => classify(r.overall) === 'critical').length;
  passEl.textContent = passCount;
  reviewEl.textContent = reviewCount;
  critEl.textContent = critCount;
  totalEl.textContent = list.length;
  setMetricRatio('metricPassCard', passCount, list.length);
  setMetricRatio('metricReviewCard', reviewCount, list.length);
  setMetricRatio('metricCritCard', critCount, list.length);
}
function renderStoreBadges(list){
  const el = document.getElementById('storeBadgeList');
  el.style.maxHeight = '230px';
  el.style.overflowY = 'auto';
  el.style.paddingRight = '4px';
  el.innerHTML = '';
  if(!list.length){ el.innerHTML = '<p class="small-note">No reports in this view yet.</p>'; return; }
  // Most recently added stores first; all stores stay in the list, the
  // container just shows roughly 5 rows at a time and scrolls for the rest.
  const ordered = [...list].reverse();
  ordered.forEach(r => {
    const cls = classify(r.overall);
    const t = tierMeta(cls);
    const row = document.createElement('div');
    row.className = 'report-row';
    row.style.cursor = 'pointer';
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.title = 'Click to filter the whole dashboard to ' + r.name;
    row.innerHTML = '<span style="font-size:11.5px;">' + r.code + ' &middot; ' + r.name + '</span>' +
      '<span style="display:flex;align-items:center;gap:10px;"><strong>' + r.overall + '%</strong><span class="badge ' + cls + '">' + t.label + '</span></span>';
    const goToStore = () => {
      state.view = 'store';
      state.entity = r.code;
      renderTabs();
      renderEntityPicker();
      renderAll();
      window.scrollTo({top: 0, behavior: 'smooth'});
    };
    row.onclick = goToStore;
    row.onkeydown = (e) => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); goToStore(); } };
    el.appendChild(row);
  });
}

/* ---------- Chart.js value-label plugin ---------- */
const valueLabelPlugin = {
  id: 'valueLabel',
  afterDatasetsDraw(chart){
    const {ctx} = chart;
    chart.data.datasets.forEach((ds,dsIndex) => {
      const meta = chart.getDatasetMeta(dsIndex);
      meta.data.forEach((bar,i) => {
        const val = ds.data[i];
        if(val === undefined || val === null) return;
        ctx.save();
        ctx.fillStyle = '#2a1c14';
        ctx.font = '11px sans-serif';
        if(chart.options.indexAxis === 'y'){
          ctx.textAlign = 'left';
          ctx.fillText(val + '%', bar.x + 6, bar.y + 4);
        } else {
          ctx.textAlign = 'center';
          ctx.fillText(val + '%', bar.x, bar.y - 6);
        }
        ctx.restore();
      });
    });
  }
};

/* ---------- Section chart ---------- */
let secChartInstance;
function renderSectionChart(list){
  const avg = SECTION_NAMES.map(s => {
    const vals = list.map(r => r.sections[s]).filter(v => v !== undefined);
    return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : 0;
  });
  if(secChartInstance) secChartInstance.destroy();
  secChartInstance = new Chart(document.getElementById('secChart'), {
    type: 'bar',
    data: {labels: SECTION_NAMES, datasets: [{label:'Score %', data: avg, backgroundColor:'#5c1414', borderRadius:4, maxBarThickness:44}]},
    options: {
      responsive:true, maintainAspectRatio:false,
      layout:{padding:{top:18}},
      plugins:{legend:{display:false}},
      scales:{y:{min:0,max:110,ticks:{callback:v=>v+'%'}}},
      onClick:(evt,els)=>{
        if(!els.length) return;
        const sec = SECTION_NAMES[els[0].index];
        const pf = document.getElementById('passFailBox');
        const pass = list.filter(r => (r.sections[sec]||0) >= 75);
        const fail = list.filter(r => (r.sections[sec]||0) < 75);
        pf.innerHTML = '<p style="margin:4px 0;"><strong>' + sec + '</strong> &middot; reference 75%</p>' +
          '<p style="color:var(--pass);margin:2px 0;">Passed: ' + (pass.map(r=>r.name+' ('+r.sections[sec]+'%)').join(', ') || 'none') + '</p>' +
          '<p style="color:var(--fail);margin:2px 0;">Failed: ' + (fail.map(r=>r.name+' ('+r.sections[sec]+'%)').join(', ') || 'none') + '</p>';
      }
    },
    plugins:[valueLabelPlugin]
  });
  document.getElementById('passFailBox').textContent = 'Click a bar above to see which stores passed or failed that section.';
}

/* ---------- Serving time table ---------- */
function renderServing(list){
  const el = document.getElementById('servingRows');
  const table = el.closest('table');
  if(table && table.parentElement && !table.parentElement.classList.contains('scrollable-table-wrap')){
    const wrap = document.createElement('div');
    wrap.className = 'scrollable-table-wrap';
    wrap.style.cssText = 'max-height:320px;overflow-y:auto;';
    table.parentElement.insertBefore(wrap, table);
    wrap.appendChild(table);
  }
  el.innerHTML = '';
  list.forEach(r => (r.serving||[]).forEach((entry) => {
    const p = entry[0];
    const m = entry[entry.length - 1]; // minutes is always the last element, regardless of legacy format
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + r.name + '</td><td>' + p + '</td><td>' + m + ' min</td>';
    el.appendChild(tr);
  }));
  if(!el.children.length){ el.innerHTML = '<tr><td colspan="3" class="small-note">No serving-time data in this view.</td></tr>'; }
}

/* ---------- Area manager chart — always from full dataset. City/Zonal covered by the list panels above. ---------- */
let amChartInstance;
function groupAvg(groupFn){
  const g = {};
  state.reports.forEach(r => { const k = groupFn(r); (g[k]=g[k]||[]).push(r.overall); });
  const labels = Object.keys(g);
  const data = labels.map(k => Math.round(g[k].reduce((a,b)=>a+b,0)/g[k].length));
  return {labels, data};
}
function renderManagerCharts(){
  const amG = groupAvg(r=>r.am);
  if(amChartInstance) amChartInstance.destroy();
  if(amG.labels.length){
    // Give every bar enough vertical room so no label gets skipped for lack
    // of space — Chart.js's category-scale autoSkip drops labels that don't
    // fit, which is what caused missing names when there wasn't enough
    // height for all Area Managers.
    const wrap = document.getElementById('amChart').closest('.chartwrap');
    if(wrap){
      const neededHeight = Math.max(150, amG.labels.length * 34 + 30);
      wrap.style.height = neededHeight + 'px';
    }
    amChartInstance = new Chart(document.getElementById('amChart'), {
      type:'bar', data:{labels:amG.labels, datasets:[{data:amG.data, backgroundColor:'#1baf7a', borderRadius:4, maxBarThickness:26}]},
      options:{
        indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{legend:{display:false}},
        scales:{
          x:{min:0,max:110,ticks:{callback:v=>v+'%'}},
          y:{ticks:{autoSkip:false, font:{size:11}}}
        }
      },
      plugins:[valueLabelPlugin]
    });
  }
}

/* ---------- Store type chart — always from full dataset ---------- */
let typeChartInstance;
function renderTypeChart(){
  const types = [...new Set(state.reports.map(r=>r.type))];
  const colors = ['#2a78d6','#eb6834','#1baf7a','#eda100','#4a3aa7'];
  const datasets = types.map((t,i) => {
    const list = state.reports.filter(r=>r.type===t);
    const data = SECTION_NAMES.map(sec => {
      const vals = list.map(r=>r.sections[sec]).filter(v=>v!==undefined);
      return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : 0;
    });
    return {label:t, data, backgroundColor: colors[i%colors.length], borderRadius:4, maxBarThickness:22};
  });
  if(typeChartInstance) typeChartInstance.destroy();
  if(!datasets.length) return;
  typeChartInstance = new Chart(document.getElementById('typeChart'), {
    type:'bar',
    data:{labels:SECTION_NAMES, datasets},
    options:{responsive:true, maintainAspectRatio:false, layout:{padding:{top:18}}, scales:{y:{min:0,max:110,ticks:{callback:v=>v+'%'}}},
      plugins:{legend:{display:true, position:'bottom', labels:{boxWidth:10, font:{size:11}}}}},
    plugins:[valueLabelPlugin]
  });
}

/* ---------- Marks cut ---------- */
function buildCutMap(list){
  const cutMap = {};
  list.forEach(r => {
    Object.entries(r.detail||{}).forEach(([sec,qs]) => {
      qs.forEach(([label,score,max]) => {
        const key = sec + ' — ' + label;
        if(!cutMap[key]) cutMap[key] = {lost:0, instances:0, misses:0};
        cutMap[key].lost += (max-score);
        cutMap[key].instances += 1;
        if(score < max) cutMap[key].misses += 1;
      });
    });
  });
  return cutMap;
}
function renderCutList(list){
  const el = document.getElementById('cutList');
  el.innerHTML = '';
  const cutMap = buildCutMap(list);

  // If we're viewing the most recent quarter and a previous quarter exists, show vs-last-quarter deltas.
  let prevCutMap = null, prevLabel = null;
  if(state.view === 'quarter' && state.entity){
    const curInfo = allQuartersSorted().find(q => q.label === state.entity);
    const mostRecent = allQuartersSorted()[0];
    if(curInfo && mostRecent && curInfo.key === mostRecent.key){
      const prevKey = previousQuarterKey(curInfo.key);
      if(prevKey !== null){
        prevCutMap = buildCutMap(reportsForQuarterKey(prevKey));
        prevLabel = allQuartersSorted().find(q => q.key === prevKey).label;
      }
    }
  }

  const top = Object.entries(cutMap).filter(([k,v])=>v.lost>0).sort((a,b)=>b[1].lost-a[1].lost).slice(0,10);
  if(!top.length){ el.innerHTML = '<p class="small-note">No data in this view.</p>'; return cutMap; }
  if(prevCutMap){
    const note = document.createElement('p');
    note.className = 'small-note';
    note.style.marginBottom = '8px';
    note.textContent = 'Comparing ' + state.entity + ' vs previous quarter (' + prevLabel + ').';
    el.appendChild(note);
  }
  top.forEach(([k,v]) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #f1ebe3;font-size:12.5px;';
    let rightHtml = '<span style="color:var(--fail);white-space:nowrap;">missed ' + v.misses + '/' + v.instances + ' &middot; -' + v.lost + ' pts</span>';
    if(prevCutMap){
      const prev = prevCutMap[k];
      if(prev){
        const delta = v.lost - prev.lost;
        const deltaTxt = delta === 0 ? 'same as last qtr' : (delta > 0 ? '+' + delta + ' pts vs last qtr' : delta + ' pts vs last qtr');
        const deltaColor = delta > 0 ? 'var(--fail)' : (delta < 0 ? 'var(--pass)' : 'var(--ink-soft)');
        rightHtml += '<br><span style="font-size:11px;color:' + deltaColor + ';">' + deltaTxt + ' (was ' + prev.misses + '/' + prev.instances + ')</span>';
      } else {
        rightHtml += '<br><span style="font-size:11px;color:var(--gold);">new this quarter</span>';
      }
    }
    row.innerHTML = '<span>' + k + '</span><span style="text-align:right;">' + rightHtml + '</span>';
    el.appendChild(row);
  });
  return cutMap;
}

/* ---------- Comments — bold click prompt per section, nested collapsible
   City -> Zonal manager -> Area manager -> Store chips reveal full comment,
   click outside collapses ---------- */
let commentsOutsideClickBound = false;
function bindCommentsOutsideClick(){
  if(commentsOutsideClickBound) return;
  commentsOutsideClickBound = true;
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.comment-wrap').forEach(w => {
      if(w.contains(e.target)) return;
      const d = w.querySelector('.comment-detail');
      if(d){ d.style.display = 'none'; d.innerHTML = ''; }
      w.querySelectorAll('.comment-chip').forEach(c => c.style.borderColor = '');
    });
  });
}
function makeGroupToggle(label, level){
  const row = document.createElement('button');
  row.type = 'button';
  const pad = 10 + level * 14;
  const fontSize = (12.5 - level * 0.3).toFixed(1);
  row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;width:100%;text-align:left;' +
    'padding:7px ' + pad + 'px;background:' + (level === 0 ? '#fdf7ef' : '#fff') + ';border:1px solid var(--line);' +
    'border-radius:var(--radius);font-size:' + fontSize + 'px;font-weight:' + (level === 0 ? '700' : '600') + ';cursor:pointer;';
  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;
  const caret = document.createElement('span');
  caret.textContent = '▸';
  caret.style.cssText = 'transition:transform .15s;display:inline-block;';
  row.appendChild(labelSpan);
  row.appendChild(caret);
  return {row, caret};
}
function renderComments(list){
  const el = document.getElementById('commentsAcc');
  el.innerHTML = '';
  if(!list.length){ el.innerHTML = '<p class="small-note">No reports in this view.</p>'; return; }
  SECTION_NAMES.forEach(sec => {
    const wrap = document.createElement('div');
    wrap.className = 'comment-wrap';
    wrap.style.cssText = 'margin-bottom:16px;';
    const title = document.createElement('p');
    title.style.cssText = 'font-size:13.5px;font-weight:700;margin:0 0 4px;color:var(--maroon-dark);';
    title.textContent = sec;
    const prompt = document.createElement('p');
    prompt.style.cssText = 'font-size:12.5px;font-weight:700;color:var(--ink);margin:0 0 8px;';
    prompt.textContent = 'Click a city, then zonal manager, then area manager to find a store';
    const detail = document.createElement('div');
    detail.className = 'comment-detail';
    detail.style.cssText = 'font-size:12.5px;color:var(--ink-soft);background:#fdf7ef;border-radius:var(--radius);padding:10px 12px;display:none;margin-top:8px;';

    // Build City -> Zonal manager -> Area manager -> [reports] hierarchy,
    // using the same master-data fields as everywhere else in the dashboard.
    const relevant = list.filter(r => r.comments && r.comments[sec]);
    const tree = {};
    relevant.forEach(r => {
      const city = r.region || 'Unassigned';
      const zonal = r.rm || 'Unassigned';
      const area = r.am || 'Unassigned';
      tree[city] = tree[city] || {};
      tree[city][zonal] = tree[city][zonal] || {};
      tree[city][zonal][area] = tree[city][zonal][area] || [];
      tree[city][zonal][area].push(r);
    });

    const groupsEl = document.createElement('div');
    groupsEl.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
    let openCity = null;

    if(!Object.keys(tree).length){
      const none = document.createElement('p');
      none.className = 'small-note';
      none.textContent = 'No comments in this view.';
      groupsEl.appendChild(none);
    }

    Object.keys(tree).sort().forEach(city => {
      const cityBox = document.createElement('div');
      const {row: cityRow, caret: cityCaret} = makeGroupToggle(city, 0);
      const cityBody = document.createElement('div');
      cityBody.style.cssText = 'display:none;margin-top:5px;padding-left:8px;flex-direction:column;gap:5px;';
      let openZonal = null;
      cityRow.onclick = (e) => {
        e.stopPropagation();
        detail.style.display = 'none';
        detail.innerHTML = '';
        detail.dataset.activeStore = '';
        groupsEl.querySelectorAll('.comment-chip').forEach(c => c.style.borderColor = '');
        const opening = cityBody.style.display === 'none';
        if(openCity && openCity.body !== cityBody){
          openCity.body.style.display = 'none';
          openCity.caret.style.transform = 'rotate(0deg)';
        }
        cityBody.style.display = opening ? 'flex' : 'none';
        cityCaret.style.transform = opening ? 'rotate(90deg)' : 'rotate(0deg)';
        openCity = opening ? {body: cityBody, caret: cityCaret} : null;
      };

      Object.keys(tree[city]).sort().forEach(zonal => {
        const zonalBox = document.createElement('div');
        const {row: zonalRow, caret: zonalCaret} = makeGroupToggle(zonal, 1);
        const zonalBody = document.createElement('div');
        zonalBody.style.cssText = 'display:none;margin-top:5px;padding-left:8px;flex-direction:column;gap:5px;';
        let openArea = null;
        zonalRow.onclick = (e) => {
          e.stopPropagation();
          detail.style.display = 'none';
          detail.innerHTML = '';
          detail.dataset.activeStore = '';
          groupsEl.querySelectorAll('.comment-chip').forEach(c => c.style.borderColor = '');
          const opening = zonalBody.style.display === 'none';
          if(openZonal && openZonal.body !== zonalBody){
            openZonal.body.style.display = 'none';
            openZonal.caret.style.transform = 'rotate(0deg)';
          }
          zonalBody.style.display = opening ? 'flex' : 'none';
          zonalCaret.style.transform = opening ? 'rotate(90deg)' : 'rotate(0deg)';
          openZonal = opening ? {body: zonalBody, caret: zonalCaret} : null;
        };

        Object.keys(tree[city][zonal]).sort().forEach(area => {
          const areaBox = document.createElement('div');
          const {row: areaRow, caret: areaCaret} = makeGroupToggle(area, 2);
          const areaBody = document.createElement('div');
          areaBody.style.cssText = 'display:none;margin-top:5px;padding-left:8px;flex-wrap:wrap;gap:8px;';
          areaRow.onclick = (e) => {
            e.stopPropagation();
            detail.style.display = 'none';
            detail.innerHTML = '';
            detail.dataset.activeStore = '';
            groupsEl.querySelectorAll('.comment-chip').forEach(c => c.style.borderColor = '');
            const opening = areaBody.style.display === 'none';
            if(openArea && openArea.body !== areaBody){
              openArea.body.style.display = 'none';
              openArea.caret.style.transform = 'rotate(0deg)';
            }
            areaBody.style.display = opening ? 'flex' : 'none';
            areaCaret.style.transform = opening ? 'rotate(90deg)' : 'rotate(0deg)';
            openArea = opening ? {body: areaBody, caret: areaCaret} : null;
          };

          tree[city][zonal][area].forEach(r => {
            const chip = document.createElement('button');
            chip.className = 'comment-chip';
            chip.textContent = r.name;
            chip.onclick = (e) => {
              e.stopPropagation();
              const alreadyOpenForThis = detail.style.display === 'block' && detail.dataset.activeStore === r.name;
              groupsEl.querySelectorAll('.comment-chip').forEach(c => c.style.borderColor = '');
              if(alreadyOpenForThis){
                detail.style.display = 'none';
                detail.innerHTML = '';
                detail.dataset.activeStore = '';
                return;
              }
              chip.style.borderColor = 'var(--gold)';
              detail.style.display = 'block';
              detail.dataset.activeStore = r.name;
              detail.innerHTML = '<strong style="color:var(--ink);">' + r.name + ':</strong> ' + r.comments[sec];
            };
            areaBody.appendChild(chip);
          });

          areaBox.appendChild(areaRow);
          areaBox.appendChild(areaBody);
          zonalBody.appendChild(areaBox);
        });

        zonalBox.appendChild(zonalRow);
        zonalBox.appendChild(zonalBody);
        cityBody.appendChild(zonalBox);
      });

      cityBox.appendChild(cityRow);
      cityBox.appendChild(cityBody);
      groupsEl.appendChild(cityBox);
    });

    wrap.appendChild(title);
    wrap.appendChild(prompt);
    wrap.appendChild(groupsEl);
    wrap.appendChild(detail);
    el.appendChild(wrap);
  });
  bindCommentsOutsideClick();
}

/* ---------- Word cloud ---------- */
const STOPWORDS = new Set(['the','a','an','and','or','but','was','were','is','are','be','been','being','to','of','in','on','at','for','with','staff','store','outlet','restaurant','visit','during','we','our','us','they','their','it','its','this','that','also','had','has','have','did','do','does','as','so','not','no','table','food','item','items','order','ordered']);
const NEGATIVE_PHRASES = [
  [/no (\w+ )?greet\w*/gi, 'no greeting'],
  [/not (well[- ])?maintained/gi, 'not maintained'],
  [/not updated/gi, 'not updated'],
  [/no (pre[- ]?placed )?water bottle/gi, 'no water bottle'],
  [/did not introduce|no.{0,15}introduc\w*/gi, 'no introduction'],
  [/no loyalty pass/gi, 'no loyalty pass'],
  [/not (proactively )?announc\w*/gi, 'not announced'],
  [/sour/gi, 'sour taste'],
  [/damaged|broken/gi, 'damaged fixture'],
  [/unprofessional/gi, 'unprofessional'],
  [/stain\w*/gi, 'stains'],
  [/no.{0,20}feedback/gi, 'no feedback request'],
  [/incorrect.{0,15}(change|amount|bill)/gi, 'billing error'],
  [/on request only|only.{0,10}request/gi, 'service only on request'],
  [/wet floor/gi, 'wet floor'],
  [/not (clearly )?repeat\w*|not reconfirm\w*/gi, 'order not repeated']
];
const POSITIVE_PHRASES = [
  [/well[- ]groomed/gi, 'well-groomed'],
  [/well[- ]maintained/gi, 'well-maintained'],
  [/clean\w*/gi, 'clean'],
  [/attentive/gi, 'attentive'],
  [/courteous/gi, 'courteous'],
  [/professional/gi, 'professional'],
  [/tasty|flavorful|rich in taste/gi, 'tasty'],
  [/satisf\w+/gi, 'satisfactory'],
  [/comfortable/gi, 'comfortable'],
  [/hygienic/gi, 'hygienic'],
  [/prompt\w*/gi, 'prompt'],
  [/welcom\w*/gi, 'welcoming'],
  [/responsive/gi, 'responsive'],
  [/well[- ]lit/gi, 'well-lit'],
  [/proactiv\w*/gi, 'proactive service']
];
function buildCloud(list){
  const allText = [];
  list.forEach(r => Object.values(r.comments||{}).forEach(t => allText.push(t)));
  const combined = allText.join(' . ');
  const posCounts = {}, negCounts = {};
  NEGATIVE_PHRASES.forEach(([re,label]) => { const m = combined.match(re); if(m) negCounts[label] = (negCounts[label]||0) + m.length; });
  POSITIVE_PHRASES.forEach(([re,label]) => { const m = combined.match(re); if(m) posCounts[label] = (posCounts[label]||0) + m.length; });
  const words = combined.toLowerCase().replace(/[^a-z\s'-]/g,' ').split(/\s+/).filter(w => w.length>3 && !STOPWORDS.has(w));
  const freq = {};
  words.forEach(w => freq[w] = (freq[w]||0)+1);
  return {pos: posCounts, neg: negCounts, freq};
}
function renderCloud(el, counts){
  el.innerHTML = '';
  const entries = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,14);
  if(!entries.length){ el.innerHTML = '<span class="small-note">Not enough comment data yet.</span>'; return; }
  const max = Math.max(...entries.map(e=>e[1]));
  entries.forEach(([w,c]) => {
    const size = 12 + (c/max)*13;
    const span = document.createElement('span');
    span.style.fontSize = size + 'px';
    span.style.fontWeight = size > 20 ? '700' : '500';
    span.textContent = w;
    el.appendChild(span);
  });
}

/* ---------- AI recommendations ---------- */
const REC_LIBRARY = [
  {match:'Order Taking — Staff introduced self', priority:'High', section:'Order Taking',
   title:'Introduce a standard greeting & introduction script',
   action:'Train front-of-house to greet within 30 seconds of arrival and have serving staff introduce themselves by name when taking the order.'},
  {match:'Order Taking — Suggestive selling done', priority:'High', section:'Order Taking',
   title:'Build suggestive selling & loyalty pass into the order flow',
   action:'Add a scripted prompt staff must use at order-taking: recommend one add-on item and mention the loyalty pass, every visit.'},
  {match:'Billing — Contact details taken', priority:'High', section:'Billing',
   title:'Capture contact details and request feedback at billing',
   action:'Make contact capture and a feedback link mandatory steps in the billing SOP, not optional.'},
  {match:'Ambience — Restroom maintained', priority:'Medium', section:'Ambience',
   title:'Fix restroom maintenance and enforce cleaning chart logging',
   action:'Raise maintenance tickets for flagged stores immediately; make cleaning-chart sign-off a shift-close checklist item, spot-checked by the AM.'},
  {match:'Order Taking — Dish announced before serving', priority:'Medium', section:'Order Taking',
   title:'Announce dishes before placing on the table',
   action:'Reinforce in server training: name the dish out loud when placing it, a standard hospitality cue.'},
  {match:'Order Taking — Finger bowl w/ lemon', priority:'Medium', section:'Order Taking',
   title:'Offer the finger bowl proactively, not on request',
   action:'Add finger bowl service as an automatic post-meal step, no guest prompt needed.'}
];
function renderRecommendations(list, cutMap){
  const el = document.getElementById('recList');
  el.innerHTML = '';
  if(!list.length || !cutMap){ el.innerHTML = '<p class="small-note">No data in this view yet.</p>'; return; }

  let prevCutMap = null, prevLabel = null;
  if(state.view === 'quarter' && state.entity){
    const curInfo = allQuartersSorted().find(q => q.label === state.entity);
    const mostRecent = allQuartersSorted()[0];
    if(curInfo && mostRecent && curInfo.key === mostRecent.key){
      const prevKey = previousQuarterKey(curInfo.key);
      if(prevKey !== null){
        prevCutMap = buildCutMap(reportsForQuarterKey(prevKey));
        prevLabel = allQuartersSorted().find(q => q.key === prevKey).label;
      }
    }
  }

  const applicable = REC_LIBRARY.filter(r => cutMap[r.match] && cutMap[r.match].misses > 0);
  const recScores = list.map(r => (r.detail && r.detail['Recommendation'] && r.detail['Recommendation'][1]) ? r.detail['Recommendation'][1][1] : null).filter(v=>v!==null);
  const extras = [];
  if(recScores.length && recScores.every(v => v <= 7)){
    extras.push({priority:'Low', section:'Recommendation', title:'Investigate the recommendation-score ceiling',
      action:'Likelihood-to-recommend is capped at 7/10 across every visited store despite decent F&B scores — suggests service-experience gaps, not food, are the limiting factor. Re-audit after fixing the items above to see if it moves.'});
  }
  const finalList = [...applicable.map(r => {
      const cur = cutMap[r.match];
      let evidence = 'Missed in ' + cur.misses + '/' + cur.instances + ' visits in this view.';
      if(prevCutMap){
        const prev = prevCutMap[r.match];
        if(prev){
          const delta = cur.lost - prev.lost;
          const trend = delta > 0 ? 'got worse' : (delta < 0 ? 'improved' : 'unchanged');
          evidence += ' Vs ' + prevLabel + ': was ' + prev.misses + '/' + prev.instances + ' — ' + trend + ' this quarter.';
        } else {
          evidence += ' This is a new issue this quarter — not present in ' + prevLabel + '.';
        }
      }
      return {priority:r.priority, section:r.section, title:r.title, action:r.action, evidence};
    }),
    ...extras];
  if(!finalList.length){ el.innerHTML = '<p class="small-note">No systemic issues detected in this view — scores look consistent.</p>'; return; }
  finalList.forEach(r => {
    const card = document.createElement('div');
    card.className = 'rec-card';
    card.innerHTML =
      '<div class="rec-top"><p class="title">' + r.title + '</p>' +
      '<div style="display:flex;gap:6px;flex-shrink:0;"><span class="tag ' + r.priority + '">' + r.priority + '</span><span class="tag section">' + r.section + '</span></div></div>' +
      (r.evidence ? '<p><strong>Evidence: </strong>' + r.evidence + '</p>' : '') +
      '<p><strong>Action: </strong>' + r.action + '</p>';
    el.appendChild(card);
  });
}

/* ---------- Store detail: two-level drill down. Play -> section list -> click section -> questions ---------- */
/* ---------- Per-store downloadable report (PDF / Excel) — generated from the
   dashboard's own computed data, not the original uploaded PDF. ---------- */
function generateStorePdf(r){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const marginX = 14;
  let y = 18;

  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text('Mystery Audit Report', marginX, y);
  y += 8;
  doc.setFontSize(11);
  doc.setFont(undefined, 'normal');
  doc.text(r.code + ' \u2014 ' + r.name, marginX, y);
  y += 6;
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text('Month: ' + (r.month || '-') + '   AM: ' + (r.am || '-') + '   RM: ' + (r.rm || '-') + '   Region: ' + (r.region || '-') + '   Type: ' + (r.type || '-'), marginX, y);
  y += 8;
  doc.setTextColor(0);
  doc.setFontSize(13);
  doc.setFont(undefined, 'bold');
  doc.text('Overall score: ' + r.overall + '%', marginX, y);
  y += 4;

  const sectionRows = Object.entries(r.sections).map(([sec, score]) => [sec, score + '%']);
  doc.autoTable({
    startY: y + 4,
    head: [['Section', 'Score']],
    body: sectionRows,
    theme: 'grid',
    headStyles: { fillColor: [92, 20, 20] },
    styles: { fontSize: 9 },
    margin: { left: marginX, right: marginX },
  });
  y = doc.lastAutoTable.finalY + 8;

  SECTION_NAMES.forEach(sec => {
    const rows = (r.detail && r.detail[sec]) || [];
    if(!rows.length) return;
    if(y > 260){ doc.addPage(); y = 18; }
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text(sec + ' \u2014 ' + (r.sections[sec] !== undefined ? r.sections[sec] + '%' : ''), marginX, y);
    doc.autoTable({
      startY: y + 3,
      head: [['Question', 'Score']],
      body: rows.map(([label, sc, max]) => [label, sc + '/' + max]),
      theme: 'striped',
      headStyles: { fillColor: [217, 122, 43] },
      styles: { fontSize: 8.5 },
      margin: { left: marginX, right: marginX },
    });
    y = doc.lastAutoTable.finalY + 6;

    const comment = r.comments && r.comments[sec];
    if(comment){
      if(y > 255){ doc.addPage(); y = 18; }
      doc.setFontSize(9);
      doc.setFont(undefined, 'italic');
      const wrapped = doc.splitTextToSize(comment, 180);
      doc.text(wrapped, marginX, y);
      y += wrapped.length * 4.2 + 6;
      doc.setFont(undefined, 'normal');
    }
  });

  if((r.serving || []).length){
    if(y > 250){ doc.addPage(); y = 18; }
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Food serving time', marginX, y);
    doc.autoTable({
      startY: y + 3,
      head: [['Product', 'Time taken to serve']],
      body: r.serving.map(([product, mins]) => [product, mins + ' min']),
      theme: 'grid',
      headStyles: { fillColor: [92, 20, 20] },
      styles: { fontSize: 9 },
      margin: { left: marginX, right: marginX },
    });
  }

  doc.setFontSize(8);
  doc.setTextColor(140);
  doc.text('Generated from Paradise Mystery Audit Dashboard on ' + new Date().toLocaleDateString('en-IN'), marginX, 290);

  doc.save(r.code + '_' + r.name.replace(/\s+/g, '_') + '_audit_report.pdf');
}

function generateStoreExcel(r){
  const wb = XLSX.utils.book_new();

  const overviewData = [
    ['Store code', r.code],
    ['Store name', r.name],
    ['Month', r.month || ''],
    ['Area manager', r.am || ''],
    ['Zonal manager', r.rm || ''],
    ['Region', r.region || ''],
    ['Type', r.type || ''],
    ['Overall score', r.overall + '%'],
    [],
    ['Section', 'Score'],
    ...Object.entries(r.sections).map(([sec, score]) => [sec, score + '%']),
  ];
  const overviewSheet = XLSX.utils.aoa_to_sheet(overviewData);
  XLSX.utils.book_append_sheet(wb, overviewSheet, 'Overview');

  const detailData = [['Section', 'Question', 'Earned', 'Possible']];
  SECTION_NAMES.forEach(sec => {
    (r.detail && r.detail[sec] || []).forEach(([label, sc, max]) => {
      detailData.push([sec, label, sc, max]);
    });
  });
  const detailSheet = XLSX.utils.aoa_to_sheet(detailData);
  XLSX.utils.book_append_sheet(wb, detailSheet, 'Question Detail');

  const commentsData = [['Section', 'Comment']];
  SECTION_NAMES.forEach(sec => {
    const c = r.comments && r.comments[sec];
    if(c) commentsData.push([sec, c]);
  });
  const commentsSheet = XLSX.utils.aoa_to_sheet(commentsData);
  XLSX.utils.book_append_sheet(wb, commentsSheet, 'Comments');

  if((r.serving || []).length){
    const servingData = [['Product', 'Time taken to serve (min)'], ...r.serving.map(([p, m]) => [p, m])];
    const servingSheet = XLSX.utils.aoa_to_sheet(servingData);
    XLSX.utils.book_append_sheet(wb, servingSheet, 'Serving Time');
  }

  XLSX.writeFile(wb, r.code + '_' + r.name.replace(/\s+/g, '_') + '_audit_report.xlsx');
}

function renderStoreAccordion(list){
  const el = document.getElementById('storeAccordion');
  el.innerHTML = '';
  if(!list.length){ el.innerHTML = '<p class="small-note">No reports in this view.</p>'; return; }
  list.forEach(r => {
    const card = document.createElement('div');
    card.className = 'acc-card';

    const head = document.createElement('div');
    head.className = 'acc-head';
    head.innerHTML = '<span>' + r.code + ' &middot; ' + r.name + ' <span class="small-note">(' + r.am + ' / ' + r.rm + ')</span></span>' +
      '<span style="display:flex;align-items:center;gap:10px;"><span>' + r.overall + '%</span></span>';

    const sectionLevel = document.createElement('div');
    sectionLevel.style.cssText = 'display:none;padding:10px 14px;';
    const questionLevel = document.createElement('div');
    questionLevel.style.cssText = 'display:none;padding:0 14px 12px;';

    Object.entries(r.sections).forEach(([secName, score]) => {
      const row = document.createElement('button');
      row.style.cssText = 'width:100%;display:flex;justify-content:space-between;align-items:center;padding:8px 10px;margin-bottom:5px;background:#fdf7ef;border:1px solid var(--line);border-radius:var(--radius);font-size:12.5px;text-align:left;';
      row.innerHTML = '<span>' + secName + '</span><span><strong>' + score + '%</strong> &rsaquo;</span>';
      row.onclick = () => {
        sectionLevel.style.display = 'none';
        questionLevel.style.display = 'block';
        questionLevel.innerHTML = '';
        const backBtn = document.createElement('button');
        backBtn.textContent = '← Back to sections';
        backBtn.style.cssText = 'font-size:12px;margin-bottom:8px;';
        backBtn.onclick = () => { questionLevel.style.display = 'none'; sectionLevel.style.display = 'block'; };
        questionLevel.appendChild(backBtn);
        const title = document.createElement('p');
        title.style.cssText = 'font-size:13px;font-weight:700;margin:0 0 6px;color:var(--maroon-dark);';
        title.textContent = secName + ' — ' + score + '%';
        questionLevel.appendChild(title);
        (r.detail[secName] || []).forEach(([label,sc,max]) => {
          const qrow = document.createElement('div');
          qrow.style.cssText = 'display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0;color:' + (sc<max ? 'var(--fail)' : 'var(--ink-soft)') + ';';
          qrow.innerHTML = '<span>' + label + '</span><span>' + sc + '/' + max + '</span>';
          questionLevel.appendChild(qrow);
        });
      };
      sectionLevel.appendChild(row);
    });

    const playBtn = document.createElement('button');
    playBtn.className = 'playbtn';
    playBtn.setAttribute('aria-label','Show section breakdown');
    playBtn.textContent = '▶';
    playBtn.onclick = (e) => {
      e.stopPropagation();
      const opening = sectionLevel.style.display === 'none' && questionLevel.style.display === 'none';
      if(opening){
        sectionLevel.style.display = 'block';
        playBtn.textContent = '❚❚';
      } else {
        sectionLevel.style.display = 'none';
        questionLevel.style.display = 'none';
        playBtn.textContent = '▶';
      }
    };
    head.querySelector('span:last-child').appendChild(playBtn);
    card.appendChild(head);
    card.appendChild(sectionLevel);
    card.appendChild(questionLevel);
    el.appendChild(card);
  });
}

/* ---------- City-wise / Zonal manager-wise score lists (no charts, always from full dataset) ---------- */
function renderCityAndZonalScores(){
  function avgByKey(keyFn){
    const g = {};
    state.reports.forEach(r => { const k = keyFn(r); (g[k]=g[k]||[]).push(r.overall); });
    return Object.entries(g).map(([k,vals]) => [k, Math.round(vals.reduce((a,b)=>a+b,0)/vals.length)])
      .sort((a,b) => b[1]-a[1]);
  }
  function renderClickableList(elId, entries, emptyMsg, targetView){
    const el = document.getElementById(elId);
    el.innerHTML = '';
    if(!entries.length){ el.innerHTML = '<p class="small-note">' + emptyMsg + '</p>'; return; }
    entries.forEach(([label, val]) => {
      const row = document.createElement('div');
      row.className = 'report-row';
      row.style.cursor = 'pointer';
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.title = 'Click to filter the whole dashboard to ' + label;
      row.innerHTML = '<span>' + label + '</span><strong>' + val + '%</strong>';
      const goToEntity = () => {
        state.view = targetView;
        state.entity = label;
        renderTabs();
        renderEntityPicker();
        renderAll();
        window.scrollTo({top: 0, behavior: 'smooth'});
      };
      row.onclick = goToEntity;
      row.onkeydown = (e) => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); goToEntity(); } };
      el.appendChild(row);
    });
  }
  renderClickableList('cityScoreList', avgByKey(r => r.region), 'No reports yet.', 'region');
  renderClickableList('zonalScoreList', avgByKey(r => r.rm), 'No reports yet.', 'rm');
}

/* ---------- Revenue risk alert: contact details NOT taken AND bill/receipt NOT issued ---------- */
function renderRevenueRisk(list){
  const el = document.getElementById('revenueRiskList');
  const panel = document.getElementById('revenueRiskPanel');
  el.innerHTML = '';
  const flagged = list.filter(r => {
    const billing = (r.detail && r.detail['Billing']) || [];
    const contact = billing.find(q => q[0] === 'Contact details taken');
    const billIssued = billing.find(q => q[0] === 'Bill/receipt issued');
    return contact && contact[1] === 0 && billIssued && billIssued[1] === 0;
  });
  if(!flagged.length){
    panel.style.borderColor = 'var(--line)';
    el.innerHTML = '<p class="small-note" style="color:var(--pass);">No stores in this view currently trigger a revenue risk alert.</p>';
    return;
  }
  panel.style.borderColor = 'var(--fail)';
  flagged.forEach(r => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'background:#fcebeb;border-radius:var(--radius);margin-bottom:6px;overflow:hidden;';

    const row = document.createElement('button');
    row.type = 'button';
    row.style.cssText = 'width:100%;display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:none;border:none;font-size:13px;text-align:left;cursor:pointer;';
    const hasComment = r.comments && r.comments['Billing'];
    row.innerHTML = '<span><strong>' + r.code + ' &middot; ' + r.name + '</strong> — contact details not taken, bill/receipt not issued' +
      (hasComment ? ' <span style="color:var(--fail);font-size:11px;">(view comment \u25b8)</span>' : '') + '</span>' +
      '<span style="color:var(--fail);font-weight:700;flex-shrink:0;margin-left:10px;">' + r.overall + '%</span>';

    const detail = document.createElement('div');
    detail.style.cssText = 'display:none;padding:0 12px 10px;font-size:12.5px;color:var(--ink-soft);';
    if(hasComment) detail.textContent = r.comments['Billing'];

    if(hasComment){
      row.onclick = () => {
        const opening = detail.style.display === 'none';
        detail.style.display = opening ? 'block' : 'none';
        const caret = row.querySelector('span span');
        if(caret) caret.textContent = opening ? '(view comment \u25be)' : '(view comment \u25b8)';
      };
    }

    wrap.appendChild(row);
    wrap.appendChild(detail);
    el.appendChild(wrap);
  });
}

/* ---------- Quarter-over-quarter overall comparison panel ---------- */
function renderQuarterComparison(){
  const panel = document.getElementById('quarterComparePanel');
  const title = document.getElementById('quarterCompareTitle');
  const body = document.getElementById('quarterCompareBody');
  if(state.view !== 'quarter' || !state.entity){ panel.style.display = 'none'; return; }
  const quarters = allQuartersSorted();
  const curInfo = quarters.find(q => q.label === state.entity);
  const mostRecent = quarters[0];
  if(!curInfo || !mostRecent || curInfo.key !== mostRecent.key){ panel.style.display = 'none'; return; }
  const prevKey = previousQuarterKey(curInfo.key);
  if(prevKey === null){ panel.style.display = 'none'; return; }
  const prevLabel = quarters.find(q => q.key === prevKey).label;
  const curList = reportsForQuarterKey(curInfo.key);
  const prevList = reportsForQuarterKey(prevKey);
  if(!curList.length || !prevList.length){ panel.style.display = 'none'; return; }

  const curAvg = Math.round(curList.reduce((a,r)=>a+r.overall,0)/curList.length);
  const prevAvg = Math.round(prevList.reduce((a,r)=>a+r.overall,0)/prevList.length);
  const delta = curAvg - prevAvg;
  const deltaColor = delta > 0 ? 'var(--pass)' : (delta < 0 ? 'var(--fail)' : 'var(--ink-soft)');
  const deltaArrow = delta > 0 ? '▲' : (delta < 0 ? '▼' : '—');

  title.textContent = 'Quarter comparison — ' + state.entity + ' vs ' + prevLabel;
  body.innerHTML = '';

  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:1fr auto 1fr;gap:14px;align-items:center;margin-bottom:14px;';
  row.innerHTML =
    '<div style="background:#fdf7ef;border:1px solid var(--line);border-radius:10px;padding:14px;">' +
      '<p class="small-note" style="margin:0 0 6px;">' + state.entity + '</p>' +
      '<p style="font-size:26px;font-weight:700;margin:0;color:var(--maroon-dark);">' + curAvg + '%</p>' +
    '</div>' +
    '<div style="text-align:center;"><span style="font-size:20px;color:' + deltaColor + ';">' + deltaArrow + '</span>' +
      '<p style="font-size:12.5px;font-weight:700;color:' + deltaColor + ';margin:2px 0 0;">' + (delta>0?'+':'') + delta + ' pts</p></div>' +
    '<div style="background:#fdf7ef;border:1px solid var(--line);border-radius:10px;padding:14px;">' +
      '<p class="small-note" style="margin:0 0 6px;">' + prevLabel + '</p>' +
      '<p style="font-size:26px;font-weight:700;margin:0;color:var(--maroon-dark);">' + prevAvg + '%</p>' +
    '</div>';
  body.appendChild(row);

  const secNote = document.createElement('p');
  secNote.className = 'small-note';
  secNote.style.marginBottom = '6px';
  secNote.textContent = 'Section-level movement, ' + state.entity + ' vs ' + prevLabel;
  body.appendChild(secNote);

  SECTION_NAMES.forEach(sec => {
    const curVals = curList.map(r=>r.sections[sec]).filter(v=>v!==undefined);
    const prevVals = prevList.map(r=>r.sections[sec]).filter(v=>v!==undefined);
    if(!curVals.length || !prevVals.length) return;
    const curSecAvg = Math.round(curVals.reduce((a,b)=>a+b,0)/curVals.length);
    const prevSecAvg = Math.round(prevVals.reduce((a,b)=>a+b,0)/prevVals.length);
    const secDelta = curSecAvg - prevSecAvg;
    const secColor = secDelta > 0 ? 'var(--pass)' : (secDelta < 0 ? 'var(--fail)' : 'var(--ink-soft)');
    const secArrow = secDelta > 0 ? '▲' : (secDelta < 0 ? '▼' : '—');
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;justify-content:space-between;padding:6px 10px;background:#fdf7ef;border-radius:var(--radius);font-size:12.5px;margin-bottom:4px;';
    r.innerHTML = '<span>' + sec + '</span><span>' + prevSecAvg + '% → ' + curSecAvg + '% <span style="color:' + secColor + ';">' + secArrow + Math.abs(secDelta) + '</span></span>';
    body.appendChild(r);
  });

  panel.style.display = '';
}

/* ---------- Wire up clickable metric cards (Pass/Review/Critical/Total) ---------- */
function goToClassFilter(cls){
  state.view = 'class';
  state.entity = cls;
  renderTabs();
  renderEntityPicker();
  renderAll();
  window.scrollTo({top: 0, behavior: 'smooth'});
}
(function initMetricCardClicks(){
  const passCard = document.getElementById('metricPassCard');
  const reviewCard = document.getElementById('metricReviewCard');
  const critCard = document.getElementById('metricCritCard');
  const totalCard = document.getElementById('metricTotalCard');
  [passCard, reviewCard, critCard, totalCard].forEach(c => c.classList.add('clickable'));
  passCard.onclick = () => goToClassFilter('pass');
  reviewCard.onclick = () => goToClassFilter('review');
  critCard.onclick = () => goToClassFilter('critical');
  totalCard.onclick = () => { state.view = 'central'; state.entity = null; renderTabs(); renderEntityPicker(); renderAll(); window.scrollTo({top:0,behavior:'smooth'}); };
  [passCard, reviewCard, critCard, totalCard].forEach(c => {
    c.setAttribute('role','button'); c.setAttribute('tabindex','0');
    c.addEventListener('keydown', (e) => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); c.click(); } });
  });
})();

/* ---------- Master render ---------- */
/* ---------- Download store report panel (dropdown respects the current view/filter) ---------- */
function renderDownloadPanel(list){
  const sel = document.getElementById('downloadStorePick');
  if(!sel) return;
  const prevValue = sel.value;
  sel.innerHTML = '';
  if(!list.length){
    const opt = document.createElement('option');
    opt.textContent = 'No stores in this view';
    opt.disabled = true;
    sel.appendChild(opt);
    return;
  }
  list.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.code;
    opt.textContent = r.code + ' \u00b7 ' + r.name;
    sel.appendChild(opt);
  });
  if(list.some(r => r.code === prevValue)) sel.value = prevValue;

  const pdfBtn = document.getElementById('downloadPdfBtn');
  const xlsBtn = document.getElementById('downloadXlsBtn');
  pdfBtn.onclick = () => {
    const r = list.find(x => x.code === sel.value);
    if(r) generateStorePdf(r);
  };
  xlsBtn.onclick = () => {
    const r = list.find(x => x.code === sel.value);
    if(r) generateStoreExcel(r);
  };
}

function renderAll(){
  const list = filteredReports();
  renderHero(list);
  renderStoreBadges(list);
  renderCityAndZonalScores();
  renderRevenueRisk(list);
  renderQuarterComparison();
  renderSectionChart(list);
  renderServing(list);
  renderManagerCharts();
  renderTypeChart();
  const cutMap = renderCutList(list);
  renderComments(list);
  renderDownloadPanel(list);
  const cloud = buildCloud(list);
  renderCloud(document.getElementById('posCloud'), Object.keys(cloud.pos).length ? cloud.pos : cloud.freq);
  renderCloud(document.getElementById('negCloud'), Object.keys(cloud.neg).length ? cloud.neg : {});
  renderRecommendations(list, cutMap);
  renderStoreAccordion(list);
}

/* ---------- Wire up buttons ---------- */
document.getElementById('applyThBtn').addEventListener('click', () => {
  state.thresholds.pass = Number(document.getElementById('thPass').value) || 80;
  state.thresholds.review = Number(document.getElementById('thReview').value) || 70;
  renderAll();
  saveLocal(false);
  flashStatus('Thresholds applied: Pass >' + state.thresholds.pass + '%, Review ' + state.thresholds.review + '-' + state.thresholds.pass + '%, Critical below.', false);
});

/* ---------- Compact "email summary" mode: add ?emailmode=1 to the URL to show only
   the key panels (Overall score, Revenue risk, Marks cut, AI recommendations) — used
   by the daily screenshot robot so the emailed image isn't the whole long dashboard. ---------- */
(function applyEmailModeIfRequested(){
  const params = new URLSearchParams(window.location.search);
  if(params.get('emailmode') === '1'){
    document.body.classList.add('email-mode');
  }
})();

/* ---------- Init ---------- */
// Deferred until the first successful sign-in (see the onAuthStateChanged
// handler above) rather than run unconditionally on page load — running it
// while #appContent is still hidden behind the auth gate would create the
// Chart.js canvases at 0x0 size, and they don't auto-fix themselves once
// the container becomes visible later.
async function initDashboard(){
  await loadLocal();
  document.getElementById('thPass').value = state.thresholds.pass;
  document.getElementById('thReview').value = state.thresholds.review;
  renderTabs();
  renderEntityPicker();
  applyViewFromUrlIfRequested();
  renderAll();
}

/* ---------- Deep-link a specific filtered view via URL params, e.g.
   "?view=store&entity=S1153" — used by the daily screenshot robot to
   capture one store's filtered view for the "new/updated store" emails,
   without needing to click through the UI. ---------- */
function applyViewFromUrlIfRequested(){
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  const entity = params.get('entity');
  if(!view) return;
  const validViews = TAB_DEFS.map(([key]) => key);
  if(!validViews.includes(view)) return;
  state.view = view;
  state.entity = (view === 'central') ? null : entity;
  renderTabs();
  renderEntityPicker();
}
