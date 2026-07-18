// Semester — college assignment tracker (Tauri, vanilla JS)

const DIFF = ['#34c759', '#8bd34a', '#ffcc00', '#ff9f0a', '#ff3b30'];
const TYPES = ['task', 'homework', 'quiz', 'exam', 'project', 'reading'];
const STORE_KEY = 'semester-app-v1';

// personal to-dos live outside real courses but flow through the same pipeline
const TODO_COURSE = { id: 'todo', name: 'To-Do', code: '', color: '#ff2d55' };

function startOfToday() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
let TODAY = startOfToday();

// ---------- state ----------
let state = {
  theme: 'light',
  view: 'month',
  year: TODAY.getFullYear(),
  month: TODAY.getMonth(),
  weekOffset: 0,
  hidden: {},
  editA: null,
  copied: false,
  importError: '',
  review: null,
  showAdd: false,
  detailId: null,
  newA: null,
  gradeCourse: null,
  grades: {},
  courses: [],
  assignments: [],
  notified: {},
  courseEdit: null,
  courseJson: '',
  courseJsonError: '',
  courseJsonSaved: false,
  confirmDeleteCourse: false,
  term: null,            // { label, end } — user override for the guessed term
  agendaFilter: 'all',
  quickAdd: null,        // { text } while the ⌘K quick-add overlay is open
  confirmNewTerm: false,
  dataError: '',
  dayPopover: null,      // 'YYYY-MM-DD' while a month day's full list is open
};

// occurrence id that just got completed — its reborn element pops in on the next render
let completedPopId = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      for (const k of ['theme', 'courses', 'assignments', 'grades', 'hidden', 'gradeCourse', 'notified', 'term']) {
        if (d[k] !== undefined) state[k] = d[k];
      }
    }
  } catch (e) { /* corrupt store — start fresh */ }
  if (!state.courses.length) state.view = 'import';
  // prune notification records older than a few days
  const cutoff = new Date(TODAY); cutoff.setDate(TODAY.getDate() - 4);
  const cutStr = fmt(cutoff);
  for (const k of Object.keys(state.notified)) {
    const d = (k.split('|')[1] || '').slice(0, 10);
    if (d && d < cutStr) delete state.notified[k];
  }
}

function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      theme: state.theme,
      courses: state.courses,
      assignments: state.assignments,
      grades: state.grades,
      hidden: state.hidden,
      gradeCourse: state.gradeCourse,
      notified: state.notified,
      term: state.term,
    }));
  } catch (e) { /* storage unavailable */ }
}

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fmt(dt) {
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function course(id) {
  if (id === 'todo') return TODO_COURSE;
  return state.courses.find((c) => c.id === id) || { name: '—', code: '', color: '#888' };
}
function timeLabel(t) {
  if (!t) return 'All day';
  let [h, m] = t.split(':').map(Number);
  const ap = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return h + ':' + String(m).padStart(2, '0') + ' ' + ap;
}
function weekdayName(dt) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()];
}
function monthName(m) {
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m];
}
function letter(p) {
  if (p === null || isNaN(p)) return '—';
  if (p >= 93) return 'A'; if (p >= 90) return 'A−'; if (p >= 87) return 'B+';
  if (p >= 83) return 'B'; if (p >= 80) return 'B−'; if (p >= 77) return 'C+';
  if (p >= 73) return 'C'; if (p >= 70) return 'C−'; if (p >= 67) return 'D+';
  if (p >= 60) return 'D'; return 'F';
}
function termLabel() {
  if (state.term && state.term.label) return state.term.label;
  const m = TODAY.getMonth();
  const season = m <= 4 ? 'Spring' : m <= 6 ? 'Summer' : 'Fall';
  return season + ' ' + TODAY.getFullYear();
}
function termEnd() {
  if (state.term && state.term.end) return state.term.end;
  const y = TODAY.getFullYear();
  const m = TODAY.getMonth();
  if (m >= 7) return y + '-12-20';
  if (m <= 4) return y + '-05-15';
  return y + '-08-15';
}
function blankNew() {
  return {
    title: '',
    courseId: state.courses[0] ? state.courses[0].id : 'todo',
    type: 'homework',
    dueDate: fmt(TODAY),
    dueTime: '23:59',
    difficulty: 3,
    repeats: false,
    freq: 'weekly',
    byDay: [],
    until: termEnd(),
    notes: '',
  };
}
// the assignment form writes into whichever draft is open (edit wins)
function formTarget() {
  return state.editA || state.newA;
}
function countdownLabel(ds) {
  const diff = Math.round((parseDate(ds) - TODAY) / 86400000);
  return diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : 'in ' + diff + 'd';
}

// ---------- icons ----------
// inline SF-Symbols-style strokes; one drawing style everywhere
const ICONS = {
  chevL: '<path d="M14.5 5 8 12l6.5 7"/>',
  chevR: '<path d="M9.5 5 16 12l-6.5 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3 17 7M7 17l-1.7 1.7"/>',
  download: '<path d="M12 3.5V14m0 0-4-4m4 4 4-4M4.5 15.5V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5"/>',
  calq: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8.5 2.75V6M15.5 2.75V6M10.2 13.4a1.8 1.8 0 1 1 2.55 1.63c-.5.23-.75.57-.75 1.07v.2"/><path d="M12 18.6h.01"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="7.2" cy="7.2" r="2.4"/><circle cx="16.8" cy="16.8" r="2.4"/>',
  todos: '<path d="M3.75 6.5 5.4 8.1l3-3.4"/><path d="M12 6.5h8.25"/><path d="M3.75 14.5 5.4 16.1l3-3.4"/><path d="M12 14.5h8.25"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.75"/><path d="m8.4 12.3 2.5 2.5 4.7-5.2"/>',
  repeat: '<path d="m17 3 3.5 3.5L17 10"/><path d="M4 12v-2a3.5 3.5 0 0 1 3.5-3.5h13"/><path d="m7 21-3.5-3.5L7 14"/><path d="M20 12v2a3.5 3.5 0 0 1-3.5 3.5h-13"/>',
};
function icon(name, size = 18, sw = 1.8) {
  return `<svg class="icn" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

const REDUCED_MOTION = window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- FLIP: smooth layout shifts ----------
// when a check-off or reschedule re-renders, everything that merely moved
// glides from its old spot instead of snapping. Capture rects before the
// mutation, translate the deltas away after.
function captureFlip() {
  if (REDUCED_MOTION) return null;
  const main = $('#main');
  if (!main) return null;
  const map = new Map();
  const vh = window.innerHeight;
  const keyOf = (el) => el.dataset.id ||
    (el.classList.contains('wday-row') ? 'row:' + el.dataset.date : null) ||
    (el.classList.contains('ghead-pill') ? 'gh:' + el.textContent.trim() : null);
  for (const el of main.querySelectorAll('[data-id], .wday-row[data-date], .ghead-pill')) {
    const k = keyOf(el);
    if (!k || map.has(k)) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < -100 || r.top > vh + 100) continue; // offscreen: no need
    map.set(k, r);
  }
  return map;
}
function playFlip(map, excludeId) {
  if (!map) return;
  const main = $('#main');
  if (!main) return;
  const movedRows = new Set();
  const seen = new Set();
  // containers first, so cards riding inside an animated row can be skipped
  for (const row of main.querySelectorAll('.wday-row[data-date], .ghead-pill')) {
    const k = row.classList.contains('wday-row') ? 'row:' + row.dataset.date : 'gh:' + row.textContent.trim();
    const r0 = map.get(k);
    if (!r0 || !row.animate) continue;
    const r1 = row.getBoundingClientRect();
    const dy = r0.top - r1.top;
    if (Math.abs(dy) < 1) continue;
    movedRows.add(row);
    row.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
      { duration: 320, easing: 'cubic-bezier(.3,.9,.4,1)' });
  }
  for (const el of main.querySelectorAll('[data-id]')) {
    const id = el.dataset.id;
    if (id === excludeId || seen.has(id)) continue;
    seen.add(id);
    const r0 = map.get(id);
    if (!r0 || !el.animate) continue;
    let p = el.parentElement, riding = false;
    while (p && p !== main) { if (movedRows.has(p)) { riding = true; break; } p = p.parentElement; }
    if (riding) continue;
    const r1 = el.getBoundingClientRect();
    const dx = r0.left - r1.left, dy = r0.top - r1.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: 320, easing: 'cubic-bezier(.3,.9,.4,1)' });
  }
}

// ---------- a11y decoration ----------
// generated checkboxes are spans; give them keyboard focus and roles in one
// pass after each render instead of in every template
function decorateA11y() {
  for (const el of document.querySelectorAll('[data-act="toggle-done"], [data-act="review-toggle"], [data-act="detail-toggle-done"]')) {
    if (el.tagName === 'BUTTON') continue;
    el.setAttribute('role', 'checkbox');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-checked', el.dataset.done === '1' ? 'true' : 'false');
    if (!el.getAttribute('aria-label')) {
      el.setAttribute('aria-label', el.dataset.done === '1' ? 'Mark as to-do' : 'Mark done');
    }
  }
  for (const el of document.querySelectorAll('.legend-check')) {
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
  }
}

function dotsHTML(n, px = 7, cls = '') {
  let h = '';
  for (let i = 0; i < 5; i++) {
    h += `<span class="dot" style="width:${px}px;height:${px}px;background:${i < n ? DIFF[n - 1] : 'var(--sep)'}"></span>`;
  }
  return `<span class="dots ${cls}">${h}</span>`;
}
function filledDotsHTML(n) {
  let h = '';
  for (let i = 0; i < n; i++) {
    h += `<span class="dot" style="width:4px;height:4px;background:${DIFF[n - 1]}"></span>`;
  }
  return `<span class="mchip-dots">${h}</span>`;
}

// weekday spellings accepted in recurrence byDay lists (import JSON may use
// "Mon"/"monday"/"MO"; the form stores plain 0–6 numbers)
const DAY_KEYS = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function normalizeByDay(list) {
  const out = new Set();
  for (const d of list || []) {
    if (typeof d === 'number' && d >= 0 && d <= 6) { out.add(d); continue; }
    const k = String(d).slice(0, 2).toLowerCase();
    if (DAY_KEYS[k] !== undefined) out.add(DAY_KEYS[k]);
  }
  return out;
}
// "weekly · Mon/Wed/Fri" — shared by review, to-dos, and the detail modal
function recurLabel(rec) {
  if (!rec) return '';
  const freq = rec.frequency || 'weekly';
  const days = freq === 'weekly' ? [...normalizeByDay(rec.byDay)].sort() : [];
  return days.length ? freq + ' · ' + days.map((d) => DAY_ABBR[d]).join('/') : freq;
}

// expand recurrences into dated occurrences, minus hidden courses
// (pass includeHidden=true for exports that should cover everything)
function occurrences(includeHidden) {
  const out = [];
  for (const a of state.assignments) {
    if (!a.dueDate) continue;
    if (a.recurrence) {
      const start = parseDate(a.dueDate);
      const until = parseDate(a.recurrence.until) || new Date(TODAY.getFullYear(), 11, 31);
      const step = a.recurrence.interval || 1;
      const freq = a.recurrence.frequency || 'weekly';
      const byDay = freq === 'weekly' ? normalizeByDay(a.recurrence.byDay) : null;
      const push = (ds) => {
        // a single occurrence deleted from the series is recorded in exDates
        if (a.exDates && a.exDates[ds]) return;
        out.push(Object.assign({}, a, {
          dueDate: ds,
          _recurring: true,
          _baseId: a.id,
          id: a.id + '@' + ds,
          // recurring occurrences are completed per-date, not on the base item
          status: a.doneDates && a.doneDates[ds] ? 'done' : 'todo',
          // surface the per-date completion timestamp (older data may be `true`)
          doneAt: a.doneDates && typeof a.doneDates[ds] === 'string' ? a.doneDates[ds] : undefined,
        }));
      };
      if (byDay && byDay.size) {
        // fixed weekdays (MWF, TuTh): walk day by day from the start date,
        // keeping matching days; interval>1 skips off-weeks counted from the
        // start date's week
        const anchor = new Date(start);
        anchor.setDate(start.getDate() - start.getDay());
        let cur = new Date(start), added = 0, guard = 0;
        while (cur <= until && added < 180 && guard < 1500) {
          const wk = Math.floor(Math.round((cur - anchor) / 86400000) / 7);
          if (byDay.has(cur.getDay()) && wk % step === 0) { push(fmt(cur)); added++; }
          cur.setDate(cur.getDate() + 1);
          guard++;
        }
      } else {
        let cur = new Date(start), i = 0;
        while (cur <= until && i < 120) {
          push(fmt(cur));
          if (freq === 'daily') cur.setDate(cur.getDate() + step);
          else if (freq === 'monthly') cur.setMonth(cur.getMonth() + step);
          else cur.setDate(cur.getDate() + 7 * step);
          i++;
        }
      }
    } else {
      out.push(Object.assign({}, a));
    }
  }
  return out.filter((o) => includeHidden || !state.hidden[o.courseId]);
}

// the completion celebration: checkbox flares and fills, the title gets
// struck through stroke-by-stroke, the card's outline glows in the course
// color, then the card morphs — shrinks and glides — into its "done" incarnation
function playCompleteAnim(checkEl) {
  if (checkEl.classList.contains('checking')) return; // already mid-celebration
  const occId = checkEl.dataset.id;
  const baseId = checkEl.dataset.base;
  if (REDUCED_MOTION) { toggleDone(occId, baseId); return; }
  const card = checkEl.closest('.wcard, .acard, .todo-row, .ctask-row');

  checkEl.classList.add('checking');
  hapticTick('align');

  // sidebar to-do rows have no on-screen "done" incarnation to morph into (they
  // just leave the list), and the wide glow/scale looks wrong in the narrow
  // panel — check, then collapse the row in place rather than fly a ghost across
  // the app to wherever the done copy happens to render
  if (card && checkEl.closest('#sidebar')) {
    setTimeout(() => card.classList.add('row-collapse'), 340);
    setTimeout(() => { toggleDone(occId, baseId); hapticTick('edge'); }, 660);
    return;
  }

  if (card) {
    card.classList.add('completing');
    const title = card.querySelector('.wcard-title, .acard-title, .todo-title, .ctask-title');
    if (title) setTimeout(() => title.classList.add('strike-anim'), 120);
  }

  setTimeout(() => {
    const from = card && card.getBoundingClientRect();
    const ghost = card ? morphGhost(card, from) : null;
    completedPopId = occId;
    toggleDone(occId, baseId); // re-renders; morphToDone hands off to the new element
    completedPopId = null;
    hapticTick('edge'); // soft thud as it lands in the pill
    morphToDone(ghost, from, occId);
  }, card ? 620 : 350);
}

// fixed-position clone of the card, frozen mid-celebration, used as the
// morph's outgoing half (the live card is destroyed by the re-render)
function morphGhost(card, r) {
  const g = card.cloneNode(true);
  g.classList.remove('completing');
  // freeze cloned check/strike animations at their end state instead of replaying
  for (const n of g.querySelectorAll('*')) { n.style.animationDuration = '0s'; n.style.transition = 'none'; }
  g.style.cssText += `;position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;margin:0;z-index:60;pointer-events:none;transform-origin:top left;`;
  document.body.appendChild(g);
  return g;
}

// FLIP crossfade: the ghost of the big card shrinks/glides into the done
// element's box while the done element grows out of the card's box
function morphToDone(ghost, from, occId) {
  if (!ghost) return;
  const sel = `.done-chip[data-id="${occId}"], .acard[data-id="${occId}"], .todo-row[data-id="${occId}"], .wcard[data-id="${occId}"]`;
  const target = document.querySelector(sel);
  if (!target || !ghost.animate) {
    // done incarnation isn't on screen (e.g. sidebar to-do) — just shrink away
    if (ghost.animate) {
      ghost.animate(
        [{ transform: 'none', opacity: 1 }, { transform: 'scale(.6)', opacity: 0 }],
        { duration: 280, easing: 'ease-in' }
      ).onfinish = () => ghost.remove();
    } else ghost.remove();
    return;
  }
  target.classList.remove('pill-pop'); // the morph replaces the fallback pop
  const to = target.getBoundingClientRect();
  const ease = 'cubic-bezier(.3,1.15,.4,1)';
  ghost.animate(
    [
      { transform: 'none', opacity: 1 },
      { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`, opacity: 0 },
    ],
    { duration: 440, easing: ease }
  ).onfinish = () => ghost.remove();
  target.animate(
    [
      { transformOrigin: 'top left', transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: 0 },
      { transformOrigin: 'top left', transform: 'none', opacity: 1 },
    ],
    { duration: 440, easing: ease }
  );
}

// the course editor shows a raw JSON mirror of its assignments; when they
// change through modals/checks while it's open, rebuild it so a later
// "Apply JSON" can't write back stale data
function refreshCourseJson() {
  if (state.view === 'courses' && state.courseEdit) {
    state.courseJson = buildCourseJson(state.courseEdit);
  }
}

function toggleDone(occId, baseId) {
  const flip = captureFlip();
  const base = baseId || occId;
  const now = new Date().toISOString();
  if (occId && occId.includes('@')) {
    // recurring occurrence: toggle just this date. The value doubles as the
    // completion timestamp (any truthy value counts as done in occurrences()).
    const date = occId.split('@')[1];
    state.assignments = state.assignments.map((a) => {
      if (a.id !== base) return a;
      const dd = Object.assign({}, a.doneDates || {});
      if (dd[date]) delete dd[date]; else dd[date] = now;
      return Object.assign({}, a, { doneDates: dd });
    });
  } else {
    state.assignments = state.assignments.map((a) =>
      a.id === base
        ? Object.assign({}, a, a.status === 'done' ? { status: 'todo' } : { status: 'done', doneAt: now })
        : a
    );
  }
  refreshCourseJson();
  render();
  // the celebrating card has its own morph; everything else glides
  playFlip(flip, completedPopId);
}

// ---------- calendar carousel (direct-manipulation scroll + snap) ----------
function trackEl() {
  return state.view === 'week' ? $('.week-track') : $('.month-track');
}
function trackAxis() {
  return state.view === 'week' ? 'X' : 'Y';
}
// distance between adjacent panels: week = stage width minus peeks, month = stage height
function panelDistance() {
  if (state.view === 'week') {
    const st = $('.week-stage');
    return st ? st.clientWidth - 104 : 0;
  }
  const st = $('.month-stage');
  return st ? st.clientHeight : 0;
}

// advance the calendar and re-render just the calendar surfaces —
// sidebar/modals don't depend on the visible month, and skipping them
// keeps mid-gesture commits cheap
function navCommit(dir) {
  if (state.view === 'week') {
    state.weekOffset += dir;
  } else {
    state.month += dir;
    if (state.month < 0) { state.month = 11; state.year--; }
    if (state.month > 11) { state.month = 0; state.year++; }
  }
  hapticTick('strong');
  renderTitlebar();
  renderMain();
}

// button navigation: commit, then glide the new track in from the side
function navCalendar(dir) {
  navCommit(dir);
  animateNav(dir);
}
function animateNav(dir) {
  if (REDUCED_MOTION) return;
  const tr = trackEl();
  if (!tr) return;
  const D = panelDistance();
  const axis = trackAxis();
  tr.style.transition = 'none';
  tr.style.transform = `translate${axis}(${dir * D}px)`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    tr.style.transition = 'transform .26s cubic-bezier(.25,.8,.35,1)';
    tr.style.transform = `translate${axis}(0)`;
  }));
}

// trackpad haptic (macOS Force Touch) — silently a no-op outside Tauri
// 'strong' = double level-change pulse (calendar flips), 'edge' = generic knock
function hapticTick(kind = 'align') {
  const t = window.__TAURI__;
  if (!(t && t.core && t.core.invoke)) return;
  const send = (pattern) => t.core.invoke('haptic', { pattern }).catch(() => {});
  if (kind === 'strong') {
    send('strong');
    setTimeout(() => send('strong'), 70);
  } else {
    send(kind === 'edge' ? 'generic' : 'align');
  }
}

// dock badge: how many unchecked items are due today (macOS)
function updateBadge() {
  try {
    const t = window.__TAURI__;
    const w = t && t.window && t.window.getCurrentWindow && t.window.getCurrentWindow();
    if (!w || !w.setBadgeCount) return;
    const todayStr = fmt(TODAY);
    const n = occurrences().filter((o) => o.dueDate === todayStr && o.status !== 'done').length;
    w.setBadgeCount(n > 0 ? n : undefined).catch(() => {});
  } catch (e) { /* badge unsupported */ }
}

// ---------- render ----------
function render() {
  document.documentElement.dataset.theme = state.theme;
  renderTitlebar();
  renderSidebar();
  renderMain();
  renderModals();
  decorateA11y();
  updateBadge();
  saveState();
}

function renderTitlebar() {
  for (const v of ['month', 'week', 'agenda']) {
    $('#seg-' + v).classList.toggle('active', state.view === v);
  }
  // glide the glass thumb under the active segment
  const thumb = $('#seg-thumb');
  const activeSeg = ['month', 'week', 'agenda'].includes(state.view) ? $('#seg-' + state.view) : null;
  if (activeSeg) {
    thumb.style.transform = `translateX(${activeSeg.offsetLeft}px)`;
    thumb.style.width = activeSeg.offsetWidth + 'px';
    thumb.style.opacity = '1';
  } else {
    thumb.style.opacity = '0';
  }
  $('#monthnav').hidden = !(state.view === 'month' || state.view === 'week');

  const wkStart = weekStart();
  let title = monthName(state.month) + ' ' + state.year;
  if (state.view === 'week') title = 'Week of ' + monthName(wkStart.getMonth()).slice(0, 3) + ' ' + wkStart.getDate();
  else if (state.view === 'agenda') title = 'Agenda';
  else if (state.view === 'import') title = 'Import';
  else if (state.view === 'needs') title = 'Needs a Date';
  else if (state.view === 'courses') title = 'Courses';
  else if (state.view === 'grades') title = 'Grades';
  else if (state.view === 'todos') title = 'To-Dos';
  else if (state.view === 'done') title = 'Completed';
  $('#header-title').textContent = title;

  $('#btn-import').classList.toggle('active', state.view === 'import');
  $('#btn-needs').classList.toggle('active', state.view === 'needs');
  $('#btn-theme').innerHTML = icon(state.theme === 'dark' ? 'sun' : 'moon', 17);

  const needs = state.assignments.filter((a) => !a.dueDate && !state.hidden[a.courseId]).length;
  const badge = $('#needs-badge');
  badge.hidden = needs === 0;
  badge.textContent = needs;
}

function renderSidebar() {
  const occ = occurrences();
  const todayStr = fmt(TODAY);
  const in7 = new Date(TODAY); in7.setDate(TODAY.getDate() + 7);
  const in7Str = fmt(in7);
  // overdue = past-due and unchecked, but ignore anything 3+ weeks stale — that's
  // almost always something finished-but-never-checked-off, not a real to-do
  const wk3 = new Date(TODAY); wk3.setDate(TODAY.getDate() - 21);
  const wk3Str = fmt(wk3);
  const overdue = occ.filter((o) => o.dueDate < todayStr && o.dueDate >= wk3Str && o.status !== 'done');
  const upcoming = occ.filter((o) => o.dueDate >= todayStr && o.status !== 'done');
  const dueToday = upcoming.filter((o) => o.dueDate === todayStr);
  const dueWeek = upcoming.filter((o) => o.dueDate <= in7Str);

  // the single soonest deadline — the "do this first" item
  let next = null;
  for (const o of upcoming) {
    if (!next || o.dueDate < next.dueDate ||
        (o.dueDate === next.dueDate && (o.dueTime || '99:99') < (next.dueTime || '99:99'))) next = o;
  }

  // the toughest thing still ahead — where study time should go
  let hardest = null;
  for (const o of upcoming) {
    if (!hardest || o.difficulty > hardest.difficulty ||
        (o.difficulty === hardest.difficulty && o.dueDate < hardest.dueDate)) hardest = o;
  }
  const exams = upcoming.filter((o) => o.type === 'exam')
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)).slice(0, 3);

  // next-7-days workload — one bar per day so crunch days stand out
  const load = [];
  let loadMax = 1;
  for (let i = 0; i < 7; i++) {
    const d = new Date(TODAY); d.setDate(TODAY.getDate() + i);
    const n = upcoming.filter((o) => o.dueDate === fmt(d)).length;
    loadMax = Math.max(loadMax, n);
    load.push({ n, wd: 'SMTWTFS'[d.getDay()], today: i === 0 });
  }

  const legendHTML = state.courses.length
    ? state.courses.map((c) => {
      const on = !state.hidden[c.id];
      return `
      <div class="legend-row ${on ? '' : 'off'}">
        <span class="legend-check ${on ? 'on' : ''}" data-act="legend-toggle" data-id="${c.id}"
              style="--cc:${c.color}" role="checkbox" aria-checked="${on}"
              title="${on ? 'Hide on calendar' : 'Show on calendar'}"></span>
        <button class="legend-open" data-act="course-edit" data-id="${c.id}" title="Open ${esc(c.name)}">
          <span class="legend-name">${esc(c.name)}</span>
          <span class="legend-code">${esc(c.code)}</span>
        </button>
      </div>`;
    }).join('')
    : `<div class="legend-empty">No courses yet — import a syllabus to get started.</div>`;

  // glance sections only render when they have something to say —
  // the sidebar is the busiest surface in the app and earns its pixels
  const sections = [];

  if (dueWeek.length) {
    // 7-day workload sparkbars — empty days show a faint baseline nub
    const barsHTML = load.map((d) => `
      <div class="load-col ${d.today ? 'today' : ''}" title="${d.n} due">
        <div class="load-track">
          <div class="load-bar ${d.n ? '' : 'empty'}" style="height:${d.n ? Math.max(14, Math.round(d.n / loadMax * 100)) : 0}%"></div>
        </div>
        <div class="load-n">${d.n || ''}</div>
        <div class="load-wd">${d.wd}</div>
      </div>`).join('');
    sections.push(`
      <div class="glance-section">
        <div class="glance-sub">Workload · next 7 days</div>
        <div class="load-chart">${barsHTML}</div>
      </div>`);
  }

  if (next) {
    const nc = course(next.courseId);
    const diff = Math.round((parseDate(next.dueDate) - TODAY) / 86400000);
    const urg = diff <= 1 ? '#ff453a' : diff <= 3 ? '#ff9f0a' : 'var(--text-dim)';
    sections.push(`
      <div class="glance-section">
        <div class="glance-sub">Up next</div>
        <div class="glance-card" data-act="detail" data-id="${next.id}" style="border-left:3px solid ${nc.color}">
          <div class="gc-body">
            <div class="gc-title">${esc(next.title)}</div>
            <div class="gc-meta">${esc(nc.code)}${next.dueTime ? ' · ' + timeLabel(next.dueTime) : ''}</div>
          </div>
          <span class="gc-count" style="color:${urg}">${countdownLabel(next.dueDate)}</span>
        </div>
      </div>`);
  }

  // skip "toughest" when it's the same item already shown under "up next"
  if (hardest && (!next || hardest.id !== next.id)) {
    const hc = course(hardest.courseId);
    sections.push(`
      <div class="glance-section">
        <div class="glance-sub">Toughest ahead</div>
        <div class="glance-card" data-act="detail" data-id="${hardest.id}" style="border-left:3px solid ${hc.color}">
          <div class="gc-body">
            <div class="gc-title">${esc(hardest.title)}</div>
            <div class="gc-meta">${esc(hc.code)} · ${countdownLabel(hardest.dueDate)}</div>
          </div>
          ${dotsHTML(hardest.difficulty, 6, 'tight')}
        </div>
      </div>`);
  }

  if (exams.length) {
    const examsHTML = exams.map((o) => {
      const ec = course(o.courseId);
      const diff = Math.round((parseDate(o.dueDate) - TODAY) / 86400000);
      const urgency = diff <= 3 ? '#ff3b30' : diff <= 7 ? '#ff9f0a' : 'var(--text-dim)';
      return `
        <div class="glance-card" data-act="detail" data-id="${o.id}" style="border-left:3px solid ${ec.color}">
          <div class="gc-body">
            <div class="gc-title sm">${esc(o.title)}</div>
            <div class="gc-meta">${esc(ec.code)}</div>
          </div>
          <span class="gc-count" style="color:${urgency}">${countdownLabel(o.dueDate)}</span>
        </div>`;
    }).join('');
    sections.push(`
      <div class="glance-section">
        <div class="glance-sub">Exams to prep for</div>
        ${examsHTML}
      </div>`);
  }

  const statHTML = (overdue.length || dueToday.length || dueWeek.length)
    ? `
      <div class="stat-row">
        <div class="stat-tile ${overdue.length ? 'alert' : ''}">
          <div class="stat-num" style="color:${overdue.length ? '#ff453a' : 'var(--text-faint)'}">${overdue.length}</div>
          <div class="stat-label">Overdue</div>
        </div>
        <div class="stat-tile">
          <div class="stat-num" style="color:${dueToday.length ? '#ff9f0a' : 'var(--text)'}">${dueToday.length}</div>
          <div class="stat-label">Due today</div>
        </div>
        <div class="stat-tile">
          <div class="stat-num">${dueWeek.length}</div>
          <div class="stat-label">This week</div>
        </div>
      </div>`
    : `<div class="glance-clear">Nothing due this week 🎉</div>`;

  $('#sidebar').innerHTML = `
    <div class="sb-brand">
      <span class="sb-logo">S</span>
      <div>
        <div class="sb-title">Semester</div>
        <div class="sb-term">${termLabel()}</div>
      </div>
    </div>

    <div class="sb-head">Views</div>
    <button class="nav-btn ${state.view === 'grades' ? 'active' : ''}" data-act="view" data-view="grades">
      <span class="nav-icon">${icon('percent', 16)}</span> Grade Calculator
    </button>
    <button class="nav-btn ${state.view === 'todos' ? 'active' : ''}" data-act="view" data-view="todos">
      <span class="nav-icon">${icon('todos', 16)}</span> To-Dos
    </button>
    <button class="nav-btn ${state.view === 'done' ? 'active' : ''}" data-act="view" data-view="done">
      <span class="nav-icon">${icon('checkCircle', 16)}</span> Completed
    </button>

    <div class="sb-head-row">
      <span class="sb-head">Courses</span>
      <span class="sb-hint">check to show · click to open</span>
    </div>
    ${legendHTML}

    <div class="sb-head-row">
      <span class="sb-head">To-Dos</span>
      <button class="todo-add-btn" data-act="add-todo" title="New to-do" aria-label="New to-do">${icon('plus', 13, 2.2)}</button>
    </div>
    ${todoListHTML()}

    <div class="glance">
      <div class="sb-head">At a Glance</div>
      ${statHTML}
      ${sections.join('')}
    </div>`;
}

// open to-dos, occurrence-aware (recurring items check off per date),
// dateless ones last, soonest first
function openTodos() {
  const dated = occurrences().filter((o) => o.courseId === 'todo' && o.status !== 'done');
  const dateless = state.assignments.filter((a) => a.courseId === 'todo' && !a.dueDate && a.status !== 'done');
  return dated.concat(dateless).sort((x, y) => {
    const dx = x.dueDate || '9999', dy = y.dueDate || '9999';
    return dx < dy ? -1 : dx > dy ? 1 : (x.dueTime || '99') < (y.dueTime || '99') ? -1 : 1;
  });
}

function todoMeta(a) {
  if (!a.dueDate) return 'No date';
  const dt = parseDate(a.dueDate);
  let meta = monthName(dt.getMonth()).slice(0, 3) + ' ' + dt.getDate() + (a.dueTime ? ' · ' + timeLabel(a.dueTime) : '');
  if (a.dueDate < fmt(TODAY)) meta += ' · overdue';
  return meta;
}

function todoRowHTML(a) {
  return `
    <div class="todo-row" data-act="detail" data-id="${a.id}" style="--cc:${TODO_COURSE.color}">
      <span class="check todo-check" data-act="toggle-done" data-done="0" data-id="${a.id}" data-base="${a._baseId || a.id}"></span>
      <div class="todo-body">
        <div class="todo-title">${esc(a.title)}</div>
        <div class="todo-meta ${a.dueDate && a.dueDate < fmt(TODAY) ? 'late' : ''}">${todoMeta(a)}</div>
      </div>
    </div>`;
}

// sidebar: top 2 only — the full list lives on the To-Dos page
function todoListHTML() {
  const todos = openTodos();
  if (!todos.length) {
    return `<div class="legend-empty">Nothing to do — hit ＋ to add a task.</div>`;
  }
  let html = todos.slice(0, 2).map(todoRowHTML).join('');
  if (todos.length > 2) {
    html += `<button class="todo-more" data-act="view" data-view="todos">View all ${todos.length} ›</button>`;
  }
  return html;
}

const VIEW_ORDER = { month: 0, week: 1, agenda: 2 };

function renderMain() {
  const main = $('#main');
  switch (state.view) {
    case 'month': main.innerHTML = monthView(); break;
    case 'week': main.innerHTML = weekView(); break;
    case 'agenda': main.innerHTML = agendaView(); break;
    case 'needs': main.innerHTML = needsView(); break;
    case 'courses': main.innerHTML = coursesView(); break;
    case 'grades': main.innerHTML = gradesView(); break;
    case 'import': main.innerHTML = importView(); break;
    case 'todos': main.innerHTML = todosView(); break;
    case 'done': main.innerHTML = doneView(); break;
  }
  // animate view changes: calendar trio slides directionally, pages fade up
  const prev = renderMain._last;
  if (prev && prev !== state.view) {
    main.scrollTop = 0; // a stale offset from the last visit makes the slide-in judder
    const el = main.firstElementChild;
    if (el) {
      let cls = 'va-fade';
      if (VIEW_ORDER[prev] !== undefined && VIEW_ORDER[state.view] !== undefined) {
        cls = VIEW_ORDER[state.view] > VIEW_ORDER[prev] ? 'va-left' : 'va-right';
      }
      el.classList.add(cls);
      // drop the class when done so a leftover animation can't replay or
      // keep agenda groups pinned out of content-visibility laziness
      el.addEventListener('animationend', function h(e) {
        if (e.target !== el) return; // ignore bubbled child animations
        el.classList.remove(cls);
        el.removeEventListener('animationend', h);
      });
    }
  }
  renderMain._last = state.view;
}

function eventsByDate(occ) {
  const byDate = {};
  for (const o of occ) (byDate[o.dueDate] = byDate[o.dueDate] || []).push(o);
  for (const k in byDate) byDate[k].sort((a, b) => b.difficulty - a.difficulty);
  return byDate;
}

// ---- month ----
function monthView() {
  const byDate = eventsByDate(occurrences());
  const pm = state.month === 0 ? { y: state.year - 1, m: 11 } : { y: state.year, m: state.month - 1 };
  const nm = state.month === 11 ? { y: state.year + 1, m: 0 } : { y: state.year, m: state.month + 1 };
  return `
    <div class="month-wrap">
      <div class="month-heads">
        ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => `<div class="month-head">${w}</div>`).join('')}
      </div>
      <div class="month-stage">
        <div class="month-track">
          <div class="month-panel prev">${monthGridHTML(pm.y, pm.m, byDate)}</div>
          <div class="month-panel cur">${monthGridHTML(state.year, state.month, byDate)}</div>
          <div class="month-panel next">${monthGridHTML(nm.y, nm.m, byDate)}</div>
        </div>
      </div>
    </div>`;
}

function monthGridHTML(year, month, byDate) {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const weekCount = Math.ceil((startOffset + lastDay) / 7);
  const cursor = new Date(year, month, 1 - startOffset);

  let rows = '';
  for (let w = 0; w < weekCount; w++) {
    let cells = '';
    for (let dd = 0; dd < 7; dd++) {
      const dt = new Date(cursor);
      const ds = fmt(dt);
      const inMonth = dt.getMonth() === month;
      const isToday = sameDay(dt, TODAY);
      const evs = byDate[ds] || [];
      const shown = evs.slice(0, 2);

      const chips = shown.map((o) => {
        const c = course(o.courseId);
        const done = o.status === 'done';
        return `
          <div class="mchip ${done ? 'done' : ''}" data-act="detail" data-id="${o.id}" draggable="true" style="border-left-color:${c.color}">
            <span class="mchip-title" lang="en">${esc(o.title)}</span>
            ${filledDotsHTML(o.difficulty)}
          </div>`;
      }).join('');

      cells += `
        <div class="mday ${inMonth ? '' : 'out'} ${isToday ? 'today' : ''}" data-date="${ds}">
          <div class="mday-numrow">
            <button class="mday-add" data-act="day-add" data-date="${ds}" title="Add assignment" aria-label="Add assignment on ${ds}">${icon('plus', 12, 2.4)}</button>
            <span class="mday-num">${dt.getDate()}</span>
          </div>
          ${chips}
          ${evs.length > 2 ? `<button class="mmore" data-act="day-more" data-date="${ds}">+${evs.length - 2} more</button>` : ''}
        </div>`;
      cursor.setDate(cursor.getDate() + 1);
    }
    rows += `<div class="month-row">${cells}</div>`;
  }

  return `<div class="month-grid" style="grid-template-rows:repeat(${weekCount},1fr)">${rows}</div>`;
}

function weekStart() {
  const d = new Date(TODAY);
  d.setDate(TODAY.getDate() - TODAY.getDay() + state.weekOffset * 7);
  return d;
}

// ---- week ----
function weekView() {
  const byDate = eventsByDate(occurrences());
  const mk = (off) => {
    const d = new Date(TODAY);
    d.setDate(TODAY.getDate() - TODAY.getDay() + (state.weekOffset + off) * 7);
    return d;
  };
  return `
    <div class="week-stage">
      <div class="week-track">
        <div class="week-panel side prev"><div class="week-wrap">${weekRowsHTML(mk(-1), byDate)}</div></div>
        <div class="week-panel cur scrolly"><div class="week-wrap">${weekRowsHTML(mk(0), byDate)}</div></div>
        <div class="week-panel side next"><div class="week-wrap">${weekRowsHTML(mk(1), byDate)}</div></div>
      </div>
    </div>`;
}

function weekRowsHTML(wkStart, byDate) {
  let rows = '';
  for (let i = 0; i < 7; i++) {
    const dt = new Date(wkStart);
    dt.setDate(wkStart.getDate() + i);
    const ds = fmt(dt);
    const isToday = sameDay(dt, TODAY);
    // week reads chronologically: earliest due time first (all-day = 11:59 PM),
    // difficulty breaks ties — month/agenda keep their hardest-first order
    const evs = (byDate[ds] || []).slice().sort((a, b) => {
      const ta = a.dueTime || '23:59', tb = b.dueTime || '23:59';
      return ta < tb ? -1 : ta > tb ? 1 : b.difficulty - a.difficulty;
    });
    const active = evs.filter((e) => e.status !== 'done');
    const done = evs.filter((e) => e.status === 'done');

    const activeHTML = active.length ? `
      <div class="wday-grid">
        ${active.map((o) => {
          const c = course(o.courseId);
          return `
            <div class="wcard" data-act="detail" data-id="${o.id}" draggable="true" style="--cc:${c.color};border-left-color:${c.color}">
              <span class="check" data-act="toggle-done" data-done="0" data-id="${o.id}" data-base="${o._baseId || o.id}"></span>
              <div class="body-col">
                <div class="wcard-title">${esc(o.title)}</div>
                <div class="wcard-meta">${(o.dueTime ? timeLabel(o.dueTime) + ' · ' : '')}${esc(c.name)}</div>
              </div>
              ${dotsHTML(o.difficulty)}
            </div>`;
        }).join('')}
      </div>` : '';

    const doneHTML = done.length ? `
      <div class="done-strip">
        ${done.map((o) => {
          const c = course(o.courseId);
          return `
            <div class="done-chip ${o.id === completedPopId ? 'pill-pop' : ''}" data-act="detail" data-id="${o.id}" title="${esc(o.title)}">
              <span class="done-chip-check" data-act="toggle-done" data-done="1" data-id="${o.id}" data-base="${o._baseId || o.id}" style="background:${c.color}">✓</span>
              <span class="done-chip-title">${esc(o.title)}</span>
            </div>`;
        }).join('')}
      </div>` : '';

    rows += `
      <div class="wday-row ${isToday ? 'today' : ''}" data-date="${ds}">
        <div class="wday-date">
          <div class="wday-wd">${weekdayName(dt)}</div>
          <div class="wday-num">${dt.getDate()}</div>
          ${isToday ? '<div class="wday-today-tag">TODAY</div>' : ''}
        </div>
        <div class="wday-sep"></div>
        <div class="wday-body">
          ${activeHTML}${doneHTML}
          ${evs.length === 0 ? '<div class="wday-empty">No assignments</div>' : ''}
        </div>
      </div>`;
  }
  return rows;
}

// ---- agenda ----
const AGENDA_FILTERS = [
  ['all', 'All'], ['homework', 'Homework'], ['quiz', 'Quizzes'], ['exam', 'Exams'],
  ['project', 'Projects'], ['reading', 'Reading'], ['task', 'To-Dos'],
];

function agendaFilterHTML() {
  return `
    <div class="filter-row">
      ${AGENDA_FILTERS.map(([v, l]) => `
        <button class="filter-pill ${state.agendaFilter === v ? 'on' : ''}" data-act="agenda-filter" data-type="${v}">${l}</button>`).join('')}
    </div>`;
}

function agendaView() {
  const occ = occurrences();
  const todayStr = fmt(TODAY);
  const future = occ.filter((o) => o.dueDate >= todayStr)
    .filter((o) => state.agendaFilter === 'all' || o.type === state.agendaFilter)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : b.difficulty - a.difficulty));
  const groups = {};
  for (const o of future) (groups[o.dueDate] = groups[o.dueDate] || []).push(o);
  const keys = Object.keys(groups).sort().slice(0, 30);

  if (!keys.length) {
    const label = (AGENDA_FILTERS.find(([v]) => v === state.agendaFilter) || [])[1];
    return `
      <div class="agenda-wrap">
        ${agendaFilterHTML()}
        <div class="empty-note">${state.agendaFilter === 'all' ? 'Nothing coming up. 🎉' : 'No ' + esc(label.toLowerCase()) + ' coming up.'}</div>
      </div>`;
  }

  const groupHTML = keys.map((ds) => {
    const dt = parseDate(ds);
    const diff = Math.round((dt - TODAY) / 86400000);
    const sub = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : 'in ' + diff + ' days';
    const cards = groups[ds].map((o) => {
      const c = course(o.courseId);
      const done = o.status === 'done';
      return `
        <div class="acard ${done && o.id === completedPopId ? 'pill-pop' : ''}" data-act="detail" data-id="${o.id}" style="--cc:${c.color}">
          <span class="check" data-act="toggle-done" data-done="${done ? 1 : 0}" data-id="${o.id}" data-base="${o._baseId || o.id}"
                style="${done ? `background:${c.color};border-color:${c.color}` : ''}">${done ? '✓' : ''}</span>
          <span class="acard-swatch" style="background:${c.color}"></span>
          <div class="body-col">
            <div class="acard-title ${done ? 'done' : ''}">${esc(o.title)}</div>
            <div class="acard-meta">${(o.dueTime ? timeLabel(o.dueTime) + ' · ' : '')}${esc(c.name)}</div>
          </div>
          <span class="type-pill">${esc(o.type)}</span>
          ${dotsHTML(o.difficulty)}
        </div>`;
    }).join('');
    return `
      <div class="agenda-group">
        <div class="agenda-ghead">
          <span class="ghead-pill">
            <span class="agenda-glabel">${weekdayName(dt)}, ${monthName(dt.getMonth()).slice(0, 3)} ${dt.getDate()}</span>
            <span class="agenda-gsub">${sub}</span>
          </span>
        </div>
        <div class="agenda-list">${cards}</div>
      </div>`;
  }).join('');

  return `
    <div class="agenda-wrap">
      ${agendaFilterHTML()}
      ${groupHTML}
    </div>`;
}

// ---- needs a date ----
function needsView() {
  const items = state.assignments.filter((a) => !a.dueDate && !state.hidden[a.courseId]);
  const list = items.length ? items.map((a) => {
    const c = course(a.courseId);
    return `
      <div class="needs-card">
        <span class="acard-swatch" style="background:${c.color}"></span>
        <div class="body-col" style="flex:1;min-width:0;">
          <div class="needs-title">${esc(a.title)}</div>
          <div class="needs-meta">${esc(c.name)} · <span class="cap">${esc(a.type)}</span></div>
        </div>
        ${dotsHTML(a.difficulty)}
        <input type="date" class="date-input" data-input="needs-date" data-id="${a.id}">
      </div>`;
  }).join('')
    : `<div class="needs-empty">All items have dates. Nothing parked here.</div>`;

  return `
    <div class="page-wrap">
      <h2 class="page-h2">Needs a Date</h2>
      <p class="page-sub">Items from your syllabi that said “TBD.” Give them a date to put them on the calendar.</p>
      <div class="card-list">${list}</div>
    </div>`;
}

// ---- courses ----
function coursesView() {
  if (state.courseEdit) {
    const c = state.courses.find((x) => x.id === state.courseEdit);
    if (c) return courseEditorHTML(c);
    state.courseEdit = null;
  }
  const list = state.courses.length ? state.courses.map((c) => `
    <div class="course-card clickable" data-act="course-edit" data-id="${c.id}">
      <span class="course-swatch" style="background:${c.color}"></span>
      <div style="flex:1;">
        <div class="course-name">${esc(c.name)}</div>
        <div class="course-code">${esc(c.code)}</div>
      </div>
      <span class="course-count">${state.assignments.filter((a) => a.courseId === c.id).length} items</span>
      <span class="course-chevron">${icon('chevR', 16, 2)}</span>
    </div>`).join('')
    : `<div class="needs-empty">No courses yet. Import a syllabus to add your first class.</div>`;

  const diffLabels = ['quick (under an hour)', 'a couple of hours', 'a solid evening', 'multi-day effort', 'major exam or project'];
  const scale = diffLabels.map((l, i) => `
    <div class="diff-row">
      ${dotsHTML(i + 1)}
      <span class="n">${i + 1}</span>
      <span>${l}</span>
    </div>`).join('');

  return `
    <div class="page-wrap">
      <h2 class="page-h2">Courses</h2>
      <p class="page-sub">Click a course to edit its name, color, and data. Import more syllabi to add classes.</p>
      <div class="card-list">${list}</div>
      <div class="diff-scale">
        <div class="diff-scale-title">Difficulty scale</div>
        <div class="diff-rows">${scale}</div>
      </div>

      <div class="side-card">
        <div class="diff-scale-title">Semester</div>
        <div class="frow" style="margin-bottom:8px;">
          <div class="grow">
            <label class="field-label">Name</label>
            <input class="field" value="${esc(termLabel())}" data-input="term-label" placeholder="e.g. Fall 2026">
          </div>
          <div class="grow">
            <label class="field-label">Last day</label>
            <input type="date" class="field" value="${esc(termEnd())}" data-input="term-end">
          </div>
        </div>
        <p class="side-sub">The last day pre-fills “repeat until” for new recurring items.</p>
        <button class="btn-delete-course ${state.confirmNewTerm ? 'confirm' : ''}" data-act="new-semester">
          ${state.confirmNewTerm ? 'Really clear every course and item? Back up first. Click again.' : 'Start New Semester…'}
        </button>
      </div>

      <div class="side-card">
        <div class="diff-scale-title">Your data</div>
        <p class="side-sub">Everything lives on this Mac. Back it up to a file you can restore later or move to another machine.</p>
        <div class="data-row">
          <button class="btn-secondary" data-act="backup-export">Back Up…</button>
          <label class="btn-secondary file-btn">Restore…<input type="file" accept=".json,application/json" data-input="restore-file" style="display:none;"></label>
        </div>
        ${state.dataError ? `<div class="import-error">${esc(state.dataError)}</div>` : ''}
      </div>
    </div>`;
}

// ---- to-dos page ----
function todoCardHTML(o) {
  const done = o.status === 'done';
  return `
    <div class="acard ${done && o.id === completedPopId ? 'pill-pop' : ''}" data-act="detail" data-id="${o.id}" style="--cc:${TODO_COURSE.color}">
      <span class="check" data-act="toggle-done" data-done="${done ? 1 : 0}" data-id="${o.id}" data-base="${o._baseId || o.id}"
            style="${done ? `background:${TODO_COURSE.color};border-color:${TODO_COURSE.color}` : `border-color:${TODO_COURSE.color}`}">${done ? '✓' : ''}</span>
      <div class="body-col">
        <div class="acard-title ${done ? 'done' : ''}">${esc(o.title)}</div>
        <div class="acard-meta">${todoMeta(o)}${o.recurrence ? ' · repeats ' + esc(recurLabel(o.recurrence)) : ''}${o.notes ? ' · ' + esc(o.notes) : ''}</div>
      </div>
      ${dotsHTML(o.difficulty)}
    </div>`;
}

function todosView() {
  const todayStr = fmt(TODAY);
  const open = openTodos();
  const overdue = open.filter((o) => o.dueDate && o.dueDate < todayStr);
  const dueToday = open.filter((o) => o.dueDate === todayStr);
  const upcoming = open.filter((o) => o.dueDate && o.dueDate > todayStr).slice(0, 25);
  const dateless = open.filter((o) => !o.dueDate);
  const doneList = occurrences()
    .filter((o) => o.courseId === 'todo' && o.status === 'done')
    .concat(state.assignments.filter((a) => a.courseId === 'todo' && !a.dueDate && a.status === 'done'))
    .sort((x, y) => ((x.dueDate || '') < (y.dueDate || '') ? 1 : -1))
    .slice(0, 12);

  const section = (label, cls, items) => items.length ? `
    <div class="todos-section">
      <div class="todos-shead ${cls}">${label} <span class="todos-count">${items.length}</span></div>
      <div class="card-list">${items.map(todoCardHTML).join('')}</div>
    </div>` : '';

  const empty = !open.length && !doneList.length;

  return `
    <div class="page-wrap">
      <div class="grades-head">
        <h2 class="page-h2">To-Dos</h2>
        <button class="btn-confirm" data-act="add-todo">${icon('plus', 13, 2.4)} New To-Do</button>
      </div>
      <p class="page-sub">Personal tasks, kept apart from coursework. They show on the calendar in <span style="color:${TODO_COURSE.color};font-weight:700;">pink</span>.</p>
      ${empty ? `<div class="needs-empty">All clear. Add a task with ＋ New To-Do.</div>` : ''}
      ${section('Overdue', 'late', overdue)}
      ${section('Today', 'today', dueToday)}
      ${section('Upcoming', '', upcoming)}
      ${section('No date', '', dateless)}
      ${section('Completed', 'done', doneList)}
    </div>`;
}

// ---- completed page ----
function doneView() {
  // only the last two weeks: judged by completion time (doneAt); items from
  // before we tracked that fall back to their due date as a proxy
  const cutoff = new Date(TODAY); cutoff.setDate(TODAY.getDate() - 14);
  const cutoffStr = fmt(cutoff);
  const within2wk = (o) => {
    const ref = (o.doneAt && o.doneAt.slice(0, 10)) || o.dueDate;
    return ref && ref >= cutoffStr;
  };

  const items = occurrences().filter((o) => o.status === 'done')
    .concat(state.assignments.filter((a) => !a.dueDate && a.status === 'done' && !state.hidden[a.courseId]))
    .filter(within2wk)
    .sort((x, y) => {
      const dx = (x.doneAt && x.doneAt.slice(0, 10)) || x.dueDate || '0000';
      const dy = (y.doneAt && y.doneAt.slice(0, 10)) || y.dueDate || '0000';
      return dx < dy ? 1 : dx > dy ? -1 : (x.dueTime || '') < (y.dueTime || '') ? 1 : -1;
    });

  const rows = items.slice(0, 300).map((o) => {
    const c = course(o.courseId);
    let meta = 'No date';
    if (o.dueDate) {
      const dt = parseDate(o.dueDate);
      meta = monthName(dt.getMonth()).slice(0, 3) + ' ' + dt.getDate() + (o.dueTime ? ' · ' + timeLabel(o.dueTime) : '');
    }
    return `
      <div class="done-row" data-act="detail" data-id="${o.id}">
        <span class="check done-row-check" data-act="toggle-done" data-done="1" data-id="${o.id}" data-base="${o._baseId || o.id}"
              style="background:${c.color};border-color:${c.color}">✓</span>
        <span class="done-row-title">${esc(o.title)}</span>
        <span class="done-row-code">${esc(c.code || (o.courseId === 'todo' ? 'To-Do' : ''))}</span>
        <span class="done-row-meta">${meta}</span>
      </div>`;
  }).join('');

  return `
    <div class="page-wrap">
      <div class="grades-head">
        <h2 class="page-h2">Completed</h2>
        <span class="course-count">${items.length} done</span>
      </div>
      <p class="page-sub">Checked off in the last two weeks, newest first. Uncheck anything to send it back.</p>
      ${items.length ? `<div class="done-list">${rows}</div>` : `<div class="needs-empty">Nothing completed in the last two weeks.</div>`}
    </div>`;
}

// ---- course editor ----
const COURSE_PALETTE = ['#e5484d', '#ff9f0a', '#ffcc00', '#34c759', '#30d158', '#64d2ff', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff6482', '#a2845e', '#8e8e93'];

// open items for one course, series shown once — the editor's task list
function courseTasksHTML(c) {
  const items = state.assignments
    .filter((a) => a.courseId === c.id && (a.recurrence || a.status !== 'done'))
    .sort((x, y) => {
      const dx = x.dueDate || '9999', dy = y.dueDate || '9999';
      return dx < dy ? -1 : dx > dy ? 1 : (x.dueTime || '99') < (y.dueTime || '99') ? -1 : 1;
    });
  const todayStr = fmt(TODAY);

  const rows = items.map((a) => {
    let meta = 'Needs a date';
    let late = false;
    if (a.dueDate) {
      const dt = parseDate(a.dueDate);
      meta = weekdayName(dt) + ', ' + monthName(dt.getMonth()).slice(0, 3) + ' ' + dt.getDate() +
        (a.dueTime ? ' · ' + timeLabel(a.dueTime) : '');
      late = !a.recurrence && a.dueDate < todayStr;
    }
    if (a.recurrence) meta = 'Repeats ' + recurLabel(a.recurrence) + ' · from ' + meta.toLowerCase();
    return `
      <div class="ctask-row" data-act="detail" data-id="${a.id}" style="--cc:${c.color}">
        ${a.recurrence
          ? `<span class="ctask-repeat" title="Repeats ${esc(recurLabel(a.recurrence))}">${icon('repeat', 11, 2.2)}</span>`
          : `<span class="check" data-act="toggle-done" data-done="0" data-id="${a.id}" data-base="${a.id}"></span>`}
        <div class="body-col">
          <div class="ctask-title">${esc(a.title)}</div>
          <div class="ctask-meta ${late ? 'late' : ''}">${esc(meta)}${late ? ' · overdue' : ''}</div>
        </div>
        <span class="type-pill">${esc(a.type)}</span>
        <button class="ctask-edit" data-act="detail-edit" data-base="${a.id}">Edit</button>
      </div>`;
  }).join('');

  return `
    <div class="ctask-box">
      <div class="ctask-head">Open tasks <span class="todos-count">${items.length}</span></div>
      ${items.length ? `<div class="ctask-list">${rows}</div>`
        : `<div class="legend-empty" style="padding:10px 4px;">Nothing open for this course — all clear.</div>`}
    </div>`;
}

function courseEditorHTML(c) {
  const count = state.assignments.filter((a) => a.courseId === c.id).length;
  const swatches = COURSE_PALETTE.map((col) => `
    <button class="swatch ${String(c.color).toLowerCase() === col.toLowerCase() ? 'on' : ''}"
            data-act="course-color" data-color="${col}" style="background:${col}" title="${col}"></button>`).join('');

  return `
    <div class="page-wrap">
      <button class="btn-back" data-act="course-back">${icon('chevL', 14, 2.2)} Courses</button>

      <div class="grades-head" style="margin-top:12px;">
        <h2 class="page-h2" style="display:flex;align-items:center;gap:12px;margin:0;">
          <span class="course-swatch" style="background:${c.color}"></span> ${esc(c.name)}
        </h2>
        <span class="course-count">${count} items</span>
      </div>
      <p class="page-sub">Changes apply everywhere — calendar, sidebar, grades.</p>

      <div class="course-form">
        <div class="frow">
          <div class="grow">
            <label class="field-label">Name</label>
            <input class="field" value="${esc(c.name)}" data-input="course-name">
          </div>
          <div class="w130">
            <label class="field-label">Code</label>
            <input class="field" value="${esc(c.code)}" data-input="course-code">
          </div>
        </div>
        <label class="field-label">Color</label>
        <div class="swatch-row">
          ${swatches}
          <label class="swatch custom" title="Custom color" style="background:${c.color}">
            <span class="swatch-plus">✎</span>
            <input type="color" value="${esc(c.color)}" data-input="course-color-custom">
          </label>
        </div>
      </div>

      ${courseTasksHTML(c)}

      <div class="json-box">
        <div class="prompt-head">
          <span class="prompt-file">course.json</span>
          <span style="display:flex;gap:8px;">
            <button class="btn-secondary sm" data-act="course-json-revert">Revert</button>
            <button class="btn-confirm sm ${state.courseJsonSaved ? 'saved' : ''}" data-act="course-json-save">${state.courseJsonSaved ? 'Applied ✓' : 'Apply JSON'}</button>
          </span>
        </div>
        <textarea class="json-edit" data-input="course-json" spellcheck="false">${esc(state.courseJson)}</textarea>
        ${state.courseJsonError ? `<div class="import-error" style="margin:0 12px 12px;">${esc(state.courseJsonError)}</div>` : ''}
      </div>

      <button class="btn-export-ics" data-act="course-export-ics">Export to Apple Calendar (.ics)</button>

      <button class="btn-delete-course ${state.confirmDeleteCourse ? 'confirm' : ''}" data-act="course-delete">
        ${state.confirmDeleteCourse ? `Really delete “${esc(c.name)}” and its ${count} items? Click again.` : 'Delete Course…'}
      </button>
    </div>`;
}

// full round-trip JSON for one course: identity, grade categories, assignments
function buildCourseJson(cid) {
  const c = course(cid);
  return JSON.stringify({
    course: { name: c.name, code: c.code, color: c.color },
    grades: (state.grades[cid] || []).map((g) => ({ name: g.name, weight: g.weight, score: g.score })),
    assignments: state.assignments.filter((a) => a.courseId === cid).map((a) => {
      const o = {
        title: a.title, dueDate: a.dueDate, dueTime: a.dueTime,
        type: a.type, difficulty: a.difficulty, status: a.status, notes: a.notes,
      };
      if (a.recurrence) o.recurrence = a.recurrence;
      if (a.doneDates) o.doneDates = a.doneDates;
      return o;
    }),
  }, null, 2);
}

function applyCourseJson() {
  const cid = state.courseEdit;
  let j;
  try {
    j = JSON.parse(state.courseJson);
  } catch (e) {
    state.courseJsonError = 'Invalid JSON — ' + e.message;
    render();
    return;
  }
  if (!j || typeof j !== 'object' || !j.course || !Array.isArray(j.assignments)) {
    state.courseJsonError = 'Expected an object with "course" and an "assignments" array.';
    render();
    return;
  }
  state.courses = state.courses.map((c) => c.id === cid ? Object.assign({}, c, {
    name: j.course.name || c.name,
    code: j.course.code !== undefined ? j.course.code : c.code,
    color: /^#[0-9a-fA-F]{3,8}$/.test(j.course.color || '') ? j.course.color : c.color,
  }) : c);
  if (Array.isArray(j.grades)) {
    state.grades = Object.assign({}, state.grades, {
      [cid]: j.grades.map((g, i) => ({
        id: 'g' + Date.now() + '_' + i,
        name: g.name || 'Category',
        weight: parseFloat(g.weight) || 0,
        score: (g.score === 0 || g.score) ? g.score : '',
      })),
    });
  }
  const rebuilt = j.assignments.map((a, i) => {
    const out = {
      id: 'j' + Date.now() + '_' + i,
      title: String(a.title || 'Untitled'),
      courseId: cid,
      type: TYPES.includes(a.type) ? a.type : 'homework',
      dueDate: a.dueDate || null,
      dueTime: a.dueTime || undefined,
      difficulty: Math.min(5, Math.max(1, parseInt(a.difficulty) || 1)),
      status: a.status === 'done' ? 'done' : 'todo',
      source: 'syllabus',
      notes: a.notes || '',
    };
    if (a.recurrence) out.recurrence = a.recurrence;
    if (a.doneDates) out.doneDates = a.doneDates;
    return out;
  });
  state.assignments = state.assignments.filter((a) => a.courseId !== cid).concat(rebuilt);
  state.courseJsonError = '';
  state.courseJson = buildCourseJson(cid);
  state.courseJsonSaved = true;
  render();
  setTimeout(() => {
    state.courseJsonSaved = false;
    if (state.view === 'courses' && state.courseEdit === cid) render();
  }, 1600);
}

// ---- grades ----
function gradeCalc(cid) {
  const cats = (state.grades && state.grades[cid]) || [];
  let wSum = 0, wScore = 0, totalW = 0;
  for (const cat of cats) {
    const wt = parseFloat(cat.weight) || 0;
    totalW += wt;
    const sc = (cat.score === '' || cat.score === null || cat.score === undefined) ? null : parseFloat(cat.score);
    if (sc !== null && !isNaN(sc)) { wSum += wt; wScore += sc * wt; }
  }
  return { cats, wSum, totalW, overall: wSum > 0 ? wScore / wSum : null };
}

function gradeCourseId() {
  if (state.gradeCourse && state.courses.some((c) => c.id === state.gradeCourse)) return state.gradeCourse;
  return state.courses[0] ? state.courses[0].id : null;
}

function gradeSummaryHTML(cid) {
  const { wSum, totalW, overall } = gradeCalc(cid);
  const c = course(cid);
  const color = overall === null ? 'var(--text-dim)'
    : overall >= 90 ? '#34c759' : overall >= 80 ? '#0a84ff' : overall >= 70 ? '#ff9f0a' : '#ff3b30';
  return `
    <div class="gs-block" style="min-width:96px;">
      <div class="gs-num" style="color:${color}">${overall === null ? '—' : (Math.round(overall * 10) / 10) + '%'}</div>
      <div class="gs-label">Current grade</div>
    </div>
    <div class="gs-vsep"></div>
    <div class="gs-block" style="min-width:70px;">
      <div class="gs-num" style="color:${color}">${letter(overall)}</div>
      <div class="gs-label">Letter</div>
    </div>
    <div class="gs-right">
      <div class="gs-note">${wSum > 0 ? Math.round(wSum) + '% of grade counted so far' : 'Enter scores to see your grade'}</div>
      <div class="gs-weights">Weights total <b style="color:${Math.abs(totalW - 100) < 0.5 ? '#34c759' : '#ff9f0a'}">${Math.round(totalW)}%</b></div>
    </div>`;
}

// reverse calculator: the average needed on not-yet-scored weight to land
// each letter. earned/needed are in percent-points of the final grade.
function gradeTargetsHTML(cid) {
  const { wSum, totalW, overall } = gradeCalc(cid);
  const remaining = totalW - wSum;
  if (!(wSum > 0) || remaining < 0.5) return '';
  const earned = (overall || 0) * wSum / 100;
  const targets = [[93, 'A'], [90, 'A−'], [87, 'B+'], [83, 'B'], [80, 'B−'], [77, 'C+'], [73, 'C'], [70, 'C−']];
  const rows = [];
  for (const [pct, ltr] of targets) {
    const need = (pct * totalW / 100 - earned) / remaining * 100;
    if (need <= 0) continue; // already locked in — everything below is too
    rows.push({ pct, ltr, need });
    if (rows.length >= 4) break;
  }
  if (!rows.length) return '';
  const rowHTML = rows.map((r) => {
    const out = r.need > 100;
    const color = out ? '#ff453a' : r.need > 90 ? '#ff9f0a' : r.need > 75 ? 'var(--accent)' : '#34c759';
    return `
      <div class="gt-row ${out ? 'out' : ''}">
        <span class="gt-letter" style="color:${color}">${r.ltr}</span>
        <span class="gt-goal">finish ≥ ${r.pct}%</span>
        <div class="gt-track"><div class="gt-bar" style="width:${Math.min(r.need, 100)}%;background:${color}"></div></div>
        <span class="gt-need" style="color:${color}">${out ? 'out of reach' : 'avg ' + (Math.round(r.need * 10) / 10) + '%'}</span>
      </div>`;
  }).join('');
  return `
    <div class="grade-targets">
      <div class="gt-title">What you need on the rest
        <span class="gt-sub">${Math.round(remaining)}% of your grade is still open</span>
      </div>
      ${rowHTML}
    </div>`;
}

function gradesView() {
  const cid = gradeCourseId();
  if (!cid) {
    return `
      <div class="page-wrap grades">
        <h2 class="page-h2">Grade Calculator</h2>
        <p class="page-sub">Import a syllabus first — courses will show up here.</p>
        <div class="needs-empty">No courses yet.</div>
      </div>`;
  }
  const { cats } = gradeCalc(cid);
  const c = course(cid);

  const options = state.courses.map((o) =>
    `<option value="${o.id}" ${o.id === cid ? 'selected' : ''}>${esc(o.name)}</option>`).join('');

  const rows = cats.map((cat) => `
    <div class="grade-row">
      <input class="gname" value="${esc(cat.name)}" data-input="grade-name" data-id="${cat.id}">
      <input class="gnum" type="number" value="${esc(cat.weight)}" data-input="grade-weight" data-id="${cat.id}">
      <input class="gnum" type="number" value="${esc(cat.score)}" placeholder="—" data-input="grade-score" data-id="${cat.id}">
      <button class="gdel" data-act="grade-remove" data-id="${cat.id}" title="Remove">×</button>
    </div>`).join('');

  return `
    <div class="page-wrap grades">
      <div class="grades-head">
        <h2 class="page-h2">Grade Calculator</h2>
        <select class="select" data-input="grade-course">${options}</select>
      </div>
      <p class="page-sub">Set your grade breakdown, then enter the scores you've earned. Saved automatically on this Mac.</p>

      <div class="grade-summary" id="grade-summary" style="border-left-color:${c.color}">
        ${gradeSummaryHTML(cid)}
      </div>

      <div id="grade-targets-wrap">${gradeTargetsHTML(cid)}</div>

      <div class="grade-cols">
        <span class="c1">Category</span>
        <span class="c2">Weight %</span>
        <span class="c2">Your %</span>
        <span class="c3"></span>
      </div>
      <div class="grade-rows">${rows}</div>
      <button class="btn-add-cat" data-act="grade-add">${icon('plus', 13, 2.2)} Add category</button>
    </div>`;
}

// ---- import ----
function importView() {
  if (state.review) return reviewHTML();
  return `
    <div class="page-wrap wide">
      <h2 class="import-h2">Import a Syllabus</h2>
      <p class="import-sub">Paste the prompt below into Claude or ChatGPT along with your syllabus. Save its reply as a <code>.json</code> file, then drop it here — one file per course.</p>

      <div class="step-head">
        <span class="step-num">1</span>
        <span class="step-title">Copy the prompt</span>
      </div>
      <div class="prompt-box">
        <div class="prompt-head">
          <span class="prompt-file">syllabus-prompt.txt</span>
          <button class="btn-copy ${state.copied ? 'copied' : ''}" data-act="copy-prompt">${state.copied ? 'Copied ✓' : 'Copy'}</button>
        </div>
        <pre class="prompt-pre">${esc(PROMPT())}</pre>
      </div>

      <div class="step-head">
        <span class="step-num">2</span>
        <span class="step-title">Drop the JSON file</span>
      </div>
      <label class="dropzone" id="dropzone">
        <span class="drop-icon">${icon('download', 34, 1.4)}</span>
        <span class="drop-label">Drop a course <code>.json</code> here</span>
        <span class="drop-hint">or click to browse · nothing leaves your Mac</span>
        <input type="file" accept=".json,application/json" data-input="import-file" style="display:none;">
      </label>
      ${state.importError ? `<div class="import-error">${esc(state.importError)}</div>` : ''}
      <div class="sample-row"><button class="btn-link" data-act="load-sample">Try a sample file →</button></div>
    </div>`;
}

function reviewHTML() {
  const r = state.review;
  const on = r.items.filter((i) => i.include).length;
  const items = r.items.map((it, i) => {
    let meta;
    if (!it.dueDate) meta = 'Needs a date';
    else {
      const dt = parseDate(it.dueDate);
      meta = weekdayName(dt) + ', ' + monthName(dt.getMonth()).slice(0, 3) + ' ' + dt.getDate();
    }
    if (it.recurrence) meta += ' · repeats ' + recurLabel(it.recurrence);
    return `
      <div class="review-item ${it.include ? '' : 'off'}">
        <span class="check" data-act="review-toggle" data-i="${i}"
              style="${it.include ? `background:${r.color};border-color:${r.color}` : ''}">${it.include ? '✓' : ''}</span>
        <div class="body-col">
          <div class="review-title">${esc(it.title)}</div>
          <div class="review-meta">${esc(meta)}</div>
        </div>
        <span class="type-pill">${esc(it.type || 'homework')}</span>
        ${dotsHTML(it.difficulty || 1)}
      </div>`;
  }).join('');

  return `
    <div class="page-wrap wide review">
      <div class="review-head">
        <span class="review-swatch" style="background:${r.color}"></span>
        <h2>${esc(r.name)}</h2>
        <span class="review-code">${esc(r.code)}</span>
      </div>
      <p class="page-sub">Review before adding. Uncheck anything you don't want. Recurring items expand automatically.</p>
      ${r.existingId ? `
      <div class="review-replace">
        <b>${esc(r.code || r.name)}</b> is already in your courses — adding will replace its
        ${r.existingCount} current item${r.existingCount === 1 ? '' : 's'} with this list. Grade scores you've entered are kept.
      </div>` : ''}
      ${Array.isArray(r._raw.gradeWeights) && r._raw.gradeWeights.length ? `
      <div class="review-weights">
        <span class="rw-label">Grade breakdown found:</span>
        ${r._raw.gradeWeights.map((g) => `<span class="rw-chip">${esc(g.name)} <b>${esc(g.weight)}%</b></span>`).join('')}
        <span class="rw-note">→ will be loaded into the Grade Calculator</span>
      </div>` : ''}
      <div class="review-list">${items}</div>
      <div class="review-foot">
        <span class="review-summary">${on} of ${r.items.length} selected</span>
        <button class="btn-secondary" data-act="review-cancel">Discard</button>
        <button class="btn-confirm" data-act="review-confirm">${r.existingId ? 'Update Course' : 'Add to Calendar'}</button>
      </div>
    </div>`;
}

// ---------- modals ----------
// play the pop-out animation, then apply the state change and re-render
function animateModalClose(fn) {
  const ov = document.querySelector('#modal-root .overlay');
  if (!ov) { fn(); render(); return; }
  if (ov.classList.contains('out')) return; // already closing
  ov.classList.add('out');
  setTimeout(() => { fn(); render(); }, 160);
}

function renderModals() {
  const root = $('#modal-root');
  if (state.quickAdd) root.innerHTML = quickAddHTML();
  else if (state.editA) root.innerHTML = formModalHTML('edit');
  else if (state.showAdd) root.innerHTML = formModalHTML('add');
  else if (state.detailId) root.innerHTML = detailModalHTML();
  else if (state.dayPopover) root.innerHTML = dayPopoverHTML();
  else root.innerHTML = '';
}

// ---- day popover: every item on one day, from the month grid's "+N more" ----
function dayPopoverHTML() {
  const ds = state.dayPopover;
  const dt = parseDate(ds);
  const evs = occurrences().filter((o) => o.dueDate === ds)
    .sort((a, b) => {
      const ta = a.dueTime || '23:59', tb = b.dueTime || '23:59';
      return ta < tb ? -1 : ta > tb ? 1 : b.difficulty - a.difficulty;
    });

  const rows = evs.map((o) => {
    const c = course(o.courseId);
    const done = o.status === 'done';
    return `
      <div class="acard ${done && o.id === completedPopId ? 'pill-pop' : ''}" data-act="detail" data-id="${o.id}" style="--cc:${c.color}">
        <span class="check" data-act="toggle-done" data-done="${done ? 1 : 0}" data-id="${o.id}" data-base="${o._baseId || o.id}"
              style="${done ? `background:${c.color};border-color:${c.color}` : ''}">${done ? '✓' : ''}</span>
        <span class="acard-swatch" style="background:${c.color}"></span>
        <div class="body-col">
          <div class="acard-title ${done ? 'done' : ''}">${esc(o.title)}</div>
          <div class="acard-meta">${(o.dueTime ? timeLabel(o.dueTime) + ' · ' : '')}${esc(c.name)}</div>
        </div>
        ${dotsHTML(o.difficulty)}
      </div>`;
  }).join('');

  return `
    <div class="overlay" data-act="close-daypop">
      <div class="modal daypop">
        <div class="daypop-head">
          <div>
            <div class="daypop-title">${weekdayName(dt)}, ${monthName(dt.getMonth()).slice(0, 3)} ${dt.getDate()}</div>
            <div class="daypop-sub">${evs.length} item${evs.length === 1 ? '' : 's'}</div>
          </div>
          <button class="todo-add-btn" data-act="day-add" data-date="${ds}" title="Add on this day" aria-label="Add on this day">${icon('plus', 13, 2.2)}</button>
        </div>
        <div class="daypop-list">${rows || '<div class="legend-empty">Nothing on this day.</div>'}</div>
      </div>
    </div>`;
}

// ---------- quick add (⌘K) ----------
// one line of shorthand → an assignment. Recognized tokens (course code,
// date, time, type) are pulled out; whatever's left becomes the title.
const QA_WDS = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6,
};
const QA_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const QA_TYPES = {
  hw: 'homework', homework: 'homework', quiz: 'quiz', exam: 'exam', midterm: 'exam',
  final: 'exam', project: 'project', reading: 'reading', read: 'reading', task: 'task', todo: 'task',
};

function parseQuick(text) {
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  // course lookup: "ece391" (compact code) or bare "391" (number part)
  const codeMap = {};
  for (const c of state.courses) {
    const compact = String(c.code || '').replace(/\s+/g, '').toLowerCase();
    if (!compact) continue;
    codeMap[compact] = codeMap[compact] || c.id;
    const num = compact.replace(/^[a-z]+/, '');
    if (num && num !== compact) codeMap[num] = codeMap[num] || c.id;
  }

  const out = { title: '', courseId: 'todo', type: null, dueDate: null, dueTime: null };
  const rest = [], typeWords = [];
  const dateFrom = (dt) => { out.dueDate = fmt(dt); };

  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    const tk = raw.toLowerCase();
    const next = i + 1 < tokens.length ? tokens[i + 1] : null;
    let m;

    // course: "ece 391" (pair) or "ece391" / "391"
    if (next && /^\d/.test(next) && codeMap[tk + next.toLowerCase()]) {
      out.courseId = codeMap[tk + next.toLowerCase()];
      i++;
      continue;
    }
    if (codeMap[tk]) { out.courseId = codeMap[tk]; continue; }

    // dates
    if (tk === 'today' || tk === 'tod') { dateFrom(TODAY); continue; }
    if (tk === 'tomorrow' || tk === 'tmrw' || tk === 'tmr') {
      const d = new Date(TODAY); d.setDate(TODAY.getDate() + 1); dateFrom(d); continue;
    }
    if (QA_WDS[tk] !== undefined) {
      const d = new Date(TODAY);
      d.setDate(TODAY.getDate() + ((QA_WDS[tk] - TODAY.getDay() + 7) % 7)); // this weekday = today
      dateFrom(d);
      continue;
    }
    if (QA_MONTHS[tk.slice(0, 3)] !== undefined && tk.length >= 3 && /^[a-z]+$/.test(tk) &&
        next && /^\d{1,2}$/.test(next)) {
      const d = new Date(TODAY.getFullYear(), QA_MONTHS[tk.slice(0, 3)], Number(next));
      if (d < TODAY) d.setFullYear(d.getFullYear() + 1); // "jan 20" in July = next January
      dateFrom(d);
      i++;
      continue;
    }
    if ((m = tk.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/))) {
      let y = m[3] ? Number(m[3]) : TODAY.getFullYear();
      if (y < 100) y += 2000;
      const d = new Date(y, Number(m[1]) - 1, Number(m[2]));
      if (!m[3] && d < TODAY) d.setFullYear(d.getFullYear() + 1);
      dateFrom(d);
      continue;
    }

    // times: "5pm", "5:30pm", "17:00", "noon"
    if ((m = tk.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/))) {
      let h = Number(m[1]) % 12;
      if (m[3] === 'pm') h += 12;
      out.dueTime = String(h).padStart(2, '0') + ':' + (m[2] || '00');
      continue;
    }
    if ((m = tk.match(/^(\d{1,2}):(\d{2})$/)) && Number(m[1]) < 24 && Number(m[2]) < 60) {
      out.dueTime = String(Number(m[1])).padStart(2, '0') + ':' + m[2];
      continue;
    }
    if (tk === 'noon') { out.dueTime = '12:00'; continue; }

    // type keywords set the type; kept out of the title unless nothing else
    // remains ("final exam" → type exam, title "Final Exam")
    if (QA_TYPES[tk] && (!out.type || QA_TYPES[tk] === out.type)) {
      out.type = QA_TYPES[tk];
      typeWords.push(raw);
      continue;
    }
    rest.push(raw);
  }

  out.title = rest.join(' ');
  if (!out.title && typeWords.length) {
    out.title = typeWords.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  }
  if (!out.type) out.type = out.courseId === 'todo' ? 'task' : 'homework';
  return out.title ? out : null;
}

function quickPreviewHTML() {
  const p = parseQuick(state.quickAdd && state.quickAdd.text);
  if (!p) {
    return `<div class="qa-empty">Type a title, then things like <b>ece391</b>, <b>fri</b>, <b>5pm</b>, <b>quiz</b> — in any order.</div>`;
  }
  const c = course(p.courseId);
  let when = 'Needs a date';
  if (p.dueDate) {
    const dt = parseDate(p.dueDate);
    when = weekdayName(dt) + ', ' + monthName(dt.getMonth()).slice(0, 3) + ' ' + dt.getDate();
    if (p.dueTime) when += ' · ' + timeLabel(p.dueTime);
  }
  return `
    <div class="qa-card" style="--cc:${c.color}">
      <span class="acard-swatch" style="background:${c.color}"></span>
      <div class="body-col">
        <div class="qa-title">${esc(p.title)}</div>
        <div class="qa-meta">${esc(c.name)} · ${esc(when)}</div>
      </div>
      <span class="type-pill">${esc(p.type)}</span>
    </div>`;
}

function quickAddHTML() {
  return `
    <div class="overlay qa" data-act="close-quick">
      <div class="qa-panel">
        <input id="qa-input" class="qa-input" placeholder="Quick add — e.g. “PS4 ece391 fri 5pm”"
               value="${esc(state.quickAdd.text)}" data-input="quickadd" autocomplete="off" spellcheck="false">
        <div class="qa-preview" id="qa-preview">${quickPreviewHTML()}</div>
        <div class="qa-hint"><span>↩ add · esc close</span><span>⌘K</span></div>
      </div>
    </div>`;
}

function quickAddSubmit() {
  const p = parseQuick(state.quickAdd && state.quickAdd.text);
  if (!p) return;
  state.assignments = state.assignments.concat([{
    id: 'm' + Date.now(),
    title: p.title,
    courseId: p.courseId,
    type: p.type,
    dueDate: p.dueDate,
    dueTime: p.dueTime || undefined,
    difficulty: 2,
    status: 'todo',
    source: 'manual',
    notes: '',
  }]);
  hapticTick('edge');
  animateModalClose(() => { state.quickAdd = null; });
}

function formModalHTML(mode) {
  const n = mode === 'edit' ? state.editA : state.newA;
  const courseOpts = [{ id: 'todo', name: '📌 To-Do (personal)' }].concat(state.courses).map((c) =>
    `<option value="${c.id}" ${c.id === n.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const typeOpts = TYPES.map((t) =>
    `<option value="${t}" ${t === n.type ? 'selected' : ''}>${t}</option>`).join('');
  const diffBtns = [1, 2, 3, 4, 5].map((d) => {
    const on = n.difficulty === d;
    const st = on ? `background:${DIFF[d - 1]};color:#fff;border-color:${DIFF[d - 1]}` : '';
    return `<button class="diff-btn" data-act="add-diff" data-n="${d}" style="${st}">${d}</button>`;
  }).join('');

  return `
    <div class="overlay" data-act="${mode === 'edit' ? 'close-edit' : 'close-add'}">
      <div class="modal">
        <div class="modal-title">${mode === 'edit' ? 'Edit Assignment' : 'New Assignment'}</div>

        <label class="field-label">Title</label>
        <input class="field mb14" value="${esc(n.title)}" data-input="new-title" placeholder="e.g. Problem Set 3">

        <div class="frow">
          <div class="grow">
            <label class="field-label">Course</label>
            <select class="field" data-input="new-course">${courseOpts}</select>
          </div>
          <div class="w130">
            <label class="field-label">Type</label>
            <select class="field cap" data-input="new-type">${typeOpts}</select>
          </div>
        </div>

        <div class="frow">
          <div class="grow">
            <label class="field-label">Due date</label>
            <input type="date" class="field" value="${esc(n.dueDate)}" data-input="new-date">
          </div>
          <div class="w130">
            <label class="field-label">Time</label>
            <input type="time" class="field" value="${esc(n.dueTime)}" data-input="new-time">
          </div>
        </div>

        <label class="field-label" style="margin-bottom:7px;">Difficulty</label>
        <div class="diff-picker">${diffBtns}</div>

        <div class="repeat-row" data-act="add-repeats" style="margin-bottom:${n.repeats ? '14px' : '16px'}">
          <span class="repeat-label">Repeats</span>
          <span class="switch ${n.repeats ? 'on' : ''}"><span class="switch-knob"></span></span>
        </div>

        ${n.repeats ? `
        <div class="frow ${n.freq === 'weekly' ? 'mb14' : 'mb16'}">
          <div class="grow">
            <label class="field-label">Every</label>
            <select class="field" data-input="new-freq">
              <option value="weekly" ${n.freq === 'weekly' ? 'selected' : ''}>Week</option>
              <option value="daily" ${n.freq === 'daily' ? 'selected' : ''}>Day</option>
              <option value="monthly" ${n.freq === 'monthly' ? 'selected' : ''}>Month</option>
            </select>
          </div>
          <div class="grow">
            <label class="field-label">Until</label>
            <input type="date" class="field" value="${esc(n.until)}" data-input="new-until">
          </div>
        </div>
        ${n.freq === 'weekly' ? `
        <label class="field-label" style="margin-bottom:7px;">On days <span class="field-hint">optional — for MWF / TuTh schedules</span></label>
        <div class="byday-row mb16">
          ${DAY_ABBR.map((l, d) => `
            <button class="byday-btn ${(n.byDay || []).includes(d) ? 'on' : ''}" data-act="add-byday" data-d="${d}">${l[0]}</button>`).join('')}
        </div>` : ''}` : ''}

        <label class="field-label">Notes</label>
        <textarea class="field mb16" rows="3" data-input="new-notes" placeholder="Optional — chapters, format, links…">${esc(n.notes || '')}</textarea>

        <div class="modal-foot">
          <button class="btn-secondary" data-act="${mode === 'edit' ? 'close-edit-btn' : 'close-add-btn'}">Cancel</button>
          <button class="btn-confirm" data-act="${mode === 'edit' ? 'save-edit' : 'save-add'}">${mode === 'edit' ? 'Save' : 'Add'}</button>
        </div>
      </div>
    </div>`;
}

function detailModalHTML() {
  const occ = occurrences();
  const found = occ.find((o) => o.id === state.detailId) ||
    state.assignments.find((a) => a.id === state.detailId);
  if (!found) { state.detailId = null; return ''; }

  const c = course(found.courseId);
  const done = found.status === 'done';
  let dueLabel = 'Needs a date';
  if (found.dueDate) {
    const dt = parseDate(found.dueDate);
    dueLabel = weekdayName(dt) + ', ' + monthName(dt.getMonth()).slice(0, 3) + ' ' + dt.getDate() +
      (found.dueTime ? ' · ' + timeLabel(found.dueTime) : '');
  }

  return `
    <div class="overlay" data-act="close-detail">
      <div class="modal detail">
        <button class="btn-edit" data-act="detail-edit" data-base="${found._baseId || found.id}">Edit</button>
        <div class="detail-course">
          <span class="detail-swatch" style="background:${c.color}"></span>
          <span class="detail-coursename">${esc(c.name)} · <span class="cap">${esc(found.type)}</span></span>
        </div>
        <div class="detail-title ${done ? 'done' : ''}">${esc(found.title)}</div>

        <div class="detail-rows">
          <div class="detail-row"><span class="detail-key">Due</span><span class="detail-val">${esc(dueLabel)}</span></div>
          ${found.recurrence ? `<div class="detail-row"><span class="detail-key">Repeats</span><span class="detail-val cap">${esc(recurLabel(found.recurrence))}</span></div>` : ''}
          <div class="detail-row"><span class="detail-key">Difficulty</span>${dotsHTML(found.difficulty, 9)}</div>
          <div class="detail-row"><span class="detail-key">Source</span><span class="detail-val">${found.source === 'syllabus' ? 'From syllabus' : 'Added manually'}</span></div>
        </div>

        ${found.notes ? `<div class="detail-notes">${esc(found.notes)}</div>` : ''}

        <div class="detail-actions">
          <button class="btn-done ${done ? 'undone' : ''}" data-act="detail-toggle-done" data-id="${found.id}" data-base="${found._baseId || found.id}">${done ? 'Mark as To-Do' : 'Mark Done'}</button>
          <button class="btn-ics" data-act="detail-export" title="Export to Apple Calendar">.ics</button>
          ${found._recurring ? '' : `<button class="btn-delete" data-act="detail-delete" data-base="${found._baseId || found.id}">Delete</button>`}
        </div>
        ${found._recurring ? `
        <div class="detail-actions detail-del-row">
          <button class="btn-delete" data-act="detail-delete-occ" data-base="${found._baseId}" data-date="${found.dueDate}" title="Remove only this date">Delete this date</button>
          <button class="btn-delete" data-act="detail-delete" data-base="${found._baseId}" title="Remove every occurrence">Delete series</button>
        </div>` : ''}
      </div>
    </div>`;
}

// ---------- import logic ----------
function readFile(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      buildReview(JSON.parse(r.result));
    } catch (e) {
      state.importError = 'Could not parse that file — is it valid JSON?';
      render();
    }
  };
  r.readAsText(file);
}

function buildReview(j) {
  if (!j || !j.course || !Array.isArray(j.assignments)) {
    state.importError = 'File is missing a "course" or "assignments" field.';
    render();
    return;
  }
  const items = j.assignments.map((a) => Object.assign({}, a, { include: true, type: a.type || 'homework' }));
  // same course code as an existing course = an update, not a new class —
  // confirming will replace that course's items rather than pile on duplicates
  const existing = state.courses.find((c) => c.code && c.code === (j.course.code || ''));
  state.review = {
    name: j.course.name || 'Untitled course',
    code: j.course.code || '',
    color: /^#[0-9a-fA-F]{3,8}$/.test(j.course.color || '') ? j.course.color : '#0a84ff',
    existingId: existing ? existing.id : null,
    existingCount: existing ? state.assignments.filter((a) => a.courseId === existing.id).length : 0,
    _raw: j,
    items,
  };
  state.importError = '';
  state.view = 'import';
  render();
}

function confirmReview() {
  const r = state.review;
  if (!r) return;
  const raw = r._raw;
  let cid = (state.courses.find((c) => c.code && c.code === raw.course.code) || {}).id;
  if (cid) {
    // updating an existing course: swap out its items, keep its identity
    // (name/color may have been customized in the course editor)
    state.assignments = state.assignments.filter((a) => a.courseId !== cid);
  } else {
    cid = 'c' + Date.now();
    state.courses = state.courses.concat([{ id: cid, name: r.name, code: r.code, color: r.color }]);
  }
  const adds = [];
  r.items.forEach((it, i) => {
    if (!it.include) return;
    const a = {
      id: 'i' + Date.now() + '_' + i,
      title: it.title,
      courseId: cid,
      type: it.type || 'homework',
      dueDate: it.dueDate || null,
      dueTime: it.dueTime,
      difficulty: Math.min(5, Math.max(1, it.difficulty || 1)),
      status: 'todo',
      source: 'syllabus',
      notes: it.notes || '',
    };
    if (it.recurrence) a.recurrence = it.recurrence;
    adds.push(a);
  });
  if (Array.isArray(raw.gradeWeights) && raw.gradeWeights.length) {
    // on re-import, carry entered scores over to same-named categories
    const prev = state.grades[cid] || [];
    const cats = raw.gradeWeights.map((g, i) => {
      const old = prev.find((p) => String(p.name).toLowerCase() === String(g.name || '').toLowerCase());
      return {
        id: 'g' + Date.now() + '_' + i,
        name: g.name || 'Category',
        weight: parseFloat(g.weight) || 0,
        score: old && (old.score === 0 || old.score) ? old.score : '',
      };
    });
    state.grades = Object.assign({}, state.grades, { [cid]: cats });
  }
  state.assignments = state.assignments.concat(adds);
  state.review = null;
  state.view = 'month';
  render();
}

// ---------- file export (ICS / backup) ----------
// Tauri: native save dialog + fs write; browser fallback: download
async function saveTextAs(text, filename, filterName, ext, mime) {
  const t = window.__TAURI__;
  if (t && t.dialog && t.fs) {
    try {
      const path = await t.dialog.save({
        defaultPath: filename,
        filters: [{ name: filterName, extensions: [ext] }],
      });
      if (path) await t.fs.writeTextFile(path, text);
    } catch (e) {
      console.error('save failed', e);
    }
  } else {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}

async function exportICS(list, filename) {
  const pad = (n) => String(n).padStart(2, '0');
  let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Semester//EN\r\n';
  for (const a of list) {
    if (!a.dueDate) continue;
    const [y, m, d] = a.dueDate.split('-').map(Number);
    let hh = 0, mm = 0;
    if (a.dueTime) [hh, mm] = a.dueTime.split(':').map(Number);
    const dt = y + pad(m) + pad(d) + 'T' + pad(hh) + pad(mm) + '00';
    ics += 'BEGIN:VEVENT\r\nUID:' + a.id + '@semester\r\nDTSTART:' + dt + '\r\nDTEND:' + dt +
      '\r\nSUMMARY:' + (course(a.courseId).code + ': ' + a.title) +
      '\r\nDESCRIPTION:' + (a.notes || '').replace(/\n/g, ' ') + '\r\nEND:VEVENT\r\n';
  }
  ics += 'END:VCALENDAR\r\n';
  await saveTextAs(ics, filename || 'assignment.ics', 'Calendar', 'ics', 'text/calendar');
}

// ---------- backup / restore ----------
function backupJSON() {
  return JSON.stringify({
    app: 'semester',
    version: 1,
    exportedAt: new Date().toISOString(),
    term: state.term,
    courses: state.courses,
    assignments: state.assignments,
    grades: state.grades,
    hidden: state.hidden,
    gradeCourse: state.gradeCourse,
  }, null, 2);
}

function restoreBackup(j) {
  if (!j || !Array.isArray(j.courses) || !Array.isArray(j.assignments)) {
    state.dataError = 'That file isn’t a Semester backup (missing "courses"/"assignments" arrays).';
    render();
    return;
  }
  state.dataError = '';
  const prev = {
    term: state.term, courses: state.courses, assignments: state.assignments,
    grades: state.grades, hidden: state.hidden, gradeCourse: state.gradeCourse,
  };
  state.term = j.term || null;
  state.courses = j.courses;
  state.assignments = j.assignments;
  state.grades = j.grades || {};
  state.hidden = j.hidden || {};
  state.gradeCourse = j.gradeCourse || null;
  state.courseEdit = null;
  render();
  showUndo('Backup restored', () => Object.assign(state, prev));
}

// ---------- syllabus prompt ----------
function PROMPT() {
  return `You are helping me import my class into an assignment tracker.
I will paste a course syllabus. Read it and output ONE JSON object — no prose, no markdown fences — matching this exact schema:

{
  "version": 1,
  "course": { "name": "", "code": "", "color": "#3b82f6" },
  "gradeWeights": [
    { "name": "Homework", "weight": 30 }
  ],
  "assignments": [
    {
      "title": "",
      "dueDate": "YYYY-MM-DD or null if TBD",
      "dueTime": "HH:MM (24h, optional)",
      "difficulty": 1,
      "type": "homework | quiz | exam | project | reading",
      "notes": "",
      "recurrence": { "frequency": "weekly", "interval": 1, "byDay": ["Mon", "Wed", "Fri"], "until": "YYYY-MM-DD" }
    }
  ]
}

Rules:
- One file per course. Pick a distinct hex "color" for the course.
- "gradeWeights" is the grading breakdown from the syllabus (each category with its percent weight; they should sum to 100). If the syllabus has no breakdown, use an empty array.
- If a due date is unknown or says "TBD", set "dueDate": null.
- For anything that repeats (weekly quiz, reading), use ONE entry with a "recurrence" block instead of many rows. Omit "recurrence" for one-off items.
- For things tied to class meetings on fixed weekdays (MWF lecture prep, TuTh discussion), set "byDay" to those weekday names and "dueDate" to the first meeting. Omit "byDay" when it repeats on a single weekday.
- difficulty is 1–5:  1=under an hour · 2=a couple hours · 3=a solid evening · 4=multi-day · 5=major exam/project.
- Use the assignment's real title. Keep "notes" short (chapters, page counts, format).

Here is my syllabus:
[PASTE SYLLABUS HERE]`;
}

function SAMPLE() {
  const y = TODAY.getFullYear();
  const base = new Date(TODAY);
  const d = (offset) => { const dt = new Date(base); dt.setDate(base.getDate() + offset); return fmt(dt); };
  return {
    version: 1,
    course: { name: 'Linear Algebra', code: 'MATH 415', color: '#5e5ce6' },
    gradeWeights: [
      { name: 'Homework', weight: 20 },
      { name: 'Quizzes', weight: 10 },
      { name: 'Midterm 1', weight: 20 },
      { name: 'Midterm 2', weight: 20 },
      { name: 'Final Exam', weight: 30 },
    ],
    assignments: [
      { title: 'Homework 1', dueDate: d(5), dueTime: '23:59', difficulty: 2, type: 'homework', notes: '§1.1–1.3' },
      { title: 'Homework 2', dueDate: d(12), dueTime: '23:59', difficulty: 2, type: 'homework', notes: '' },
      { title: 'Weekly Gradescope Quiz', dueDate: d(1), difficulty: 1, type: 'quiz', notes: '', recurrence: { frequency: 'weekly', interval: 1, until: termEnd() } },
      { title: 'Discussion Worksheet', dueDate: d(2), dueTime: '14:00', difficulty: 1, type: 'homework', notes: 'Due in section.', recurrence: { frequency: 'weekly', interval: 1, byDay: ['Tue', 'Thu'], until: termEnd() } },
      { title: 'Midterm 1', dueDate: d(17), dueTime: '19:00', difficulty: 5, type: 'exam', notes: 'Ch. 1–3, in DCL 1320.' },
      { title: 'Final Exam', dueDate: null, difficulty: 5, type: 'exam', notes: 'Date TBD — set by registrar.' },
    ],
  };
}

// ---------- clipboard ----------
async function copyPrompt() {
  const text = PROMPT();
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  state.copied = true;
  render();
  setTimeout(() => { state.copied = false; if (state.view === 'import') render(); }, 1600);
}

function goToday() {
  state.month = TODAY.getMonth();
  state.year = TODAY.getFullYear();
  state.weekOffset = 0;
  if (state.view !== 'month' && state.view !== 'week') state.view = 'month';
  render();
}

// ---------- undo toast ----------
// one toast at a time, bottom center; Undo runs the restore closure
let toastTimer = null;
function showUndo(msg, restore) {
  const old = $('#toast');
  if (old) old.remove();
  clearTimeout(toastTimer);
  const el = document.createElement('div');
  el.id = 'toast';
  el.className = 'toast';
  el.innerHTML = `<span class="toast-msg">${esc(msg)}</span><button class="toast-undo">Undo</button>`;
  el.querySelector('.toast-undo').addEventListener('click', () => {
    dismissToast();
    restore();
    render();
  });
  document.body.appendChild(el);
  toastTimer = setTimeout(dismissToast, 6000);
}
function dismissToast() {
  clearTimeout(toastTimer);
  const el = $('#toast');
  if (!el) return;
  el.classList.add('out');
  setTimeout(() => el.remove(), 240);
}

// ---------- grade helpers ----------
function updateCat(cid, id, field, val) {
  const arr = (state.grades[cid] || []).map((c) => (c.id === id ? Object.assign({}, c, { [field]: val }) : c));
  state.grades = Object.assign({}, state.grades, { [cid]: arr });
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  switch (act) {
    case 'view': {
      state.view = el.dataset.view;
      state.confirmNewTerm = false;
      state.dataError = '';
      render();
      break;
    }
    case 'prev-month': navCalendar(-1); break;
    case 'next-month': navCalendar(1); break;
    case 'go-today': goToday(); break;
    case 'theme': {
      state.theme = state.theme === 'light' ? 'dark' : 'light';
      render();
      break;
    }
    case 'open-add': {
      state.newA = blankNew();
      state.showAdd = true;
      render();
      break;
    }
    case 'add-todo': {
      state.newA = blankNew();
      state.newA.courseId = 'todo';
      state.newA.type = 'task';
      state.showAdd = true;
      render();
      break;
    }
    case 'day-add': {
      state.newA = blankNew();
      state.newA.dueDate = el.dataset.date;
      state.showAdd = true;
      render();
      break;
    }
    case 'detail': {
      state.detailId = el.dataset.id;
      render();
      break;
    }
    case 'day-more': {
      state.dayPopover = el.dataset.date;
      render();
      break;
    }
    case 'close-daypop': {
      if (e.target !== el) break;
      animateModalClose(() => { state.dayPopover = null; });
      break;
    }
    case 'toggle-done': {
      if (el.dataset.done === '1') {
        toggleDone(el.dataset.id, el.dataset.base); // unchecking is instant
      } else {
        playCompleteAnim(el);
      }
      break;
    }
    case 'agenda-filter': {
      state.agendaFilter = el.dataset.type;
      renderMain();
      break;
    }
    case 'legend-toggle': {
      const id = el.dataset.id;
      state.hidden = Object.assign({}, state.hidden, { [id]: !state.hidden[id] });
      render();
      break;
    }
    case 'grade-add': {
      const cid = gradeCourseId();
      if (!cid) break;
      const arr = (state.grades[cid] || []).slice();
      arr.push({ id: 'g' + Date.now(), name: 'New category', weight: 0, score: '' });
      state.grades = Object.assign({}, state.grades, { [cid]: arr });
      render();
      break;
    }
    case 'grade-remove': {
      const cid = gradeCourseId();
      state.grades = Object.assign({}, state.grades, {
        [cid]: (state.grades[cid] || []).filter((c) => c.id !== el.dataset.id),
      });
      render();
      break;
    }
    case 'course-edit': {
      state.view = 'courses'; // reachable straight from the sidebar course list now
      state.courseEdit = el.dataset.id;
      state.courseJson = buildCourseJson(el.dataset.id);
      state.courseJsonError = '';
      state.courseJsonSaved = false;
      state.confirmDeleteCourse = false;
      render();
      break;
    }
    case 'course-back': {
      state.courseEdit = null;
      state.courseJsonError = '';
      state.confirmDeleteCourse = false;
      render();
      break;
    }
    case 'course-color': {
      const cid = state.courseEdit;
      state.courses = state.courses.map((c) => c.id === cid ? Object.assign({}, c, { color: el.dataset.color }) : c);
      state.courseJson = buildCourseJson(cid);
      render();
      break;
    }
    case 'course-json-save': applyCourseJson(); break;
    case 'course-json-revert': {
      state.courseJson = buildCourseJson(state.courseEdit);
      state.courseJsonError = '';
      render();
      break;
    }
    case 'course-delete': {
      if (!state.confirmDeleteCourse) {
        state.confirmDeleteCourse = true;
        render();
        break;
      }
      const cid = state.courseEdit;
      const savedCourse = state.courses.find((c) => c.id === cid);
      const savedItems = state.assignments.filter((a) => a.courseId === cid);
      const savedGrades = state.grades[cid];
      const savedHidden = state.hidden[cid];
      state.courses = state.courses.filter((c) => c.id !== cid);
      state.assignments = state.assignments.filter((a) => a.courseId !== cid);
      const g = Object.assign({}, state.grades); delete g[cid]; state.grades = g;
      const h = Object.assign({}, state.hidden); delete h[cid]; state.hidden = h;
      state.courseEdit = null;
      state.confirmDeleteCourse = false;
      render();
      if (savedCourse) {
        showUndo(`Deleted ${savedCourse.name}`, () => {
          state.courses = state.courses.concat([savedCourse]);
          state.assignments = state.assignments.concat(savedItems);
          if (savedGrades) state.grades = Object.assign({}, state.grades, { [cid]: savedGrades });
          if (savedHidden) state.hidden = Object.assign({}, state.hidden, { [cid]: savedHidden });
        });
      }
      break;
    }
    case 'course-export-ics': {
      const cid = state.courseEdit;
      const c = course(cid);
      const list = occurrences(true).filter((o) => o.courseId === cid);
      const fname = String(c.code || c.name || 'course').trim().replace(/[^\w-]+/g, '-').toLowerCase() + '.ics';
      exportICS(list, fname);
      break;
    }
    case 'backup-export': {
      saveTextAs(backupJSON(), 'semester-backup-' + fmt(TODAY) + '.json', 'Semester backup', 'json', 'application/json');
      break;
    }
    case 'new-semester': {
      if (!state.confirmNewTerm) {
        state.confirmNewTerm = true;
        render();
        break;
      }
      // stash a full snapshot in localStorage as a second safety net,
      // beyond the 6-second undo toast
      try { localStorage.setItem(STORE_KEY + '-last-archive', backupJSON()); } catch (e) { /* full */ }
      const prev = {
        term: state.term, courses: state.courses, assignments: state.assignments,
        grades: state.grades, hidden: state.hidden, gradeCourse: state.gradeCourse,
        notified: state.notified,
      };
      state.term = null;
      state.courses = [];
      state.assignments = [];
      state.grades = {};
      state.hidden = {};
      state.gradeCourse = null;
      state.notified = {};
      state.courseEdit = null;
      state.confirmNewTerm = false;
      state.view = 'import';
      render();
      showUndo('Semester cleared — fresh start', () => Object.assign(state, prev));
      break;
    }
    case 'copy-prompt': copyPrompt(); break;
    case 'load-sample': buildReview(SAMPLE()); break;
    case 'review-toggle': {
      const it = state.review.items[Number(el.dataset.i)];
      it.include = !it.include;
      render();
      break;
    }
    case 'review-cancel': {
      state.review = null;
      state.importError = '';
      render();
      break;
    }
    case 'review-confirm': confirmReview(); break;
    case 'close-add': {
      if (e.target !== el) break; // only direct backdrop clicks close
      animateModalClose(() => { state.showAdd = false; });
      break;
    }
    case 'close-add-btn': {
      animateModalClose(() => { state.showAdd = false; });
      break;
    }
    case 'save-add': {
      const n = state.newA;
      if (!n.title.trim()) break;
      const a = {
        id: 'm' + Date.now(),
        title: n.title.trim(),
        courseId: n.courseId,
        type: n.type,
        dueDate: n.dueDate || null,
        dueTime: n.dueTime,
        difficulty: n.difficulty,
        status: 'todo',
        source: 'manual',
        notes: n.notes || '',
      };
      if (n.repeats) {
        a.recurrence = { frequency: n.freq, interval: 1, until: n.until };
        if (n.freq === 'weekly' && n.byDay && n.byDay.length) a.recurrence.byDay = n.byDay.slice();
      }
      state.assignments = state.assignments.concat([a]);
      state.showAdd = false;
      render();
      break;
    }
    case 'add-diff': {
      formTarget().difficulty = Number(el.dataset.n);
      render();
      break;
    }
    case 'add-repeats': {
      const ft = formTarget();
      ft.repeats = !ft.repeats;
      render();
      break;
    }
    case 'add-byday': {
      const ft = formTarget();
      const d = Number(el.dataset.d);
      ft.byDay = (ft.byDay || []).includes(d)
        ? ft.byDay.filter((x) => x !== d)
        : (ft.byDay || []).concat([d]).sort();
      render();
      break;
    }
    case 'close-detail': {
      if (e.target !== el) break;
      animateModalClose(() => { state.detailId = null; });
      break;
    }
    case 'close-quick': {
      if (e.target !== el) break;
      animateModalClose(() => { state.quickAdd = null; });
      break;
    }
    case 'detail-toggle-done': {
      toggleDone(el.dataset.id, el.dataset.base);
      break;
    }
    case 'detail-edit': {
      const a = state.assignments.find((x) => x.id === el.dataset.base);
      if (!a) break;
      state.editA = {
        baseId: a.id,
        title: a.title,
        courseId: a.courseId,
        type: a.type,
        dueDate: a.dueDate || '',
        dueTime: a.dueTime || '',
        difficulty: a.difficulty,
        repeats: !!a.recurrence,
        freq: (a.recurrence && a.recurrence.frequency) || 'weekly',
        byDay: a.recurrence ? [...normalizeByDay(a.recurrence.byDay)].sort() : [],
        until: (a.recurrence && a.recurrence.until) || termEnd(),
        notes: a.notes || '',
      };
      state.detailId = null;
      render();
      break;
    }
    case 'close-edit': {
      if (e.target !== el) break;
      animateModalClose(() => { state.editA = null; });
      break;
    }
    case 'close-edit-btn': {
      animateModalClose(() => { state.editA = null; });
      break;
    }
    case 'save-edit': {
      const n = state.editA;
      if (!n || !n.title.trim()) break;
      state.assignments = state.assignments.map((a) => {
        if (a.id !== n.baseId) return a;
        const upd = Object.assign({}, a, {
          title: n.title.trim(),
          courseId: n.courseId,
          type: n.type,
          dueDate: n.dueDate || null,
          dueTime: n.dueTime,
          difficulty: n.difficulty,
          notes: n.notes || '',
        });
        if (n.repeats) {
          upd.recurrence = { frequency: n.freq, interval: 1, until: n.until };
          if (n.freq === 'weekly' && n.byDay && n.byDay.length) upd.recurrence.byDay = n.byDay.slice();
        } else delete upd.recurrence;
        return upd;
      });
      state.editA = null;
      refreshCourseJson();
      render();
      break;
    }
    case 'detail-delete': {
      const base = el.dataset.base;
      const removed = state.assignments.find((a) => a.id === base);
      state.assignments = state.assignments.filter((a) => a.id !== base);
      state.detailId = null;
      refreshCourseJson();
      render();
      if (removed) {
        showUndo(`Deleted “${removed.title}”${removed.recurrence ? ' (whole series)' : ''}`, () => {
          state.assignments = state.assignments.concat([removed]);
          refreshCourseJson();
        });
      }
      break;
    }
    case 'detail-delete-occ': {
      // drop just this date from a recurring series (recorded in exDates)
      const base = el.dataset.base, date = el.dataset.date;
      const title = (state.assignments.find((a) => a.id === base) || {}).title || '';
      state.assignments = state.assignments.map((a) => {
        if (a.id !== base) return a;
        const ex = Object.assign({}, a.exDates || {}, { [date]: true });
        return Object.assign({}, a, { exDates: ex });
      });
      state.detailId = null;
      refreshCourseJson();
      render();
      showUndo(`Removed one date from “${title}”`, () => {
        state.assignments = state.assignments.map((a) => {
          if (a.id !== base) return a;
          const ex = Object.assign({}, a.exDates);
          delete ex[date];
          return Object.assign({}, a, { exDates: ex });
        });
      });
      break;
    }
    case 'detail-export': {
      const found = occurrences().find((o) => o.id === state.detailId) ||
        state.assignments.find((a) => a.id === state.detailId);
      if (found) exportICS([found]);
      break;
    }
  }
});

document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-input]');
  if (!el) return;
  switch (el.dataset.input) {
    case 'quickadd': {
      if (!state.quickAdd) break;
      state.quickAdd.text = el.value;
      const pv = $('#qa-preview');
      if (pv) pv.innerHTML = quickPreviewHTML(); // no full render: keep focus
      break;
    }
    case 'new-title': formTarget().title = el.value; break;
    case 'new-notes': formTarget().notes = el.value; break;
    case 'course-name':
    case 'course-code': {
      const field = el.dataset.input === 'course-name' ? 'name' : 'code';
      state.courses = state.courses.map((c) =>
        c.id === state.courseEdit ? Object.assign({}, c, { [field]: el.value }) : c);
      state.courseJson = buildCourseJson(state.courseEdit);
      saveState(); // no re-render: keep typing focus; other views refresh on next render
      break;
    }
    case 'course-json': state.courseJson = el.value; break;
    case 'term-label': {
      state.term = Object.assign({}, state.term || { end: termEnd() }, { label: el.value });
      saveState(); // no re-render: keep typing focus
      break;
    }
    case 'grade-name': updateCat(gradeCourseId(), el.dataset.id, 'name', el.value); saveState(); break;
    case 'grade-weight':
    case 'grade-score': {
      const cid = gradeCourseId();
      updateCat(cid, el.dataset.id, el.dataset.input === 'grade-weight' ? 'weight' : 'score', el.value);
      const summary = $('#grade-summary');
      if (summary) summary.innerHTML = gradeSummaryHTML(cid);
      const targets = $('#grade-targets-wrap');
      if (targets) targets.innerHTML = gradeTargetsHTML(cid);
      saveState();
      break;
    }
  }
});

document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-input]');
  if (!el) return;
  switch (el.dataset.input) {
    case 'new-course': formTarget().courseId = el.value; break;
    case 'new-type': formTarget().type = el.value; break;
    case 'new-date': formTarget().dueDate = el.value; break;
    case 'new-time': formTarget().dueTime = el.value; break;
    case 'new-freq': formTarget().freq = el.value; break;
    case 'new-until': formTarget().until = el.value; break;
    case 'grade-course': {
      state.gradeCourse = el.value;
      render();
      break;
    }
    case 'course-color-custom': {
      const cid = state.courseEdit;
      state.courses = state.courses.map((c) => c.id === cid ? Object.assign({}, c, { color: el.value }) : c);
      state.courseJson = buildCourseJson(cid);
      render();
      break;
    }
    case 'needs-date': {
      const v = el.value;
      if (!v) break;
      const id = el.dataset.id;
      state.assignments = state.assignments.map((a) =>
        a.id === id ? Object.assign({}, a, { dueDate: v }) : a);
      render();
      break;
    }
    case 'import-file': {
      const f = el.files[0];
      if (f) readFile(f);
      break;
    }
    case 'term-end': {
      if (!el.value) break;
      state.term = Object.assign({}, state.term || { label: termLabel() }, { end: el.value });
      render();
      break;
    }
    case 'restore-file': {
      const f = el.files[0];
      if (!f) break;
      const r = new FileReader();
      r.onload = () => {
        try {
          restoreBackup(JSON.parse(r.result));
        } catch (err) {
          state.dataError = 'Could not parse that file — is it valid JSON?';
          render();
        }
      };
      r.readAsText(f);
      break;
    }
  }
});

// ---------- keyboard shortcuts ----------
function anyModalOpen() {
  return !!(state.showAdd || state.editA || state.detailId || state.quickAdd || state.dayPopover);
}
function closeTopModal() {
  if (state.quickAdd) animateModalClose(() => { state.quickAdd = null; });
  else if (state.editA) animateModalClose(() => { state.editA = null; });
  else if (state.showAdd) animateModalClose(() => { state.showAdd = false; });
  else if (state.detailId) animateModalClose(() => { state.detailId = null; });
  else if (state.dayPopover) animateModalClose(() => { state.dayPopover = null; });
}

document.addEventListener('keydown', (e) => {
  const cmd = e.metaKey || e.ctrlKey;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);

  // span checkboxes activate like real ones
  if ((e.key === ' ' || e.key === 'Enter') && e.target.getAttribute &&
      e.target.getAttribute('role') === 'checkbox') {
    e.preventDefault();
    e.target.click();
    return;
  }

  if (e.key === 'Escape') {
    if (anyModalOpen()) { e.preventDefault(); closeTopModal(); }
    return;
  }
  if (cmd && !e.shiftKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    state.newA = blankNew();
    state.showAdd = true;
    state.quickAdd = null;
    render();
    return;
  }
  if (cmd && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (state.quickAdd) { animateModalClose(() => { state.quickAdd = null; }); return; }
    state.quickAdd = { text: '' };
    render();
    requestAnimationFrame(() => { const i = $('#qa-input'); if (i) i.focus(); });
    return;
  }
  if (cmd && ['1', '2', '3'].includes(e.key)) {
    e.preventDefault();
    state.view = ['month', 'week', 'agenda'][Number(e.key) - 1];
    render();
    return;
  }
  if (e.key === 'Enter' && state.quickAdd) {
    e.preventDefault();
    quickAddSubmit();
    return;
  }
  // Enter submits the open form (from the notes textarea only with ⌘Enter)
  if (e.key === 'Enter' && (state.showAdd || state.editA) && (cmd || e.target.tagName !== 'TEXTAREA')) {
    e.preventDefault();
    const btn = document.querySelector('[data-act="save-add"], [data-act="save-edit"]');
    if (btn) btn.click();
    return;
  }
  if (typing || anyModalOpen() || cmd) return;

  const onCal = state.view === 'month' || state.view === 'week';
  if (e.key === 'ArrowLeft' && onCal) { e.preventDefault(); navCalendar(-1); }
  else if (e.key === 'ArrowRight' && onCal) { e.preventDefault(); navCalendar(1); }
  else if (e.key.toLowerCase() === 't') goToday();
});

// two-finger scroll drives the calendar track 1:1, then snaps to the nearest
// month (vertical) / week (horizontal). Crossing a full panel commits it
// immediately, so fast flings walk through several months/weeks fluidly.
let snapDrag = 0, snapTimer = null;

document.addEventListener('wheel', (e) => {
  if (state.view !== 'month' && state.view !== 'week') return;
  if (anyModalOpen()) return;
  if (!e.target.closest || !e.target.closest('#main')) return;

  let delta;
  if (state.view === 'month') {
    delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  } else {
    // week view scrolls its list vertically; horizontal drags the carousel
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    delta = e.deltaX;
  }
  e.preventDefault();
  onSnapWheel(delta);
}, { passive: false });

let snapD = 0;        // panel distance, measured once per gesture (avoids layout reads per event)
let snapRaf = false;  // rAF batching: many wheel events per frame, one style write

function onSnapWheel(delta) {
  // new gesture: measure geometry and, if the settle animation is mid-flight,
  // pick up from the track's current visual position instead of jumping
  if (snapDrag === 0) {
    snapD = panelDistance();
    const tr = trackEl();
    if (tr) {
      const t = getComputedStyle(tr).transform;
      if (t && t !== 'none') {
        const m = new DOMMatrixReadOnly(t);
        snapDrag = state.view === 'week' ? -m.m41 : -m.m42;
      }
    }
  }
  if (!snapD) return;

  snapDrag += delta * 1.6; // gain: calendar moves a bit faster than the fingers
  while (snapDrag >= snapD) { navCommit(1); snapDrag -= snapD; }
  while (snapDrag <= -snapD) { navCommit(-1); snapDrag += snapD; }
  applySnapDrag();
  clearTimeout(snapTimer);
  snapTimer = setTimeout(settleSnap, 100);
}

function applySnapDrag() {
  if (snapRaf) return;
  snapRaf = true;
  requestAnimationFrame(() => {
    snapRaf = false;
    const tr = trackEl();
    if (!tr) return;
    tr.style.transition = 'none';
    tr.style.transform = `translate${trackAxis()}(${-snapDrag}px)`;
  });
}

// gesture ended: snap to whichever panel is closest
function settleSnap() {
  const D = snapD || panelDistance();
  if (!D) { snapDrag = 0; return; }
  if (snapDrag >= D / 2) { navCommit(1); snapDrag -= D; }
  else if (snapDrag <= -D / 2) { navCommit(-1); snapDrag += D; }

  const tr = trackEl();
  if (!tr) { snapDrag = 0; return; }
  const axis = trackAxis();
  const residual = snapDrag;
  snapDrag = 0;
  tr.style.transition = 'none';
  tr.style.transform = `translate${axis}(${-residual}px)`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    tr.style.transition = 'transform .2s cubic-bezier(.22,.9,.3,1)';
    tr.style.transform = `translate${axis}(0)`;
  }));
}

// haptic knock when a vertical scroll hits the top or bottom of the page
let edgeLatchTop = false, edgeLatchBottom = false, edgeLastT = 0;
document.addEventListener('wheel', (e) => {
  if (state.view === 'month') return; // month flips instead of scrolling
  if (anyModalOpen()) return;
  if (!e.target.closest) return;
  const scroller = e.target.closest('.scrolly') || (e.target.closest('#main') && $('#main'));
  if (!scroller) return;
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;

  const t = Date.now();
  if (t - edgeLastT > 500) { edgeLatchTop = false; edgeLatchBottom = false; }
  edgeLastT = t;

  const canScroll = scroller.scrollHeight > scroller.clientHeight + 2;
  if (!canScroll) return;
  const atTop = scroller.scrollTop <= 1;
  const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;

  if (e.deltaY < -4 && atTop) {
    if (!edgeLatchTop) { hapticTick('edge'); edgeLatchTop = true; }
  } else if (e.deltaY > 4 && atBottom) {
    if (!edgeLatchBottom) { hapticTick('edge'); edgeLatchBottom = true; }
  } else {
    edgeLatchTop = false;
    edgeLatchBottom = false;
  }
}, { passive: true });

// ---------- drag & drop ----------
// two kinds share the listeners: syllabus JSON onto the import dropzone, and
// calendar cards onto another day (reschedule)
let dragOccId = null;   // occurrence id of the card being dragged, if any
let dragOverEl = null;  // day cell currently highlighted as the drop target

document.addEventListener('dragstart', (e) => {
  const card = e.target.closest && e.target.closest('.mchip[draggable], .wcard[draggable]');
  if (!card) return;
  dragOccId = card.dataset.id;
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', dragOccId); } catch (err) { /* older engines */ }
});
document.addEventListener('dragend', () => {
  dragOccId = null;
  for (const el of document.querySelectorAll('.dragging, .drop-target')) {
    el.classList.remove('dragging', 'drop-target');
  }
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  const zone = $('#dropzone');
  if (zone) zone.classList.toggle('over', !!(e.target.closest && e.target.closest('#dropzone')));
  if (dragOccId) {
    const day = e.target.closest && e.target.closest('.mday[data-date], .wday-row[data-date]');
    if (day !== dragOverEl) {
      if (dragOverEl) dragOverEl.classList.remove('drop-target');
      dragOverEl = day;
      if (day) day.classList.add('drop-target');
    }
  }
});
document.addEventListener('dragleave', (e) => {
  const zone = $('#dropzone');
  if (zone && !e.relatedTarget) zone.classList.remove('over');
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const zone = $('#dropzone');
  if (zone) zone.classList.remove('over');
  if (e.target.closest && e.target.closest('#dropzone')) {
    const f = e.dataTransfer.files[0];
    if (f) readFile(f);
    return;
  }
  const day = e.target.closest && e.target.closest('.mday[data-date], .wday-row[data-date]');
  if (dragOccId && day) moveOccurrence(dragOccId, day.dataset.date);
  dragOccId = null;
  dragOverEl = null;
});

// reschedule by drag: plain items just change dueDate; a recurring occurrence
// is detached from its series (exDate there, standalone copy on the new day)
function moveOccurrence(occId, newDate) {
  if (!newDate) return;
  if (occId.includes('@')) {
    const [base, oldDate] = occId.split('@');
    if (oldDate === newDate) return;
    const src = state.assignments.find((a) => a.id === base);
    if (!src) return;
    const single = {
      id: 'm' + Date.now(),
      title: src.title,
      courseId: src.courseId,
      type: src.type,
      dueDate: newDate,
      dueTime: src.dueTime,
      difficulty: src.difficulty,
      status: src.doneDates && src.doneDates[oldDate] ? 'done' : 'todo',
      source: src.source,
      notes: src.notes || '',
    };
    state.assignments = state.assignments
      .map((a) => a.id === base
        ? Object.assign({}, a, { exDates: Object.assign({}, a.exDates || {}, { [oldDate]: true }) })
        : a)
      .concat([single]);
  } else {
    const a = state.assignments.find((x) => x.id === occId);
    if (!a || a.dueDate === newDate) return;
    state.assignments = state.assignments.map((x) =>
      x.id === occId ? Object.assign({}, x, { dueDate: newDate }) : x);
  }
  hapticTick('align');
  const flip = captureFlip();
  render();
  playFlip(flip, null);
}

// ---------- due-soon notifications ----------
// while the app is open, anything unchecked that comes due within 3 hours
// triggers one macOS notification (all-day items count as due 11:59 PM)
const NOTIFY_AHEAD_MS = 3 * 3600 * 1000;

async function checkDueSoon() {
  const t = window.__TAURI__;
  const n = t && t.notification;
  if (!n) return;

  const now = new Date();
  const pending = [];
  for (const o of occurrences()) {
    if (o.status === 'done' || !o.dueDate) continue;
    const [hh, mm] = (o.dueTime || '23:59').split(':').map(Number);
    const due = parseDate(o.dueDate);
    due.setHours(hh, mm, 0, 0);
    const diff = due - now;
    const key = o.id + '|' + o.dueDate + 'T' + (o.dueTime || '23:59');
    if (diff > 0 && diff <= NOTIFY_AHEAD_MS && !state.notified[key]) pending.push({ o, key, due });
  }
  if (!pending.length) return;

  let granted = await n.isPermissionGranted();
  if (!granted) granted = (await n.requestPermission()) === 'granted';
  if (!granted) return;

  for (const { o, key, due } of pending) {
    const c = course(o.courseId);
    const hrs = Math.max(1, Math.round((due - now) / 3600000));
    n.sendNotification({
      title: '⏰ Due soon: ' + o.title,
      body: (c.name !== 'To-Do' ? c.name + ' · ' : '') +
        'due ' + timeLabel(o.dueTime || '23:59') + ' (' + hrs + 'h) — still unchecked',
    });
    state.notified[key] = true;
  }
  saveState();
}

async function initNotifications() {
  const t = window.__TAURI__;
  const n = t && t.notification;
  if (!n) return;
  try {
    if (!(await n.isPermissionGranted())) await n.requestPermission();
  } catch (e) { /* notifications unavailable */ }
  checkDueSoon();
  setInterval(checkDueSoon, 60 * 1000);
}

// TODAY is captured at boot; if the app stays open past midnight, overdue
// logic, countdowns, and the today highlight all go stale until it's refreshed
function refreshToday() {
  const t = startOfToday();
  if (sameDay(t, TODAY)) return;
  TODAY = t;
  render();
}
window.addEventListener('focus', refreshToday);
setInterval(refreshToday, 60 * 1000);

// ---------- boot ----------
loadState();
render();
initNotifications();
