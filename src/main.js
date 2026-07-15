// Semester — college assignment tracker (Tauri, vanilla JS)

const DIFF = ['#34c759', '#8bd34a', '#ffcc00', '#ff9f0a', '#ff3b30'];
const TYPES = ['task', 'homework', 'quiz', 'exam', 'project', 'reading'];
const STORE_KEY = 'semester-app-v1';

// personal to-dos live outside real courses but flow through the same pipeline
const TODO_COURSE = { id: 'todo', name: 'To-Do', code: '', color: '#ff2d55' };

const now = new Date();
const TODAY = new Date(now.getFullYear(), now.getMonth(), now.getDate());

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
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      for (const k of ['theme', 'courses', 'assignments', 'grades', 'hidden', 'gradeCourse', 'notified']) {
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
  const m = TODAY.getMonth();
  const season = m <= 4 ? 'Spring' : m <= 6 ? 'Summer' : 'Fall';
  return season + ' ' + TODAY.getFullYear();
}
function termEnd() {
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

// expand recurrences into dated occurrences, minus hidden courses
function occurrences() {
  const out = [];
  for (const a of state.assignments) {
    if (!a.dueDate) continue;
    if (a.recurrence) {
      const start = parseDate(a.dueDate);
      const until = parseDate(a.recurrence.until) || new Date(TODAY.getFullYear(), 11, 31);
      const step = a.recurrence.interval || 1;
      const freq = a.recurrence.frequency || 'weekly';
      let cur = new Date(start), i = 0;
      while (cur <= until && i < 120) {
        const ds = fmt(cur);
        out.push(Object.assign({}, a, {
          dueDate: ds,
          _recurring: true,
          _baseId: a.id,
          id: a.id + '@' + ds,
          // recurring occurrences are completed per-date, not on the base item
          status: a.doneDates && a.doneDates[ds] ? 'done' : 'todo',
        }));
        if (freq === 'daily') cur.setDate(cur.getDate() + step);
        else if (freq === 'monthly') cur.setMonth(cur.getMonth() + step);
        else cur.setDate(cur.getDate() + 7 * step);
        i++;
      }
    } else {
      out.push(Object.assign({}, a));
    }
  }
  return out.filter((o) => !state.hidden[o.courseId]);
}

function toggleDone(occId, baseId) {
  const base = baseId || occId;
  if (occId && occId.includes('@')) {
    // recurring occurrence: toggle just this date
    const date = occId.split('@')[1];
    state.assignments = state.assignments.map((a) => {
      if (a.id !== base) return a;
      const dd = Object.assign({}, a.doneDates || {});
      if (dd[date]) delete dd[date]; else dd[date] = true;
      return Object.assign({}, a, { doneDates: dd });
    });
  } else {
    state.assignments = state.assignments.map((a) =>
      a.id === base ? Object.assign({}, a, { status: a.status === 'done' ? 'todo' : 'done' }) : a
    );
  }
  render();
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

// ---------- render ----------
function render() {
  document.documentElement.dataset.theme = state.theme;
  renderTitlebar();
  renderSidebar();
  renderMain();
  renderModals();
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
  $('#header-title').textContent = title;

  $('#btn-import').classList.toggle('active', state.view === 'import');
  $('#btn-needs').classList.toggle('active', state.view === 'needs');
  $('#btn-theme').textContent = state.theme === 'dark' ? '☀' : '☾';

  const needs = state.assignments.filter((a) => !a.dueDate && !state.hidden[a.courseId]).length;
  const badge = $('#needs-badge');
  badge.hidden = needs === 0;
  badge.textContent = needs;
}

function renderSidebar() {
  const occ = occurrences();
  const todayStr = fmt(TODAY);
  const tomorrow = new Date(TODAY); tomorrow.setDate(TODAY.getDate() + 1);
  const in7 = new Date(TODAY); in7.setDate(TODAY.getDate() + 7);
  const upcoming = occ.filter((o) => o.dueDate >= todayStr && o.status !== 'done');
  const dueTomorrow = upcoming.filter((o) => o.dueDate === fmt(tomorrow));
  const dueWeek = upcoming.filter((o) => o.dueDate <= fmt(in7));

  let hardest = null;
  for (const o of upcoming) {
    if (!hardest || o.difficulty > hardest.difficulty ||
        (o.difficulty === hardest.difficulty && o.dueDate < hardest.dueDate)) hardest = o;
  }
  const exams = upcoming.filter((o) => o.type === 'exam')
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)).slice(0, 3);

  const legendHTML = state.courses.length
    ? state.courses.map((c) => `
      <button class="legend-btn" data-act="legend-toggle" data-id="${c.id}" style="opacity:${state.hidden[c.id] ? 0.4 : 1}">
        <span class="legend-swatch" style="background:${c.color}"></span>
        <span class="legend-name">${esc(c.name)}</span>
        <span class="legend-code">${esc(c.code)}</span>
      </button>`).join('')
    : `<div class="legend-empty">No courses yet — import a syllabus to get started.</div>`;

  let hardestHTML = `<div class="glance-none">Nothing upcoming</div>`;
  if (hardest) {
    const hc = course(hardest.courseId);
    hardestHTML = `
      <div class="glance-card" data-act="detail" data-id="${hardest.id}" style="border-left:3px solid ${hc.color}">
        <div class="gc-body">
          <div class="gc-title">${esc(hardest.title)}</div>
          <div class="gc-meta">${esc(hc.code)} · ${countdownLabel(hardest.dueDate)}</div>
        </div>
        ${dotsHTML(hardest.difficulty, 6, 'tight')}
      </div>`;
  }

  let examsHTML = `<div class="glance-none">No exams on the horizon</div>`;
  if (exams.length) {
    examsHTML = exams.map((o) => {
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
  }

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
      <span class="nav-icon">％</span> Grade Calculator
    </button>
    <button class="nav-btn ${state.view === 'courses' ? 'active' : ''}" data-act="view" data-view="courses">
      <span class="nav-icon">▦</span> Courses
    </button>
    <button class="nav-btn ${state.view === 'todos' ? 'active' : ''}" data-act="view" data-view="todos">
      <span class="nav-icon">☑</span> To-Dos
    </button>

    <div class="sb-head-row">
      <span class="sb-head">Courses</span>
      <span class="sb-hint">tap to hide</span>
    </div>
    ${legendHTML}

    <div class="sb-head-row">
      <span class="sb-head">To-Dos</span>
      <button class="todo-add-btn" data-act="add-todo" title="New to-do">＋</button>
    </div>
    ${todoListHTML()}

    <div class="glance">
      <div class="sb-head">At a Glance</div>
      <div class="stat-row">
        <div class="stat-tile">
          <div class="stat-num" style="color:${dueTomorrow.length ? '#ff9f0a' : 'var(--text)'}">${dueTomorrow.length}</div>
          <div class="stat-label">Due tomorrow</div>
        </div>
        <div class="stat-tile">
          <div class="stat-num">${dueWeek.length}</div>
          <div class="stat-label">Next 7 days</div>
        </div>
      </div>
      <div class="glance-section">
        <div class="glance-sub">Hardest ahead</div>
        ${hardestHTML}
      </div>
      <div class="glance-section">
        <div class="glance-sub">Exams to prep for</div>
        ${examsHTML}
      </div>
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
    <div class="todo-row" data-act="detail" data-id="${a.id}">
      <span class="check todo-check" data-act="toggle-done" data-id="${a.id}" data-base="${a._baseId || a.id}"></span>
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
  }
  // animate view changes: calendar trio slides directionally, pages fade up
  const prev = renderMain._last;
  if (prev && prev !== state.view) {
    const el = main.firstElementChild;
    if (el) {
      let cls = 'va-fade';
      if (VIEW_ORDER[prev] !== undefined && VIEW_ORDER[state.view] !== undefined) {
        cls = VIEW_ORDER[state.view] > VIEW_ORDER[prev] ? 'va-left' : 'va-right';
      }
      el.classList.add(cls);
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
          <div class="mchip ${done ? 'done' : ''}" data-act="detail" data-id="${o.id}" style="border-left-color:${c.color}">
            <span class="mchip-title" lang="en">${esc(o.title)}</span>
            ${filledDotsHTML(o.difficulty)}
          </div>`;
      }).join('');

      cells += `
        <div class="mday ${inMonth ? '' : 'out'} ${isToday ? 'today' : ''}" data-act="day-add" data-date="${ds}">
          <div class="mday-numrow"><span class="mday-num">${dt.getDate()}</span></div>
          ${chips}
          ${evs.length > 2 ? `<span class="mmore">+${evs.length - 2} more</span>` : ''}
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
    const evs = byDate[ds] || [];
    const active = evs.filter((e) => e.status !== 'done');
    const done = evs.filter((e) => e.status === 'done');

    const activeHTML = active.length ? `
      <div class="wday-grid">
        ${active.map((o) => {
          const c = course(o.courseId);
          return `
            <div class="wcard" data-act="detail" data-id="${o.id}" style="border-left-color:${c.color}">
              <span class="check" data-act="toggle-done" data-id="${o.id}" data-base="${o._baseId || o.id}"></span>
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
            <div class="done-chip" data-act="detail" data-id="${o.id}" title="${esc(o.title)}">
              <span class="done-chip-check" data-act="toggle-done" data-id="${o.id}" data-base="${o._baseId || o.id}" style="background:${c.color}">✓</span>
              <span class="done-chip-title">${esc(o.title)}</span>
            </div>`;
        }).join('')}
      </div>` : '';

    rows += `
      <div class="wday-row ${isToday ? 'today' : ''}">
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
function agendaView() {
  const occ = occurrences();
  const todayStr = fmt(TODAY);
  const future = occ.filter((o) => o.dueDate >= todayStr)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : b.difficulty - a.difficulty));
  const groups = {};
  for (const o of future) (groups[o.dueDate] = groups[o.dueDate] || []).push(o);
  const keys = Object.keys(groups).sort().slice(0, 30);

  if (!keys.length) {
    return `<div class="agenda-wrap"><div class="empty-note">Nothing coming up. 🎉</div></div>`;
  }

  const groupHTML = keys.map((ds) => {
    const dt = parseDate(ds);
    const diff = Math.round((dt - TODAY) / 86400000);
    const sub = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : 'in ' + diff + ' days';
    const cards = groups[ds].map((o) => {
      const c = course(o.courseId);
      const done = o.status === 'done';
      return `
        <div class="acard" data-act="detail" data-id="${o.id}">
          <span class="check" data-act="toggle-done" data-id="${o.id}" data-base="${o._baseId || o.id}"
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
      <div class="agenda-note">Sorted by date, hardest first each day.</div>
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
  const list = state.courses.length ? state.courses.map((c) => `
    <div class="course-card">
      <span class="course-swatch" style="background:${c.color}"></span>
      <div style="flex:1;">
        <div class="course-name">${esc(c.name)}</div>
        <div class="course-code">${esc(c.code)}</div>
      </div>
      <span class="course-count">${state.assignments.filter((a) => a.courseId === c.id).length} items</span>
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
      <p class="page-sub">Your color legend. Import more syllabi to add classes.</p>
      <div class="card-list">${list}</div>
      <div class="diff-scale">
        <div class="diff-scale-title">Difficulty scale</div>
        <div class="diff-rows">${scale}</div>
      </div>
    </div>`;
}

// ---- to-dos page ----
function todoCardHTML(o) {
  const done = o.status === 'done';
  return `
    <div class="acard" data-act="detail" data-id="${o.id}">
      <span class="check" data-act="toggle-done" data-id="${o.id}" data-base="${o._baseId || o.id}"
            style="${done ? `background:${TODO_COURSE.color};border-color:${TODO_COURSE.color}` : `border-color:${TODO_COURSE.color}`}">${done ? '✓' : ''}</span>
      <div class="body-col">
        <div class="acard-title ${done ? 'done' : ''}">${esc(o.title)}</div>
        <div class="acard-meta">${todoMeta(o)}${o.recurrence ? ' · repeats ' + esc(o.recurrence.frequency || 'weekly') : ''}${o.notes ? ' · ' + esc(o.notes) : ''}</div>
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
        <button class="btn-confirm" data-act="add-todo">＋ New To-Do</button>
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

      <div class="grade-cols">
        <span class="c1">Category</span>
        <span class="c2">Weight %</span>
        <span class="c2">Your %</span>
        <span class="c3"></span>
      </div>
      <div class="grade-rows">${rows}</div>
      <button class="btn-add-cat" data-act="grade-add">＋ Add category</button>
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
        <span class="drop-icon">⇩</span>
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
    if (it.recurrence) meta += ' · repeats ' + (it.recurrence.frequency || 'weekly');
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
        <button class="btn-confirm" data-act="review-confirm">Add to Calendar</button>
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
  if (state.editA) root.innerHTML = formModalHTML('edit');
  else if (state.showAdd) root.innerHTML = formModalHTML('add');
  else if (state.detailId) root.innerHTML = detailModalHTML();
  else root.innerHTML = '';
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
        <div class="frow mb16">
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
        </div>` : ''}

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
          <div class="detail-row"><span class="detail-key">Difficulty</span>${dotsHTML(found.difficulty, 9)}</div>
          <div class="detail-row"><span class="detail-key">Source</span><span class="detail-val">${found.source === 'syllabus' ? 'From syllabus' : 'Added manually'}</span></div>
        </div>

        ${found.notes ? `<div class="detail-notes">${esc(found.notes)}</div>` : ''}

        <div class="detail-actions">
          <button class="btn-done ${done ? 'undone' : ''}" data-act="detail-toggle-done" data-id="${found.id}" data-base="${found._baseId || found.id}">${done ? 'Mark as To-Do' : 'Mark Done'}</button>
          <button class="btn-ics" data-act="detail-export" title="Export to Apple Calendar">.ics</button>
          <button class="btn-delete" data-act="detail-delete" data-base="${found._baseId || found.id}">Delete</button>
        </div>
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
  state.review = {
    name: j.course.name || 'Untitled course',
    code: j.course.code || '',
    color: /^#[0-9a-fA-F]{3,8}$/.test(j.course.color || '') ? j.course.color : '#0a84ff',
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
  if (!cid) {
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
    const cats = raw.gradeWeights.map((g, i) => ({
      id: 'g' + Date.now() + '_' + i,
      name: g.name || 'Category',
      weight: parseFloat(g.weight) || 0,
      score: '',
    }));
    state.grades = Object.assign({}, state.grades, { [cid]: cats });
  }
  state.assignments = state.assignments.concat(adds);
  state.review = null;
  state.view = 'month';
  render();
}

// ---------- ICS export ----------
async function exportICS(list) {
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

  const t = window.__TAURI__;
  if (t && t.dialog && t.fs) {
    try {
      const path = await t.dialog.save({
        defaultPath: 'assignment.ics',
        filters: [{ name: 'Calendar', extensions: ['ics'] }],
      });
      if (path) await t.fs.writeTextFile(path, ics);
    } catch (e) {
      console.error('ICS export failed', e);
    }
  } else {
    const blob = new Blob([ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'assignment.ics';
    link.click();
    URL.revokeObjectURL(url);
  }
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
      "recurrence": { "frequency": "weekly", "interval": 1, "until": "YYYY-MM-DD" }
    }
  ]
}

Rules:
- One file per course. Pick a distinct hex "color" for the course.
- "gradeWeights" is the grading breakdown from the syllabus (each category with its percent weight; they should sum to 100). If the syllabus has no breakdown, use an empty array.
- If a due date is unknown or says "TBD", set "dueDate": null.
- For anything that repeats (weekly quiz, reading), use ONE entry with a "recurrence" block instead of many rows. Omit "recurrence" for one-off items.
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
      render();
      break;
    }
    case 'prev-month': navCalendar(-1); break;
    case 'next-month': navCalendar(1); break;
    case 'go-today': {
      state.month = TODAY.getMonth();
      state.year = TODAY.getFullYear();
      state.weekOffset = 0;
      if (state.view !== 'month' && state.view !== 'week') state.view = 'month';
      render();
      break;
    }
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
    case 'toggle-done': {
      toggleDone(el.dataset.id, el.dataset.base);
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
      if (n.repeats) a.recurrence = { frequency: n.freq, interval: 1, until: n.until };
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
    case 'close-detail': {
      if (e.target !== el) break;
      animateModalClose(() => { state.detailId = null; });
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
        if (n.repeats) upd.recurrence = { frequency: n.freq, interval: 1, until: n.until };
        else delete upd.recurrence;
        return upd;
      });
      state.editA = null;
      render();
      break;
    }
    case 'detail-delete': {
      const base = el.dataset.base;
      state.assignments = state.assignments.filter((a) => a.id !== base);
      state.detailId = null;
      render();
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
    case 'new-title': formTarget().title = el.value; break;
    case 'new-notes': formTarget().notes = el.value; break;
    case 'grade-name': updateCat(gradeCourseId(), el.dataset.id, 'name', el.value); saveState(); break;
    case 'grade-weight':
    case 'grade-score': {
      const cid = gradeCourseId();
      updateCat(cid, el.dataset.id, el.dataset.input === 'grade-weight' ? 'weight' : 'score', el.value);
      const summary = $('#grade-summary');
      if (summary) summary.innerHTML = gradeSummaryHTML(cid);
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
  }
});

// two-finger scroll drives the calendar track 1:1, then snaps to the nearest
// month (vertical) / week (horizontal). Crossing a full panel commits it
// immediately, so fast flings walk through several months/weeks fluidly.
let snapDrag = 0, snapTimer = null;

document.addEventListener('wheel', (e) => {
  if (state.view !== 'month' && state.view !== 'week') return;
  if (state.showAdd || state.detailId || state.editA) return;
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
  if (state.showAdd || state.detailId || state.editA) return;
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

// drag & drop for syllabus JSON (import view)
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  const dz = e.target.closest && e.target.closest('#dropzone');
  const zone = $('#dropzone');
  if (zone) zone.classList.toggle('over', !!dz);
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
  }
});

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

// ---------- boot ----------
loadState();
render();
initNotifications();
