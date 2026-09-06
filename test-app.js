const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
// There are now two <script> blocks (the tiny client-id placeholder, then
// the real app IIFE) — match each pair non-greedily and take the one that's
// actually the app.
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const scriptBody = blocks.find(b => b.includes('(function(){'));
if (!scriptBody) throw new Error('could not locate the main app <script> block');
let code = scriptBody;
// Matches the app's closing sequence (render + whatever init calls exist) by
// shape rather than by an exact string, so adding an init call to index.html
// doesn't silently break every test in this file.
const APP_TAIL = /\n  render\(\);[\s\S]*?\n\}\)\(\);\s*$/;
code = code.replace(APP_TAIL, `
window.__T__={go:go,state:state,TOPICS:TOPICS,ALL_ITEMS:ALL_ITEMS,METHODS:METHODS,RULES:RULES,startSession:startSession,pickMixedSession:pickMixedSession,pickTopicSession:pickTopicSession,pickWeighted:pickWeighted,resultsView:resultsView,learnView:learnView,sessionView:sessionView,homeView:homeView,studyView:studyView,quizView:quizView,testView:testView,guidedView:guidedView,guidedIntroView:guidedIntroView,methodsView:methodsView,methodPickerView:methodPickerView,matchingView:matchingView,handleMatchClick:handleMatchClick,startMethod:startMethod,startMatching:startMatching,seedLearn:seedLearn,submitAnswer:submitAnswer,ITEMS_BY_TOPIC:ITEMS_BY_TOPIC,render:render,AUTH:AUTH,historyView:historyView,getProgress:function(){return PROGRESS;},setProgress:function(p){PROGRESS=p;},gradesView:gradesView,compositeGrade:compositeGrade,topicAccuracy:topicAccuracy,categoryAccuracy:categoryAccuracy,typeAccuracy:typeAccuracy,lifetimeAccuracy:lifetimeAccuracy,coveragePct:coveragePct,attemptedCount:attemptedCount,modeStats:modeStats,recentTrend:recentTrend,overallMastery:overallMastery,settingsView:settingsView,referenceView:referenceView,referenceSheetView:referenceSheetView,settings:settings,setSetting:setSetting,migrateProgress:migrateProgress,missedItems:missedItems,sentenceItems:sentenceItems,listeningItems:listeningItems,masteredItems:masteredItems,recommendedSession:recommendedSession,recommendReason:recommendReason,dueCount:dueCount,newCount:newCount,badgeDefs:badgeDefs,pickFinalExam:pickFinalExam,speedExpire:speedExpire,filteredHistory:filteredHistory,personalCallout:personalCallout,methodAvailability:methodAvailability,recordAnswer:recordAnswer,referenceRows:referenceRows,weakestTopics:weakestTopics,topicIcon:topicIcon,TOPIC_ICONS:TOPIC_ICONS,startMethod:startMethod,speechAvailable:speechAvailable,gradeAnswer:gradeAnswer,normalizeStrict:normalizeStrict,dueForecast:dueForecast,forecastSection:forecastSection,pullProgress:pullProgress,STORE_KEY:STORE_KEY,NAV_GROUPS:NAV_GROUPS,activeNavGroup:activeNavGroup,navBar:navBar};
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

/* ---------- nav redesign: uniform top-level groups, sub-row only when relevant ---------- */

check('the nav bar has exactly one uniform-width tab per group, never a scrolling row', ()=>{
  T.go('home');
  const tree = T.navBar();
  const tabs = findAll(tree, n => hasClass(n,'nav-btn'));
  if(tabs.length !== T.NAV_GROUPS.length) throw new Error('expected '+T.NAV_GROUPS.length+' top-level tabs, got '+tabs.length);
});

check('every view maps to exactly one nav group, and that group is the one marked active', ()=>{
  const allViews = ['home','study','quiz','test','guided','guidedIntro','methods','methodPicker','history','grades','reference','referenceSheet','settings'];
  allViews.forEach(v => {
    T.state.view = v;
    const owners = T.NAV_GROUPS.filter(g => g.views.indexOf(v) !== -1);
    if(owners.length !== 1) throw new Error(v+' belongs to '+owners.length+' nav groups, expected exactly 1');
    const tabs = findAll(T.navBar(), n => hasClass(n,'nav-btn'));
    const activeTabs = tabs.filter(n => hasClass(n,'active'));
    if(activeTabs.length !== 1) throw new Error('expected exactly one active top-level tab for view '+v+', got '+activeTabs.length);
    if(activeTabs[0].innerHTML.indexOf(owners[0].label) === -1) throw new Error('active tab is "'+activeTabs[0].innerHTML+'" but '+v+' belongs to "'+owners[0].label+'"');
  });
});

check('a sub-row only appears for groups that actually have sub-pages', ()=>{
  T.go('home');
  if(findAll(T.navBar(), n => hasClass(n,'nav-subbar')).length) throw new Error('Home has no sub-pages and should show no sub-row');
  T.go('settings');
  if(findAll(T.navBar(), n => hasClass(n,'nav-subbar')).length) throw new Error('Settings has no sub-pages and should show no sub-row');
  T.go('quiz');
  const sub = findAll(T.navBar(), n => hasClass(n,'nav-subbtn'));
  if(sub.length !== 5) throw new Error('Practice should show 5 sub-items (Study/Quiz/Test/Guided/Methods), got '+sub.length);
  const activeSub = sub.filter(n => hasClass(n,'active'));
  if(activeSub.length !== 1 || activeSub[0].innerHTML !== 'Quiz') throw new Error('Quiz sub-tab should be the active one, got '+JSON.stringify(activeSub.map(n=>n.innerHTML)));
});

check('guidedIntro and methodPicker still light up their parent sub-tab', ()=>{
  T.go('guidedIntro', {topicId:T.TOPICS[0].id});
  let sub = findAll(T.navBar(), n => hasClass(n,'nav-subbtn') && hasClass(n,'active'));
  if(sub.length !== 1 || sub[0].innerHTML !== 'Guided') throw new Error('guidedIntro should keep the Guided sub-tab active, got '+JSON.stringify(sub.map(n=>n.innerHTML)));
  T.go('methodPicker', {methodId:'typed-drill'});
  sub = findAll(T.navBar(), n => hasClass(n,'nav-subbtn') && hasClass(n,'active'));
  if(sub.length !== 1 || sub[0].innerHTML !== 'Modes') throw new Error('methodPicker should keep the Modes sub-tab active, got '+JSON.stringify(sub.map(n=>n.innerHTML)));
});

check('clicking an inactive top-level tab jumps to that group\'s first page', ()=>{
  T.go('settings');
  const tabs = findAll(T.navBar(), n => hasClass(n,'nav-btn'));
  const practiceTab = tabs.find(n => n.innerHTML.indexOf('Practice') !== -1);
  practiceTab.onclick();
  if(T.state.view !== 'study') throw new Error('Practice tab should land on Study by default, landed on '+T.state.view);
  const progressTab = findAll(T.navBar(), n => hasClass(n,'nav-btn')).find(n => n.innerHTML.indexOf('Stats') !== -1);
  progressTab.onclick();
  if(T.state.view !== 'history') throw new Error('Progress tab should land on History by default, landed on '+T.state.view);
});

check('clicking the already-active top-level tab does not reset the sub-page you are on', ()=>{
  T.go('test');
  const tabs = findAll(T.navBar(), n => hasClass(n,'nav-btn'));
  const practiceTab = tabs.find(n => n.innerHTML.indexOf('Practice') !== -1);
  practiceTab.onclick();
  if(T.state.view !== 'test') throw new Error('re-clicking the active Practice tab should not move off Test, moved to '+T.state.view);
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


/* ============================================================
   Upgrade pass: new decks, settings, home surfaces, reference
   ============================================================ */

check('every topic has an icon', ()=>{
  T.TOPICS.forEach(t=>{
    if(!T.TOPIC_ICONS[t.id]) throw new Error('no icon for topic '+t.id);
    if(!T.topicIcon(t.id)) throw new Error('topicIcon returned nothing for '+t.id);
  });
});

check('settings fall back to defaults and round-trip', ()=>{
  T.setProgress(T.migrateProgress({items:{}, streak:{count:0,last:null}}));
  const d = T.settings();
  if(d.quizSize !== 12 || d.typedFrom !== 2) throw new Error('unexpected defaults: '+JSON.stringify(d));
  if('dailyGoal' in d || 'reminderTime' in d) throw new Error('the removed daily-goal/reminder settings should not reappear: '+JSON.stringify(d));
  T.setSetting('quizSize', 20);
  if(T.settings().quizSize !== 20) throw new Error('setting did not stick');
  if(T.settings().testSize !== 30) throw new Error('unrelated setting was clobbered');
  T.setSetting('quizSize', 12);
});

check('migration backfills days from existing history without inventing a streak', ()=>{
  const p = T.migrateProgress({ items:{}, streak:{count:2,last:'2026-09-01'},
    history:[{date:'2026-08-30', mode:'quiz', label:'Quiz', correct:4, total:5, pct:80}] });
  if(p.days['2026-08-30'] !== 5) throw new Error('history day not backfilled: '+JSON.stringify(p.days));
  if(p.days['2026-09-01'] !== 1) throw new Error('streak day not backfilled: '+JSON.stringify(p.days));
  if(!p.settings || !Array.isArray(p.history)) throw new Error('migration left the shape incomplete');
});

check('answering a card logs a study day for the heatmap, with no goal attached to it', ()=>{
  T.setProgress(T.migrateProgress({items:{}, streak:{count:0,last:null}}));
  const today = new Date();
  const key = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
  const before = (T.getProgress().days && T.getProgress().days[key]) || 0;
  T.recordAnswer(T.ALL_ITEMS[0].id, true);
  T.recordAnswer(T.ALL_ITEMS[1].id, false);
  const after = T.getProgress().days[key];
  if(after !== before + 2) throw new Error('day counter did not advance: '+after);
  if(typeof T.answeredToday === 'function') throw new Error('answeredToday should have been removed along with the daily goal it existed for');
});

check('typedFrom setting actually controls when cards flip to typing', ()=>{
  T.setProgress(T.migrateProgress({items:{}, streak:{count:0,last:null}}));
  // A card correct twice sits at box 1 (starts at -1, +1 per correct).
  const item = T.ALL_ITEMS.find(it => !!(it.choices || it.pool));
  T.recordAnswer(item.id, true);
  T.recordAnswer(item.id, true);
  T.setSetting('typedFrom', 1);
  T.startSession('quiz', [item], 'probe');
  if(T.state.q.mode !== 'typed') throw new Error('expected typed at threshold 1, got '+T.state.q.mode);
  T.setSetting('typedFrom', 4);
  T.startSession('quiz', [item], 'probe');
  if(T.state.q.mode !== 'mc') throw new Error('expected mc at threshold 4, got '+T.state.q.mode);
  T.setSetting('typedFrom', 2);
});

check('missed-words deck collects every past miss, weakest first', ()=>{
  T.setProgress(T.migrateProgress({items:{}, streak:{count:0,last:null}}));
  if(T.missedItems().length !== 0) throw new Error('missed deck should start empty');
  const a = T.ALL_ITEMS[3], b = T.ALL_ITEMS[4];
  T.recordAnswer(a.id, false);                        // 0/1
  T.recordAnswer(b.id, false); T.recordAnswer(b.id, true); // 1/2
  const missed = T.missedItems();
  if(missed.length !== 2) throw new Error('expected 2 missed cards, got '+missed.length);
  if(missed[0].id !== a.id) throw new Error('worst hit-rate card should sort first');
  if(T.methodAvailability('missed').ready !== true) throw new Error('missed deck should be available with 2 cards');
});

check('missed deck is gated off when nothing has been missed', ()=>{
  T.setProgress(T.migrateProgress({items:{}, streak:{count:0,last:null}}));
  const av = T.methodAvailability('missed');
  if(av.ready) throw new Error('missed deck should be unavailable with an empty deck');
  if(!av.note) throw new Error('an unavailable deck should say why');
});

check('speed round is locked until 5 cards are mastered, then draws only from them', ()=>{
  T.setProgress(T.migrateProgress({items:{}, streak:{count:0,last:null}}));
  if(T.methodAvailability('speed').ready) throw new Error('speed should be locked with nothing mastered');
  const ids = T.ALL_ITEMS.slice(0, 6).map(it=>it.id);
  ids.forEach(id => { for(let i=0;i<4;i++) T.recordAnswer(id, true); }); // box 3 = mastered
  if(T.masteredItems().length < 5) throw new Error('setup failed to master enough cards');
  if(!T.methodAvailability('speed').ready) throw new Error('speed should unlock at 5 mastered');
  T.startMethod('speed', null);
  if(T.state.sessionMode !== 'speed') throw new Error('speed session did not start');
  if(!T.state.speedMs) throw new Error('speed session has no clock');
  T.state.sessionItems.forEach(it => {
    if(ids.indexOf(it.id) === -1) throw new Error('speed round pulled a non-mastered card: '+it.id);
  });
});

check('running out of time on a speed card counts as a miss', ()=>{
  const item = T.state.sessionItems[0];
  const boxBefore = T.getProgress().items[item.id].box;
  if(boxBefore < 3) throw new Error('setup: expected a mastered card');
  const fired = T.speedExpire(item);
  if(!fired) throw new Error('expire should have registered');
  const after = T.getProgress().items[item.id];
  if(after.box !== 0) throw new Error('timed-out card should drop to box 0, got '+after.box);
  if(T.speedExpire(item)) throw new Error('expire must not double-count once answered');
});

check('full-sentence deck only contains multi-word answers', ()=>{
  const sents = T.sentenceItems();
  if(sents.length < 5) throw new Error('expected some full-sentence cards, got '+sents.length);
  sents.forEach(it => {
    if(it.answer[0].trim().split(/\s+/).length < 3) throw new Error('short answer in sentence deck: '+it.answer[0]);
  });
});

check('listening deck only contains cards whose answer is the Spanish side', ()=>{
  const ok = ['conjugate','vocab-en2es','typed'];
  const items = T.listeningItems();
  if(items.length < 20) throw new Error('expected a usable listening pool, got '+items.length);
  items.forEach(it => { if(ok.indexOf(it.type) === -1) throw new Error('wrong type in listening deck: '+it.type); });
  // No speech synthesis in the harness, so the deck must report itself unusable.
  if(T.speechAvailable()) throw new Error('harness should not claim speech support');
  if(T.methodAvailability('listening').ready) throw new Error('listening should be gated off without speech support');
});

check('the new decks are drivable end to end', ()=>{
  T.setProgress(T.migrateProgress({items:{}, streak:{count:0,last:null}}));
  T.ALL_ITEMS.slice(0,8).forEach(it => T.recordAnswer(it.id, false));
  T.startMethod('missed', null);
  const n = T.state.sessionItems.length;
  if(!n) throw new Error('missed session empty');
  driveByClicking(T.state.sessionItems, 'missed', 'Missed-Words Deck');
  const sents = T.sentenceItems().slice(0,4);
  driveByClicking(sents, 'sentence', 'Full-Sentence Drill — All Topics', 'typed');
});

check('recommended session prefers due cards and never comes up short', ()=>{
  T.setProgress(T.migrateProgress({items:{}, streak:{count:0,last:null}}));
  const rec = T.recommendedSession(12);
  if(rec.length !== 12) throw new Error('recommended session should fill its quota, got '+rec.length);
  const ids = new Set(rec.map(r=>r.id));
  if(ids.size !== rec.length) throw new Error('recommended session repeated a card');
  if(!T.recommendReason()) throw new Error('recommendation should explain itself');
  // Mark a batch wrong so they are due today, then check they lead the queue.
  const due = T.ALL_ITEMS.slice(20, 32);
  due.forEach(it => T.recordAnswer(it.id, false));
  if(T.dueCount() < 12) throw new Error('expected 12 due cards, got '+T.dueCount());
  const dueIds = new Set(due.map(it=>it.id));
  const picked = T.recommendedSession(12).filter(it => dueIds.has(it.id)).length;
  if(picked !== 12) throw new Error('recommended session ignored due cards: '+picked+'/12');
});

check('final exam is the right size, unique, and leans on weak topics', ()=>{
  const exam = T.pickFinalExam(50);
  if(exam.length !== 50) throw new Error('expected 50 questions, got '+exam.length);
  const ids = new Set(exam.map(e=>e.id));
  if(ids.size !== 50) throw new Error('final exam repeated a card');
  const weak = T.weakestTopics(5);
  if(weak.length){
    const fromWeak = exam.filter(e => weak.indexOf(e.topic) !== -1).length;
    if(fromWeak < 10) throw new Error('final exam barely touched the weak topics: '+fromWeak);
  }
});

check('history filters narrow by method and by date', ()=>{
  const P = T.migrateProgress({items:{}, streak:{count:0,last:null}});
  P.history = [
    {date:'2020-01-01', ts:1, mode:'quiz', label:'Old Quiz', correct:5, total:10, pct:50},
    {date:new Date().toISOString().slice(0,10), ts:2, mode:'test', label:'New Test', correct:9, total:10, pct:90}
  ];
  T.setProgress(P);
  T.go('history', {histMode:'all', histRange:'all'});
  if(T.filteredHistory().length !== 2) throw new Error('unfiltered history should show both');
  T.go('history', {histMode:'test', histRange:'all'});
  if(T.filteredHistory().length !== 1 || T.filteredHistory()[0].mode !== 'test') throw new Error('method filter failed');
  T.go('history', {histMode:'all', histRange:'7'});
  const recent = T.filteredHistory();
  if(recent.length !== 1 || recent[0].label !== 'New Test') throw new Error('date filter failed: '+JSON.stringify(recent));
  T.historyView();
  T.go('history', {histMode:'all', histRange:'all'});
  T.historyView();
});

check('personal callout compares you only against your own past scores', ()=>{
  const P = T.migrateProgress({items:{}, streak:{count:0,last:null}});
  P.history = [
    {date:'2026-01-01', mode:'quiz', label:'q', correct:5, total:10, pct:50},
    {date:'2026-01-02', mode:'quiz', label:'q', correct:6, total:10, pct:60},
    {date:'2026-01-03', mode:'quiz', label:'q', correct:9, total:10, pct:90}
  ];
  T.setProgress(P);
  const msg = T.personalCallout(P.history);
  if(!msg || msg.indexOf('best') === -1) throw new Error('expected a personal-best callout, got '+msg);
  if(/friend|rank against|others/i.test(msg)) throw new Error('callout must not compare against other people');
  if(T.personalCallout(P.history.slice(0,2)) !== null) throw new Error('callout needs enough history first');
});

check('badges are all locked on a fresh account and unlock on real work', ()=>{
  T.setProgress(T.migrateProgress({items:{}, streak:{count:0,last:null}}));
  const fresh = T.badgeDefs();
  if(!fresh.length) throw new Error('no badges defined');
  fresh.forEach(b => { if(b.earned) throw new Error('badge earned on a fresh account: '+b.id); });
  driveByClicking(T.pickTopicSession('regular-verbs',4), 'quiz', 'Quiz — Regular Verbs');
  const after = T.badgeDefs().filter(b=>b.earned).map(b=>b.id);
  if(after.indexOf('first-session') === -1) throw new Error('first-session badge did not unlock');
});

check('home renders with all the new surfaces, and no forced daily goal or reminder nag', ()=>{
  T.go('home');
  const tree = T.homeView();
  if(!findAll(tree, n => hasClass(n,'recommend')).length) throw new Error('no recommended-session card');
  if(!findAll(tree, n => hasClass(n,'heat-grid')).length) throw new Error('no streak heatmap');
  if(!findAll(tree, n => hasClass(n,'badge')).length) throw new Error('no milestone badges');
  if(findAll(tree, n => hasClass(n,'goal-fill')).length) throw new Error('the daily-goal bar should be gone — the app should not impose a quota');
  if(findAll(tree, n => hasClass(n,'reminder-banner')).length) throw new Error('the reminder-nag banner should be gone along with the goal it existed to enforce');
});

check('settings page renders and every control is wired', ()=>{
  T.go('settings');
  const tree = T.settingsView();
  const buttons = findAll(tree, n => n.tagName === 'button');
  if(buttons.length < 10) throw new Error('settings page looks empty: '+buttons.length+' controls');
  buttons.forEach(b => { if(typeof b.onclick !== 'function') throw new Error('a settings control has no handler: '+b.innerHTML); });
});

check('reference sheets render for every topic and contain real rows', ()=>{
  T.go('reference'); T.referenceView();
  T.TOPICS.forEach(t=>{
    T.go('referenceSheet', {topicId:t.id});
    T.referenceSheetView();
    const rows = T.referenceRows(t.id);
    if(!rows.length) throw new Error('empty reference sheet for '+t.id);
    rows.forEach(r => { if(/[<>]/.test(r.q)) throw new Error('unstripped markup in reference row for '+t.id+': '+r.q); });
  });
});

check('no new Spanish was introduced by this upgrade', ()=>{
  // Standing rule for this project: decks are re-cuts of existing cards, never
  // new language content. 909 items was the count before the upgrade.
  if(T.ALL_ITEMS.length !== 909) throw new Error('item count changed to '+T.ALL_ITEMS.length+' — content must not be added without the owner asking');
  if(T.TOPICS.length !== 20) throw new Error('topic count changed to '+T.TOPICS.length);
});


/* ---------- upgrade pass: accents, keyboard, schedule visibility ---------- */

check('an answer that is right apart from its accents is correct, and says so', ()=>{
  T.setProgress(T.migrateProgress({items:{}, streak:{count:0,last:null}}));
  const item = T.ALL_ITEMS.find(it => /[áéíóúñ]/.test(it.answer[0]));
  if(!item) throw new Error('no accented answer in the deck to test against');
  const plain = item.answer[0].normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if(T.gradeAnswer(item, item.answer[0]) !== 'exact') throw new Error('the exact answer should grade exact');
  if(T.gradeAnswer(item, plain) !== 'accent') throw new Error('a missing accent should grade as accent, got '+T.gradeAnswer(item, plain));
  if(T.gradeAnswer(item, 'zzzz') !== 'wrong') throw new Error('nonsense should grade wrong');
});

check('strict accents turns a near miss into a miss, lenient does not', ()=>{
  const item = T.ALL_ITEMS.find(it => /[áéíóúñ]/.test(it.answer[0]));
  const plain = item.answer[0].normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  T.setSetting('strictAccents', true);
  if(T.gradeAnswer(item, plain) !== 'wrong') throw new Error('strict mode should reject a missing accent');
  if(T.gradeAnswer(item, item.answer[0]) !== 'exact') throw new Error('strict mode must still accept the exact answer');
  T.setSetting('strictAccents', false);
  if(T.gradeAnswer(item, plain) !== 'accent') throw new Error('lenient mode should accept it again');
});

check('ñ is treated as its own letter by the strict comparison', ()=>{
  if(T.normalizeStrict('año') === T.normalizeStrict('ano')) throw new Error('strict compare must distinguish ñ from n');
  if(T.normalizeStrict('AÑO ') !== T.normalizeStrict('año')) throw new Error('strict compare should still ignore case and padding');
});

check('an accent slip still advances the card rather than punishing it', ()=>{
  T.setProgress(T.migrateProgress({items:{}, streak:{count:0,last:null}}));
  const item = T.ALL_ITEMS.find(it => /[áéíóúñ]/.test(it.answer[0]));
  const plain = item.answer[0].normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  T.startSession('typed-drill', [item], 'probe', 'typed');
  const tree = T.sessionView();
  const input = findAll(tree, n => n.tagName === 'input')[0];
  const checkBtn = findAll(tree, n => n.tagName === 'button' && n.innerHTML === 'Check')[0];
  input.value = plain;
  checkBtn.onclick();
  const res = T.state.sessionResults[0];
  if(!res.correct || res.grade !== 'accent') throw new Error('expected a correct/accent result, got '+JSON.stringify({c:res.correct,g:res.grade}));
  if(T.getProgress().items[item.id].box !== 0) throw new Error('an accent slip should still count as a correct first rep');
  const fb = findAll(tree, n => hasClass(n,'feedback'))[0];
  if(!fb) throw new Error('no feedback rendered');
  const body = findAll(fb, n => /mind the accent/i.test(n.innerHTML||''));
  if(!body.length) throw new Error('feedback should name the accent explicitly');
});

check('multiple-choice options are numbered for the keyboard shortcut', ()=>{
  const mcItem = T.ALL_ITEMS.find(it => !!(it.choices || it.pool));
  T.startSession('mc-drill', [mcItem], 'probe', 'mc');
  const buttons = findAll(T.sessionView(), n => hasClass(n,'choice-btn'));
  buttons.forEach((b,i) => {
    if(b.innerHTML.indexOf('>'+(i+1)+'<') === -1) throw new Error('choice '+(i+1)+' is not labelled with its key');
  });
});

check('the 7-day forecast counts what the schedule will actually surface', ()=>{
  T.setProgress(T.migrateProgress({items:{}, streak:{count:0,last:null}}));
  const fc0 = T.dueForecast(7);
  if(fc0.length !== 7) throw new Error('expected 7 days, got '+fc0.length);
  if(fc0.reduce((s,d)=>s+d.count,0) !== 0) throw new Error('an untouched deck has nothing scheduled');
  // One wrong answer is due today; three correct in a row pushes a card to box
  // 2, whose interval is 3 days.
  const a = T.ALL_ITEMS[0], b = T.ALL_ITEMS[1];
  T.recordAnswer(a.id, false);
  for(let i=0;i<3;i++) T.recordAnswer(b.id, true);
  const fc = T.dueForecast(7);
  if(fc[0].count !== 1) throw new Error('the missed card should be due today, got '+fc[0].count);
  if(fc[3].count !== 1) throw new Error('the box-2 card should land 3 days out, got '+fc[3].count);
  if(fc[4].count !== 0) throw new Error('nothing else should be scheduled that week');
  findAll(T.forecastSection(), n => hasClass(n,'breakdown-row')).length === 7 || (()=>{throw new Error('forecast should render one row per day');})();
});

check('report card renders the forecast alongside everything else', ()=>{
  driveByClicking(T.pickTopicSession('regular-verbs',4), 'quiz', 'Quiz — Regular Verbs');
  T.go('grades');
  const tree = T.gradesView();
  const labels = findAll(tree, n => hasClass(n,'section-label')).map(n => n.innerHTML);
  if(!labels.some(l => /Coming Due/.test(l))) throw new Error('no Coming Due section on the report card');
});

check('signing in posts the local copy for merging instead of overwriting it', ()=>{
  T.setProgress(T.migrateProgress({items:{}, streak:{count:0,last:null}}));
  T.recordAnswer(T.ALL_ITEMS[2].id, true);
  T.AUTH.user = {sub:'s', email:'e@example.com', name:'E'};
  window.__clearFetchCalls__();
  T.pullProgress();
  const calls = window.__fetchCalls__().filter(c => String(c.url).indexOf('/api/progress') === 0);
  if(!calls.length) throw new Error('pull should talk to /api/progress');
  const put = calls.find(c => c.opts && c.opts.method === 'PUT');
  if(!put) throw new Error('pull must PUT the local copy so the server can reconcile it');
  const sent = JSON.parse(put.opts.body);
  if(!sent.items[T.ALL_ITEMS[2].id]) throw new Error('the local card practised while signed out was not sent up');
  T.AUTH.user = null;
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
