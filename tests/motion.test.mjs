import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').split('// ---------- boot ----------')[0];

// Exercise real completion and haptic logic without a native trackpad or DOM.
// Rendering is replaced only at the boundary; assignment updates stay real.
function app({ reduced = false, native = true } = {}) {
  let clock = 1000;
  let preferenceChange;
  const timers = [];
  const pulses = [];
  const events = {};
  const context = vm.createContext({
    Date, console,
    performance: { now: () => clock },
    window: {
      matchMedia: () => ({ matches: reduced, addEventListener: (_, fn) => { preferenceChange = fn; } }),
      addEventListener() {},
      ...(native ? { __TAURI__: { core: { invoke: (command, args) => {
        pulses.push({ command, ...args }); return Promise.resolve();
      } } } } : {}),
    },
    document: {
      addEventListener: (name, fn) => { (events[name] ||= []).push(fn); },
      querySelector: () => null,
      getAnimations: () => [],
    },
    setTimeout: fn => { timers.push(fn); return timers.length; },
    clearTimeout() {}, setInterval() {},
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    let renderCount = 0;
    render = () => { renderCount++; };
    captureFlip = captureSbFlip = () => null;
    playFlip = playSbFlip = () => {};
    refreshCourseJson = () => {};
    function check(id, base = id) { return { dataset: { id, base }, closest: () => null }; }
  `, context);
  return {
    run: js => vm.runInContext(js, context), pulses,
    flush: () => { while (timers.length) timers.shift()(); },
    advance: ms => { clock += ms; },
    reduce: () => preferenceChange({ matches: true }),
  };
}

test('completion is committed immediately and rapid repeated activation is ignored', () => {
  const a = app();
  a.run(`state.assignments = [{id:'one',status:'todo'}, {id:'two',status:'todo'}];
    playCompleteAnim(check('one')); playCompleteAnim(check('one')); playCompleteAnim(check('two'));`);
  assert.equal(a.run('state.assignments.every(a => a.status === "done")'), true);
  assert.equal(a.run('renderCount'), 2);
  // Leaving a page or removing an item before the visual finishes never toggles stale data.
  a.run(`state.view = 'courses'; state.assignments = state.assignments.filter(a => a.id !== 'one');`);
  a.flush();
  assert.equal(a.run('state.assignments.length'), 1);
  assert.equal(a.run('state.assignments[0].status'), 'done');
  assert.equal(a.run('renderCount'), 2);
});

test('completing a recurring occurrence leaves its series and other dates open', () => {
  const a = app();
  a.run(`state.assignments = [{id:'series',status:'todo',doneDates:{}}];
    playCompleteAnim(check('series@2026-09-12', 'series'));`);
  assert.equal(a.run('state.assignments[0].status'), 'todo');
  assert.equal(a.run('Object.keys(state.assignments[0].doneDates).join()'), '2026-09-12');
  a.flush();
  a.run(`toggleDone('series@2026-09-12', 'series');`);
  assert.equal(a.run('Object.keys(state.assignments[0].doneDates).length'), 0);
});

test('reduced motion commits completion immediately and still supplies success feedback', () => {
  const a = app({ reduced: true });
  a.run(`state.assignments = [{id:'one',status:'todo'}]; playCompleteAnim(check('one'));`);
  assert.equal(a.run('state.assignments[0].status'), 'done');
  assert.deepEqual(a.pulses, [{command:'haptic',pattern:'strong'}]);
  a.flush();
  assert.equal(a.run('completingIds.size'), 0);
});

test('live reduced-motion changes cancel scrolling and skip subsequent animation', () => {
  const a = app();
  a.run('scrollAnimActive = true;');
  a.reduce();
  assert.equal(a.run('REDUCED_MOTION'), true);
  assert.equal(a.run('scrollAnimActive'), false);
  assert.equal(a.run('motion({animate(){throw Error("must not animate");}}, [])'), null);
});

test('action feedback is throttled independently of existing calendar ticks', () => {
  const a = app();
  a.run(`hapticFeedback('selection'); hapticFeedback('selection'); hapticTick('align');`);
  assert.deepEqual(a.pulses.map(p => p.pattern), ['align', 'align']);
  a.advance(100);
  a.run(`hapticFeedback('success');`);
  a.advance(100);
  a.run(`hapticFeedback('warning');`);
  assert.deepEqual(a.pulses.map(p => p.pattern), ['align', 'align', 'strong', 'generic']);
});

test('browser preview has no native dependency and modal close applies state synchronously', () => {
  const a = app({ native: false });
  a.run(`hapticFeedback('success'); state.showAdd = true;
    animateModalClose(() => { state.showAdd = false; });`);
  assert.equal(a.run('state.showAdd'), false);
  assert.equal(a.run('renderCount'), 1);
  assert.deepEqual(a.pulses, []);
});

test('the strike holds a task in place without delaying its saved completion', () => {
  const a = app();
  a.run(`
    state.assignments = [{id:'one',title:'Task',dueDate:'2026-10-29',status:'todo'}];
    completionHolds.set('one', {started:performance.now()});
    toggleDone('one', 'one');
  `);
  assert.equal(a.run('state.assignments[0].status'), 'done');
  assert.equal(a.run('occurrences()[0].status'), 'done');
  assert.equal(a.run('visibleOccurrences()[0].status'), 'todo');
  a.run(`finishCompletionHold('one'); finishCompletionHold('one');`);
  assert.equal(a.run('visibleOccurrences()[0].status'), 'done');
  assert.equal(a.run('renderCount'), 2);
});

test('finishing an earlier strike never restores deleted tasks or changes a new view', () => {
  const a = app();
  a.run(`
    completionHolds.set('one', {started:performance.now()});
    completionHolds.set('two', {started:performance.now()});
    state.assignments = [{id:'two',status:'done'}];
    state.view = 'done';
    finishCompletionHold('one');
  `);
  assert.equal(a.run('state.assignments.length'), 1);
  assert.equal(a.run('state.assignments[0].status'), 'done');
  assert.equal(a.run('state.view'), 'done');
  assert.equal(a.run('completionHolds.has("two")'), true);
  a.reduce();
  assert.equal(a.run('completionHolds.size'), 0);
});

test('the flying check follows a circular arc within the viewport and lands on the tab', () => {
  const a = app();
  for (const start of [{x:30,y:700}, {x:900,y:600}, {x:500,y:300}]) {
    const end = {x:510,y:27};
    const points = a.run(`completionArc(${JSON.stringify(start)}, ${JSON.stringify(end)}, {width:1000,height:880})`);
    assert.ok(Math.hypot(points[0].x-start.x,points[0].y-start.y)<.001);
    assert.ok(Math.hypot(points.at(-1).x-end.x,points.at(-1).y-end.y)<.001);
    assert.ok(points.every(p=>p.x>=12 && p.x<=988 && p.y>=12 && p.y<=868));
    const chordMid = {x:(start.x+end.x)/2,y:(start.y+end.y)/2};
    assert.ok(Math.hypot(points[24].x-chordMid.x,points[24].y-chordMid.y)>10);
    const steps=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y));
    assert.ok(Math.max(...steps)-Math.min(...steps)<.001);
  }
});

test('one recurring occurrence can be renamed without changing the rest of its loop', () => {
  const a = app();
  a.run(`state.assignments = [{
    id:'series', title:'Weekly homework', courseId:'todo', type:'homework',
    dueDate:'2026-09-01', dueTime:'23:59', difficulty:2, notes:'', status:'todo',
    recurrence:{frequency:'weekly', interval:1, until:'2026-09-30'}
  }];
  applyAssignmentEdit({
    baseId:'series', occurrenceDate:'2026-09-15', scope:'single',
    title:'Homework 3 — Graphs', courseId:'todo', type:'homework',
    dueDate:'2026-09-15', dueTime:'23:59', difficulty:2, notes:''
  });`);
  assert.equal(a.run('state.assignments[0].title'), 'Weekly homework');
  assert.equal(a.run('state.assignments[0].occurrenceOverrides["2026-09-15"].title'), 'Homework 3 — Graphs');
  assert.equal(a.run('occurrences(true).find(o => o._occurrenceDate === "2026-09-15").title'), 'Homework 3 — Graphs');
  assert.equal(a.run('occurrences(true).find(o => o._occurrenceDate === "2026-09-22").title'), 'Weekly homework');
});

test('this-and-future edits split a recurrence and preserve its earlier events', () => {
  const a = app();
  a.run(`state.assignments = [{
    id:'series', title:'Reading', courseId:'todo', type:'reading',
    dueDate:'2026-09-01', dueTime:'18:00', difficulty:1, notes:'', status:'todo',
    doneDates:{'2026-09-08':'done-at'},
    recurrence:{frequency:'weekly', interval:1, until:'2026-10-01'}
  }];
  applyAssignmentEdit({
    baseId:'series', occurrenceDate:'2026-09-15', scope:'future',
    title:'Reading — Unit 2', courseId:'todo', type:'reading',
    dueDate:'2026-09-15', dueTime:'18:00', difficulty:1, notes:'',
    repeats:true, freq:'weekly', byDay:[], until:'2026-10-01'
  });`);
  assert.equal(a.run('state.assignments.length'), 2);
  assert.equal(a.run('state.assignments[0].recurrence.until'), '2026-09-14');
  assert.equal(a.run('state.assignments[0].doneDates["2026-09-08"]'), 'done-at');
  assert.equal(a.run('occurrences(true).find(o => o.dueDate === "2026-09-08").title'), 'Reading');
  assert.equal(a.run('occurrences(true).find(o => o.dueDate === "2026-09-15").title'), 'Reading — Unit 2');
  assert.equal(a.run('occurrences(true).find(o => o.dueDate === "2026-09-22").title'), 'Reading — Unit 2');
});
