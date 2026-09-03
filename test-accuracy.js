const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const scriptBody = blocks.find(b => b.includes('(function(){'));
let code = scriptBody.replace('render();\n  initAuth();\n})();', `
window.__T__={VERBS:VERBS,REFLEXIVE_VERBS:REFLEXIVE_VERBS,GUSTAR_VERBS:GUSTAR_VERBS,SER_FORMS:SER_FORMS,ESTAR_FORMS:ESTAR_FORMS,TENER_IDIOMS:TENER_IDIOMS,INDEF_WORDS:INDEF_WORDS,PRONOUNS:PRONOUNS,SER_ESTAR_ITEMS:SER_ESTAR_ITEMS,PERO_SINO_ITEMS:PERO_SINO_ITEMS,INDEF_TRANSFORM_ITEMS:INDEF_TRANSFORM_ITEMS,INDEF_PERSONAL_A_ITEMS:INDEF_PERSONAL_A_ITEMS,FUTURE_PLAN_ITEMS:FUTURE_PLAN_ITEMS};
})();`);
if (!code.includes('window.__T__')) throw new Error('hook injection mismatch');
global.window = { scrollTo(){} };
global.localStorage = { getItem(){return null;}, setItem(){} };
global.document = { head:{appendChild(){}}, querySelector(){return {innerHTML:'',appendChild(){}};}, createElement(){return {className:'',innerHTML:'',style:{},classList:{add(){},remove(){}},appendChild(){},addEventListener(){}};} };
eval(code);
const T = window.__T__;

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('OK  ', name); }
  catch (e) { failures++; console.log('FAIL', name, '->', e.message); }
}
function expectForms(label, actual, expected) {
  check(label, () => {
    if (actual.length !== expected.length) throw new Error(`length ${actual.length} != ${expected.length}`);
    for (let i = 0; i < expected.length; i++) {
      if (actual[i] !== expected[i]) throw new Error(`person ${i} (${T.PRONOUNS[i]}): got "${actual[i]}", expected "${expected[i]}"`);
    }
  });
}
function findVerb(list, inf) {
  const v = list.find(x => x.inf === inf);
  if (!v) throw new Error('verb not found: ' + inf);
  return v;
}

console.log('--- ser / estar ---');
expectForms('ser', T.SER_FORMS, ['soy','eres','es','somos','sois','son']);
expectForms('estar', T.ESTAR_FORMS, ['estoy','estás','está','estamos','estáis','están']);

console.log('--- regular verbs ---');
expectForms('hablar', findVerb(T.VERBS.regular,'hablar').forms, ['hablo','hablas','habla','hablamos','habláis','hablan']);
expectForms('comer', findVerb(T.VERBS.regular,'comer').forms, ['como','comes','come','comemos','coméis','comen']);
expectForms('escribir', findVerb(T.VERBS.regular,'escribir').forms, ['escribo','escribes','escribe','escribimos','escribís','escriben']);

console.log('--- irregular yo-form verbs ---');
expectForms('hacer', findVerb(T.VERBS.irregularYo,'hacer').forms, ['hago','haces','hace','hacemos','hacéis','hacen']);
expectForms('poner', findVerb(T.VERBS.irregularYo,'poner').forms, ['pongo','pones','pone','ponemos','ponéis','ponen']);
expectForms('salir', findVerb(T.VERBS.irregularYo,'salir').forms, ['salgo','sales','sale','salimos','salís','salen']);
expectForms('suponer', findVerb(T.VERBS.irregularYo,'suponer').forms, ['supongo','supones','supone','suponemos','suponéis','suponen']);
expectForms('traer', findVerb(T.VERBS.irregularYo,'traer').forms, ['traigo','traes','trae','traemos','traéis','traen']);
expectForms('ver', findVerb(T.VERBS.irregularYo,'ver').forms, ['veo','ves','ve','vemos','veis','ven']);
expectForms('oír', findVerb(T.VERBS.irregularYo,'oír').forms, ['oigo','oyes','oye','oímos','oís','oyen']);

console.log('--- tener / venir / ir ---');
expectForms('tener', findVerb(T.VERBS.tenerVenir,'tener').forms, ['tengo','tienes','tiene','tenemos','tenéis','tienen']);
expectForms('venir', findVerb(T.VERBS.tenerVenir,'venir').forms, ['vengo','vienes','viene','venimos','venís','vienen']);
expectForms('ir', findVerb(T.VERBS.ir,'ir').forms, ['voy','vas','va','vamos','vais','van']);

console.log('--- e:ie stem-changing ---');
expectForms('empezar', findVerb(T.VERBS.stemEIE,'empezar').forms, ['empiezo','empiezas','empieza','empezamos','empezáis','empiezan']);
expectForms('cerrar', findVerb(T.VERBS.stemEIE,'cerrar').forms, ['cierro','cierras','cierra','cerramos','cerráis','cierran']);
expectForms('comenzar', findVerb(T.VERBS.stemEIE,'comenzar').forms, ['comienzo','comienzas','comienza','comenzamos','comenzáis','comienzan']);
expectForms('entender', findVerb(T.VERBS.stemEIE,'entender').forms, ['entiendo','entiendes','entiende','entendemos','entendéis','entienden']);
expectForms('pensar', findVerb(T.VERBS.stemEIE,'pensar').forms, ['pienso','piensas','piensa','pensamos','pensáis','piensan']);
expectForms('perder', findVerb(T.VERBS.stemEIE,'perder').forms, ['pierdo','pierdes','pierde','perdemos','perdéis','pierden']);
expectForms('preferir', findVerb(T.VERBS.stemEIE,'preferir').forms, ['prefiero','prefieres','prefiere','preferimos','preferís','prefieren']);
expectForms('querer', findVerb(T.VERBS.stemEIE,'querer').forms, ['quiero','quieres','quiere','queremos','queréis','quieren']);

console.log('--- o:ue stem-changing ---');
expectForms('volver', findVerb(T.VERBS.stemOUE,'volver').forms, ['vuelvo','vuelves','vuelve','volvemos','volvéis','vuelven']);
expectForms('almorzar', findVerb(T.VERBS.stemOUE,'almorzar').forms, ['almuerzo','almuerzas','almuerza','almorzamos','almorzáis','almuerzan']);
expectForms('contar', findVerb(T.VERBS.stemOUE,'contar').forms, ['cuento','cuentas','cuenta','contamos','contáis','cuentan']);
expectForms('dormir', findVerb(T.VERBS.stemOUE,'dormir').forms, ['duermo','duermes','duerme','dormimos','dormís','duermen']);
expectForms('encontrar', findVerb(T.VERBS.stemOUE,'encontrar').forms, ['encuentro','encuentras','encuentra','encontramos','encontráis','encuentran']);
expectForms('mostrar', findVerb(T.VERBS.stemOUE,'mostrar').forms, ['muestro','muestras','muestra','mostramos','mostráis','muestran']);
expectForms('poder', findVerb(T.VERBS.stemOUE,'poder').forms, ['puedo','puedes','puede','podemos','podéis','pueden']);
expectForms('recordar', findVerb(T.VERBS.stemOUE,'recordar').forms, ['recuerdo','recuerdas','recuerda','recordamos','recordáis','recuerdan']);
expectForms('jugar', findVerb(T.VERBS.jugar,'jugar').forms, ['juego','juegas','juega','jugamos','jugáis','juegan']);

console.log('--- e:i stem-changing ---');
expectForms('pedir', findVerb(T.VERBS.stemEI,'pedir').forms, ['pido','pides','pide','pedimos','pedís','piden']);
expectForms('conseguir', findVerb(T.VERBS.stemEI,'conseguir').forms, ['consigo','consigues','consigue','conseguimos','conseguís','consiguen']);
expectForms('decir', findVerb(T.VERBS.stemEI,'decir').forms, ['digo','dices','dice','decimos','decís','dicen']);
expectForms('repetir', findVerb(T.VERBS.stemEI,'repetir').forms, ['repito','repites','repite','repetimos','repetís','repiten']);
expectForms('seguir', findVerb(T.VERBS.stemEI,'seguir').forms, ['sigo','sigues','sigue','seguimos','seguís','siguen']);

console.log('--- reflexive verbs ---');
expectForms('acordarse de', findVerb(T.REFLEXIVE_VERBS,'acordarse de').forms, ['me acuerdo','te acuerdas','se acuerda','nos acordamos','os acordáis','se acuerdan']);
expectForms('acostarse', findVerb(T.REFLEXIVE_VERBS,'acostarse').forms, ['me acuesto','te acuestas','se acuesta','nos acostamos','os acostáis','se acuestan']);
expectForms('afeitarse', findVerb(T.REFLEXIVE_VERBS,'afeitarse').forms, ['me afeito','te afeitas','se afeita','nos afeitamos','os afeitáis','se afeitan']);
expectForms('arreglarse', findVerb(T.REFLEXIVE_VERBS,'arreglarse').forms, ['me arreglo','te arreglas','se arregla','nos arreglamos','os arregláis','se arreglan']);
expectForms('bañarse', findVerb(T.REFLEXIVE_VERBS,'bañarse').forms, ['me baño','te bañas','se baña','nos bañamos','os bañáis','se bañan']);
expectForms('cepillarse', findVerb(T.REFLEXIVE_VERBS,'cepillarse').forms, ['me cepillo','te cepillas','se cepilla','nos cepillamos','os cepilláis','se cepillan']);
expectForms('despertarse', findVerb(T.REFLEXIVE_VERBS,'despertarse').forms, ['me despierto','te despiertas','se despierta','nos despertamos','os despertáis','se despiertan']);
expectForms('dormirse', findVerb(T.REFLEXIVE_VERBS,'dormirse').forms, ['me duermo','te duermes','se duerme','nos dormimos','os dormís','se duermen']);
expectForms('ducharse', findVerb(T.REFLEXIVE_VERBS,'ducharse').forms, ['me ducho','te duchas','se ducha','nos duchamos','os ducháis','se duchan']);
expectForms('enojarse con', findVerb(T.REFLEXIVE_VERBS,'enojarse con').forms, ['me enojo','te enojas','se enoja','nos enojamos','os enojáis','se enojan']);
expectForms('irse', findVerb(T.REFLEXIVE_VERBS,'irse').forms, ['me voy','te vas','se va','nos vamos','os vais','se van']);
expectForms('lavarse', findVerb(T.REFLEXIVE_VERBS,'lavarse').forms, ['me lavo','te lavas','se lava','nos lavamos','os laváis','se lavan']);
expectForms('levantarse', findVerb(T.REFLEXIVE_VERBS,'levantarse').forms, ['me levanto','te levantas','se levanta','nos levantamos','os levantáis','se levantan']);
expectForms('llamarse', findVerb(T.REFLEXIVE_VERBS,'llamarse').forms, ['me llamo','te llamas','se llama','nos llamamos','os llamáis','se llaman']);
expectForms('maquillarse', findVerb(T.REFLEXIVE_VERBS,'maquillarse').forms, ['me maquillo','te maquillas','se maquilla','nos maquillamos','os maquilláis','se maquillan']);
expectForms("peinarse", findVerb(T.REFLEXIVE_VERBS,'peinarse').forms, ['me peino','te peinas','se peina','nos peinamos','os peináis','se peinan']);
expectForms('ponerse (la ropa)', findVerb(T.REFLEXIVE_VERBS,'ponerse (la ropa)').forms, ['me pongo','te pones','se pone','nos ponemos','os ponéis','se ponen']);
expectForms('preocuparse por', findVerb(T.REFLEXIVE_VERBS,'preocuparse por').forms, ['me preocupo','te preocupas','se preocupa','nos preocupamos','os preocupáis','se preocupan']);
expectForms('probarse', findVerb(T.REFLEXIVE_VERBS,'probarse').forms, ['me pruebo','te pruebas','se prueba','nos probamos','os probáis','se prueban']);
expectForms('quedarse', findVerb(T.REFLEXIVE_VERBS,'quedarse').forms, ['me quedo','te quedas','se queda','nos quedamos','os quedáis','se quedan']);
expectForms('quitarse', findVerb(T.REFLEXIVE_VERBS,'quitarse').forms, ['me quito','te quitas','se quita','nos quitamos','os quitáis','se quitan']);
expectForms('secarse', findVerb(T.REFLEXIVE_VERBS,'secarse').forms, ['me seco','te secas','se seca','nos secamos','os secáis','se secan']);
expectForms('sentarse', findVerb(T.REFLEXIVE_VERBS,'sentarse').forms, ['me siento','te sientas','se sienta','nos sentamos','os sentáis','se sientan']);
expectForms('sentirse', findVerb(T.REFLEXIVE_VERBS,'sentirse').forms, ['me siento','te sientes','se siente','nos sentimos','os sentís','se sienten']);
expectForms('vestirse', findVerb(T.REFLEXIVE_VERBS,'vestirse').forms, ['me visto','te vistes','se viste','nos vestimos','os vestís','se visten']);

console.log('--- ser/estar usage examples: sanity (choice must include the marked answer) ---');
T.SER_ESTAR_ITEMS.forEach((it,i) => check('ser-estar usage #'+i, () => {
  if (!it.choices.includes(it.answer[0])) throw new Error('answer not among its own choices');
}));

console.log('--- pero/sino: sino only when a negation is being replaced ---');
T.PERO_SINO_ITEMS.forEach((it,i) => check('pero/sino #'+i+': '+it.prompt, () => {
  const firstClauseNegative = /\bno\b/i.test(it.prompt.split(',')[0]) || /^no\s/i.test(it.prompt);
  if (it.answer === 'sino' && !firstClauseNegative) throw new Error('marked sino but first clause has no "no": '+it.prompt);
}));

console.log('--- indefinite/negative transforms: answers must not contain an affirmative word ---');
const AFFIRMATIVE_LEAKS = [' alguien', ' algo ', ' alguno', ' alguna', ' siempre', ' también'];
T.INDEF_TRANSFORM_ITEMS.forEach((it,i) => check('indef transform #'+i, () => {
  it.answers.forEach(a => {
    const lower = ' '+a.toLowerCase()+' ';
    AFFIRMATIVE_LEAKS.forEach(word => {
      if (lower.includes(word)) throw new Error(`negative-transform answer still contains "${word.trim()}": "${a}"`);
    });
  });
}));

console.log('--- future-plan translations: every answer must start with the right subject ---');
T.FUTURE_PLAN_ITEMS.forEach((it,i) => check('future-plan #'+i, () => {
  if (!it.answers.length) throw new Error('no accepted answers');
}));

console.log(failures===0 ? 'ALL ACCURACY CHECKS PASSED' : (failures+' FAILURES'));
process.exit(failures===0 ? 0 : 1);
