const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
// There are now two <script> blocks (the tiny client-id placeholder, then
// the real app IIFE) — match each pair non-greedily and take the one that's
// actually the app.
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const scriptBody = blocks.find(b => b.includes('(function(){'));
if (!scriptBody) throw new Error('could not locate the main app <script> block');
let code = scriptBody;
code = code.replace('render();\n  initAuth();\n})();', `
window.__T__={go:go,state:state,TOPICS:TOPICS,ALL_ITEMS:ALL_ITEMS,METHODS:METHODS,RULES:RULES,startSession:startSession,pickMixedSession:pickMixedSession,pickTopicSession:pickTopicSession,pickWeighted:pickWeighted,resultsView:resultsView,learnView:learnView,sessionView:sessionView,homeView:homeView,studyView:studyView,quizView:quizView,testView:testView,guidedView:guidedView,guidedIntroView:guidedIntroView,methodsView:methodsView,methodPickerView:methodPickerView,matchingView:matchingView,handleMatchClick:handleMatchClick,startMethod:startMethod,startMatching:startMatching,seedLearn:seedLearn,submitAnswer:submitAnswer,ITEMS_BY_TOPIC:ITEMS_BY_TOPIC,render:render,AUTH:AUTH,historyView:historyView,getProgress:function(){return PROGRESS;},setProgress:function(p){PROGRESS=p;},gradesView:gradesView,compositeGrade:compositeGrade,topicAccuracy:topicAccuracy,categoryAccuracy:categoryAccuracy,typeAccuracy:typeAccuracy,lifetimeAccuracy:lifetimeAccuracy,coveragePct:coveragePct,attemptedCount:attemptedCount,modeStats:modeStats,recentTrend:recentTrend,overallMastery:overallMastery};
window.__fetchCalls__ = () => fetchCalls;
window.__clearFetchCalls__ = () => { fetchCalls.length = 0; };
render();
})();`);
if (!code.includes('window.__T__')) throw new Error('test-hook injection did not match — smoketest.js is out of sync with fichero.html\'s tail');

global.window = { scrollTo(){} };
let store = {};
global.localStorage = { getItem(k){return store[k]||null;}, setItem(k,v){store[k]=v;} };
let fetchCalls = [];
global.fetch = function(url, opts){
  fetchCalls.push({url, opts});
  return Promise.resolve({ ok:true, json:()=>Promise.resolve({ok:true}) });
};
// A minimal but real-ish DOM stub: appendChild/removeChild actually track
// parentNode and children, so tests can exercise in-place DOM mutation
// (not just full-teardown renders) the way a real browser would.
global.document = {
  head: { appendChild(){} },
  querySelector(){ return { innerHTML:'', appendChild(){}, }; },
  createElement(tag){
    const node = { tagName: tag, className:'', innerHTML:'', value:'', disabled:false,
      style:{}, parentNode:null, children:[],
      classList: {
        add(...cls){ const set = new Set(node.className.split(/\s+/).filter(Boolean)); cls.forEach(c=>set.add(c)); node.className = [...set].join(' '); },
        remove(...cls){ const set = new Set(node.className.split(/\s+/).filter(Boolean)); cls.forEach(c=>set.delete(c)); node.className = [...set].join(' '); },
        toggle(c){ this.contains?.(c) ? this.remove(c) : this.add(c); },
        contains(c){ return node.className.split(/\s+/).includes(c); }
      },
      appendChild(child){ child.parentNode = node; node.children.push(child); return child; },
      removeChild(child){
        const i = node.children.indexOf(child);
        if(i !== -1) node.children.splice(i,1);
        child.parentNode = null;
        return child;
      },
      addEventListener(){}, focus(){}, setAttribute(){} };
    return node;
  }
};
global.confirm = function(){ return false; };
eval(code);
const T = window.__T__;
console.log('total items:', T.ALL_ITEMS.length, 'topics:', T.TOPICS.length, 'methods:', T.METHODS.length);

let failures = 0;
function check(name, fn){
  try{ fn(); console.log('OK  ', name); }
  catch(e){ failures++; console.log('FAIL', name, '->', e.stack); }
}

check('home renders', ()=>{ T.go('home'); T.homeView(); });
check('study picker renders', ()=>{ T.go('study'); T.studyView(); });
check('quiz picker renders', ()=>{ T.go('quiz'); T.quizView(); });
check('test picker renders', ()=>{ T.go('test'); T.testView(); });
check('guided picker renders', ()=>{ T.go('guided'); T.guidedView(); });
check('methods hub renders', ()=>{ T.go('methods'); T.methodsView(); });

T.TOPICS.forEach(t=>{
  check('guided intro: '+t.id, ()=>{ T.go('guidedIntro', {topicId:t.id}); T.guidedIntroView(); });
  check('RULES has: '+t.id, ()=>{ if(!T.RULES[t.id]) throw new Error('missing RULES entry'); });
});

// Recursively search a stub DOM tree — used to simulate real clicks through
// whatever sessionView() actually returned, rather than bypassing it via
// the T.* test hooks, so this exercises the real in-place-mutation code
// path (the jitter fix) and not just the underlying data logic.
function findAll(node, pred, out){
  out = out || [];
  if(!node) return out;
  if(pred(node)) out.push(node);
  (node.children||[]).forEach(c => findAll(c, pred, out));
  return out;
}
function hasClass(node, cls){ return (node.className||'').split(/\s+/).includes(cls); }

function driveByClicking(items, mode, label, forceMode){
  T.startSession(mode, items, label, forceMode);
  let guard = 0;
  while(T.state.view === 'session' && guard < 500){
    guard++;
    const idx = T.state.sessionIdx;
    if(idx >= T.state.sessionItems.length) break;
    const item = T.state.sessionItems[idx];
    const tree = T.sessionView();
    const q = T.state.q;
    if(!q) throw new Error('no q at idx '+idx);

    const feedbackBefore = findAll(tree, n => hasClass(n,'feedback'));
    if(feedbackBefore.length) throw new Error('feedback should not exist before an answer is given');

    if(q.mode === 'mc'){
      const buttons = findAll(tree, n => hasClass(n,'choice-btn'));
      if(buttons.length < 1) throw new Error('no choice buttons rendered, item '+item.id);
      const target = buttons.find(b => b.__opt === item.answer[0]) || buttons[0];
      if(typeof target.onclick !== 'function') throw new Error('choice button has no onclick handler');
      target.onclick();
      // every button must now be disabled and the correct one marked
      const stillEnabled = buttons.filter(b => !b.disabled);
      if(stillEnabled.length) throw new Error('not all choice buttons were disabled after answering');
      const marked = buttons.filter(b => hasClass(b,'correct'));
      if(marked.length !== 1) throw new Error('expected exactly one button marked correct, got '+marked.length);
    } else {
      const input = findAll(tree, n => n.tagName === 'input')[0];
      const checkBtn = findAll(tree, n => n.tagName === 'button' && n.innerHTML === 'Check')[0];
      if(!input || !checkBtn) throw new Error('typed input or check button missing, item '+item.id);
      input.value = item.answer[0];
      checkBtn.onclick();
      if(!input.disabled || !checkBtn.disabled) throw new Error('input/check button should be disabled after answering');
    }

    // The fix's whole point: feedback + Next must now exist in the SAME
    // tree object sessionView() already returned — proving it was mutated
    // in place rather than requiring a full render() to appear.
    const feedbackAfter = findAll(tree, n => hasClass(n,'feedback'));
    if(feedbackAfter.length !== 1) throw new Error('expected feedback to appear in-place after answering, item '+item.id);
    const nextBtn = findAll(tree, n => n.tagName === 'button')
      .find(b => (b.innerHTML||'').indexOf('Next') !== -1);
    if(!nextBtn) throw new Error('Next button missing after answering, item '+item.id);

    nextBtn.onclick();
  }
  if(T.state.view === 'results'){ T.resultsView(); }
  return T.state.sessionResults ? T.state.sessionResults.length : -1;
}

function drive(items, mode, label, forceMode){
  T.startSession(mode, items, label, forceMode);
  let guard=0;
  while(T.state.view==='session' && guard<2000){
    guard++;
    const idx = T.state.sessionIdx;
    if(idx>=T.state.sessionItems.length) break;
    const item = T.state.sessionItems[idx];
    T.sessionView();
    const q = T.state.q;
    if(!q) throw new Error('no q at idx '+idx);
    if(q.mode==='mc'){
      if(!q.opts || q.opts.length<1) throw new Error('mc with no opts, item '+item.id);
      T.submitAnswer(item, q.opts[0], q.opts[0]===item.answer[0]);
    } else {
      T.submitAnswer(item, item.answer[0], true);
    }
    T.state.sessionAnswered = true;
    T.sessionView();
    const nextIdx = idx+1;
    T.go('session', {sessionMode:T.state.sessionMode, sessionLabel:T.state.sessionLabel, sessionItems:T.state.sessionItems, sessionIdx:nextIdx, sessionAnswered:false, sessionResults:T.state.sessionResults, q:null, lastChoice:null, lastTypedVal:'', hintShown:false});
  }
  if(T.state.view==='results'){ T.resultsView(); }
  return T.state.sessionResults ? T.state.sessionResults.length : -1;
}

check('quiz all-topics', ()=>{ const n = drive(T.pickMixedSession(12,false), 'quiz', 'Quiz — All Topics'); if(n!==12) throw new Error('expected 12 got '+n); });
check('test all-topics', ()=>{ const n = drive(T.pickMixedSession(30,true), 'test', 'Test — All Topics'); if(n!==30) throw new Error('expected 30 got '+n); });

check('answering by real click: quiz all-topics (no full render — the jitter fix)', ()=>{
  const n = driveByClicking(T.pickMixedSession(12,false), 'quiz', 'Quiz — All Topics');
  if(n!==12) throw new Error('expected 12 got '+n);
});
check('answering by real click: test all-topics', ()=>{
  const n = driveByClicking(T.pickMixedSession(30,true), 'test', 'Test — All Topics');
  if(n!==30) throw new Error('expected 30 got '+n);
});
check('answering by real click: guided session with hints', ()=>{
  driveByClicking(T.pickWeighted(T.ITEMS_BY_TOPIC['ser-estar'],8), 'guided', 'Guided — Ser vs. Estar');
});
check('answering by real click: typed-drill (forced typed mode)', ()=>{
  driveByClicking(T.pickWeighted(T.ALL_ITEMS,10), 'typed-drill', 'Fill-in-the-Blank — All', 'typed');
});
check('answering by real click: mc-drill (forced mc mode)', ()=>{
  const mcPool = T.ALL_ITEMS.filter(it=>!!(it.choices||it.pool));
  driveByClicking(T.pickWeighted(mcPool,10), 'mc-drill', 'MC Drill — All', 'mc');
});

T.TOPICS.forEach(t=>{
  check('quiz topic: '+t.id, ()=>{ drive(T.pickTopicSession(t.id,8), 'quiz', 'Quiz — '+t.name); });
  check('test topic: '+t.id, ()=>{ drive(T.pickTopicSession(t.id,15), 'test', 'Test — '+t.name); });
  check('guided practice: '+t.id, ()=>{ drive(T.pickWeighted(T.ITEMS_BY_TOPIC[t.id],8), 'guided', 'Guided — '+t.name); });
});

check('typed-drill all-topics', ()=>{ drive(T.pickWeighted(T.ALL_ITEMS,15), 'typed-drill', 'Fill-in-the-Blank — All', 'typed'); });
check('mc-drill all-topics', ()=>{
  const mcPool = T.ALL_ITEMS.filter(it=>!!(it.choices||it.pool));
  drive(T.pickWeighted(mcPool,15), 'mc-drill', 'MC Drill — All', 'mc');
});
T.TOPICS.forEach(t=>{
  check('typed-drill topic: '+t.id, ()=>{ drive(T.pickWeighted(T.ITEMS_BY_TOPIC[t.id],10), 'typed-drill', 'Fill-in-the-Blank — '+t.name, 'typed'); });
  check('mc-drill topic: '+t.id, ()=>{
    const mcPool = T.ITEMS_BY_TOPIC[t.id].filter(it=>!!(it.choices||it.pool));
    if(mcPool.length<4) return;
    drive(T.pickWeighted(mcPool,10), 'mc-drill', 'MC Drill — '+t.name, 'mc');
  });
});

// Study (flashcard) flow, all + per topic
check('study flow all-topics', ()=>{
  T.go('learn', {topicId:null, learnIdx:0, learnItems:T.pickWeighted(T.ALL_ITEMS,25), scopeLabel:'All Topics'});
  let guard=0;
  while(T.state.view==='learn' && guard<100){
    guard++;
    T.learnView();
    const idx = T.state.learnIdx, items = T.state.learnItems;
    if(idx>=items.length) break;
    T.seedLearn(items[idx].id, guard%2===0);
    T.go('learn', {topicId:T.state.topicId, learnItems:items, learnIdx:idx+1, scopeLabel:T.state.scopeLabel});
  }
  T.learnView(); // finished-state render
});
T.TOPICS.forEach(t=>{
  check('study flow topic: '+t.id, ()=>{
    const items = T.ITEMS_BY_TOPIC[t.id].slice(0,5);
    T.go('learn', {topicId:t.id, learnIdx:0, learnItems:items, scopeLabel:t.name});
    let guard=0;
    while(T.state.view==='learn' && guard<50){
      guard++;
      T.learnView();
      const idx = T.state.learnIdx;
      if(idx>=items.length) break;
      T.seedLearn(items[idx].id, true);
      T.go('learn', {topicId:t.id, learnItems:items, learnIdx:idx+1, scopeLabel:t.name});
    }
    T.learnView();
  });
});

// Method picker pages
T.METHODS.forEach(m=>{
  check('methodPicker: '+m.id, ()=>{ T.go('methodPicker', {methodId:m.id}); T.methodPickerView(); });
});

// Matching: exercise both a mismatch (timeout path) and a full correct completion, all-topics and one topic
function driveMatching(items, label, scopePool, cb){
  T.startMatching(items, label, scopePool);
  const cards = T.state.matchCards;
  // Deliberately mismatch first: click card0 (prompt of item0) then card for answer of item1 (wrong)
  const c0 = cards.find(c=>c.itemId===items[0].id && c.side==='p');
  const wrongA = cards.find(c=>c.itemId===items[1].id && c.side==='a');
  T.handleMatchClick(c0.cardId);
  T.handleMatchClick(wrongA.cardId);
  if(T.state.matchWrong.length !== 2) throw new Error('expected a flagged wrong pair');
  setTimeout(()=>{
    if(T.state.matchWrong.length !== 0) throw new Error('wrong pair did not clear after timeout');
    // Now correctly match every pair
    items.forEach(it=>{
      const p = T.state.matchCards.find(c=>c.itemId===it.id && c.side==='p');
      const a = T.state.matchCards.find(c=>c.itemId===it.id && c.side==='a');
      if(!p.matched){
        T.handleMatchClick(p.cardId);
        T.handleMatchClick(a.cardId);
      }
    });
    if(!T.state.matchDone) throw new Error('match round did not complete');
    T.matchingView();
    cb();
  }, 700);
}

check('completing a session logs exactly one history entry', ()=>{
  // Clean baseline: by this point in the run, many prior checks have
  // already completed sessions and pushed history past its 50-entry cap,
  // which would make "grew by exactly 1" ambiguous through that cap.
  T.setProgress({items:{}, streak:{count:0,last:null}, history:[]});
  const before = T.getProgress().history.length;
  driveByClicking(T.pickTopicSession('ser-estar',5), 'quiz', 'Quiz — Ser vs. Estar');
  const after = T.getProgress().history;
  if(after.length !== before+1) throw new Error('expected history to grow by exactly 1, went from '+before+' to '+after.length);
  const last = after[after.length-1];
  if(last.total !== 5) throw new Error('expected the logged entry to have total=5, got '+last.total);
  if(typeof last.pct !== 'number' || last.pct < 0 || last.pct > 100) throw new Error('bad pct on logged entry: '+last.pct);
  if(last.label !== 'Quiz — Ser vs. Estar') throw new Error('label mismatch on logged entry');
});

check('re-rendering the results screen does not double-log history', ()=>{
  const before = T.getProgress().history.length;
  T.resultsView();
  T.resultsView();
  T.resultsView();
  const after = T.getProgress().history.length;
  if(after !== before) throw new Error('expected no new entries from re-rendering results, went from '+before+' to '+after);
});

check('home and history pages render with populated history', ()=>{
  T.go('home'); T.homeView();
  T.go('history'); T.historyView();
});

check('history caps at 50 entries', ()=>{
  const p = T.getProgress();
  p.history = [];
  for(let i=0;i<60;i++) p.history.push({date:'2026-01-01', ts:i, mode:'quiz', label:'Old #'+i, correct:1, total:1, pct:100});
  T.setProgress(p);
  driveByClicking(T.pickTopicSession('articles',3), 'quiz', 'Quiz — Articles');
  const len = T.getProgress().history.length;
  if(len !== 50) throw new Error('expected history capped at 50, got '+len);
  const newest = T.getProgress().history[T.getProgress().history.length-1];
  if(newest.label !== 'Quiz — Articles') throw new Error('newest entry should be the just-completed session, got '+newest.label);
});

check('home and history render fine with empty history (fresh user)', ()=>{
  T.setProgress({items:{}, streak:{count:0,last:null}, history:[]});
  T.go('home'); T.homeView();
  T.go('history'); T.historyView();
});

check('completing a session while signed in mirrors to the Sheets endpoint (fetch called), signed out does not', ()=>{
  T.setProgress({items:{}, streak:{count:0,last:null}, history:[]});
  window.__clearFetchCalls__();

  T.AUTH.user = null;
  driveByClicking(T.pickTopicSession('vocab-food',3), 'quiz', 'Quiz — Food (signed out)');
  const callsSignedOut = window.__fetchCalls__().filter(c => c.url === '/api/session-complete');
  if(callsSignedOut.length !== 0) throw new Error('signed-out completion should not call session-complete, got '+callsSignedOut.length+' calls');

  T.AUTH.user = { sub:'sub-test', email:'test@example.com', name:'Test User', picture:'' };
  window.__clearFetchCalls__();
  driveByClicking(T.pickTopicSession('vocab-food',3), 'quiz', 'Quiz — Food (signed in)');
  const callsSignedIn = window.__fetchCalls__().filter(c => c.url === '/api/session-complete');
  if(callsSignedIn.length !== 1) throw new Error('signed-in completion should call session-complete exactly once, got '+callsSignedIn.length);
  const sentBody = JSON.parse(callsSignedIn[0].opts.body);
  if(sentBody.total !== 3 || sentBody.label !== 'Quiz — Food (signed in)') throw new Error('unexpected session-complete payload: '+JSON.stringify(sentBody));
  T.AUTH.user = null;
});

check('report card shows the empty state with no practice recorded', ()=>{
  T.setProgress({items:{}, streak:{count:0,last:null}, history:[]});
  T.go('grades');
  const tree = T.gradesView();
  const notes = findAll(tree, n => hasClass(n,'sync-note'));
  if(!notes.length || !/No practice recorded/.test(notes[0].innerHTML)) throw new Error('expected the no-data empty state, got: '+JSON.stringify(notes.map(n=>n.innerHTML)));
  const heroes = findAll(tree, n => hasClass(n,'grade-hero'));
  if(heroes.length) throw new Error('should not show a grade hero before anything has been practiced');
});

check('report card grade formula matches its displayed inputs, and topics sort weakest-first', ()=>{
  T.setProgress({items:{}, streak:{count:0,last:null}, history:[]});
  // Drive real sessions across a couple of topics so mastery/accuracy/coverage
  // are all non-trivial and independently verifiable against the raw items.
  driveByClicking(T.pickTopicSession('ser-estar', 6), 'quiz', 'Quiz — Ser vs. Estar');
  driveByClicking(T.pickTopicSession('vocab-food', 6), 'test', 'Test — Food');

  const grade = T.compositeGrade();
  const expectedScore = Math.round(grade.mastery*0.4 + grade.accuracy*0.35 + grade.coverage*0.25);
  if(grade.score !== expectedScore) throw new Error('composite score does not match its own formula: got '+grade.score+' expected '+expectedScore);
  if(grade.mastery !== T.overallMastery()) throw new Error('grade.mastery should equal overallMastery()');
  const expectedLetter = grade.score>=90?'A':grade.score>=80?'B':grade.score>=70?'C':grade.score>=60?'D':'F';
  if(grade.letter !== expectedLetter) throw new Error('letter grade '+grade.letter+' does not match score '+grade.score);

  T.go('grades');
  const tree = T.gradesView();
  const hero = findAll(tree, n => hasClass(n,'grade-hero'));
  if(hero.length !== 1) throw new Error('expected exactly one grade hero once practice exists');

  const topicRows = findAll(tree, n => hasClass(n,'topic-row'));
  if(topicRows.length !== T.TOPICS.length) throw new Error('expected one row per topic, got '+topicRows.length+' for '+T.TOPICS.length+' topics');
  // Rows carry their percentage as the last child's text — verify non-increasing (weakest/unattempted first).
  const pcts = topicRows.map(r => {
    const numEl = r.children[r.children.length-1];
    const txt = numEl.innerHTML;
    return txt === '—' ? -1 : parseInt(txt, 10); // unattempted sorts logically after any real percentage
  });
  for(let i=1;i<pcts.length;i++){
    const prev = pcts[i-1]===-1 ? Infinity : pcts[i-1];
    const cur = pcts[i]===-1 ? Infinity : pcts[i];
    if(cur < prev) throw new Error('topic rows are not sorted weakest-first: '+JSON.stringify(pcts));
  }
});

check('clicking a topic row on the report card starts a quiz for that exact topic', ()=>{
  T.go('grades');
  const tree = T.gradesView();
  const row = findAll(tree, n => hasClass(n,'topic-row'))[0];
  if(typeof row.onclick !== 'function') throw new Error('topic row has no click handler');
  row.onclick();
  if(T.state.view !== 'session') throw new Error('clicking a topic row should start a session, view is '+T.state.view);
  if(!/^Quiz — /.test(T.state.sessionLabel)) throw new Error('expected a Quiz session label, got '+T.state.sessionLabel);
  if(T.state.sessionItems.length !== 8) throw new Error('topic-row quiz should be 8 questions, got '+T.state.sessionItems.length);
});

check('skill-type and by-method breakdowns stay internally consistent', ()=>{
  const conj = T.typeAccuracy(['conjugate']);
  const es2en = T.typeAccuracy(['vocab-es2en']);
  const en2es = T.typeAccuracy(['vocab-en2es']);
  [conj, es2en, en2es].forEach(x => {
    if(x.pct !== null && (x.pct < 0 || x.pct > 100)) throw new Error('skill-type pct out of range: '+JSON.stringify(x));
  });
  const stats = T.modeStats();
  if(!stats.quiz || !stats.test) throw new Error('expected quiz and test mode stats after the driven sessions above, got: '+JSON.stringify(stats));
  Object.keys(stats).forEach(m => {
    const avg = stats[m].sum/stats[m].count;
    if(avg < 0 || avg > 100) throw new Error('mode avg out of range for '+m+': '+avg);
  });
});

check('a session completes and logs fine even when loaded progress predates the history field', ()=>{
  // Simulates a real upgrade scenario: someone's localStorage from before
  // this feature existed has no .history key at all. T.setProgress bypasses
  // the loadProgress()/pullProgress() patches on purpose here, so this only
  // passes if resultsView's own history-logging is independently defensive.
  const p = { items:{}, streak:{count:2,last:'2026-09-01'} };
  delete p.history;
  T.setProgress(p);
  T.go('home'); T.homeView(); // must not throw despite no .history yet
  driveByClicking(T.pickTopicSession('regular-verbs',4), 'quiz', 'Quiz — Regular Verbs');
  const history = T.getProgress().history;
  if(!Array.isArray(history) || history.length !== 1) throw new Error('expected exactly one logged entry, got '+JSON.stringify(history));
});

// Run matching flows strictly one after another — they mutate the same
// shared app state, so two in flight at once corrupts each other.
let matchOk = true;
check('matching setup all-topics', ()=>{
  driveMatching(T.pickWeighted(T.ALL_ITEMS,6), 'Matching Pairs — All Topics', T.ALL_ITEMS, ()=>{
    console.log('OK   matching flow all-topics (async)');
    runSecondMatch();
  });
});
function runSecondMatch(){
  try{
    const t = T.TOPICS[0];
    const pool = T.ITEMS_BY_TOPIC[t.id];
    driveMatching(T.pickWeighted(pool,6), 'Matching Pairs — '+t.name, pool, ()=>{
      console.log('OK   matching flow topic (async)');
      finish();
    });
  }catch(e){
    failures++; matchOk=false;
    console.log('FAIL matching flow topic ->', e.stack);
    finish();
  }
}
function finish(){
  console.log(failures===0 ? 'ALL CHECKS PASSED' : (failures+' FAILURES'));
  process.exit(failures===0 ? 0 : 1);
}
