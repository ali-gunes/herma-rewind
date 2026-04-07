const TRIGGER_REGEX = /\b(si?)?p[ae]?r[ıiae]?[şs]/i;
const tests = [
  ['sipariş', true],
  ['siparis', true],
  ['siparış', true],
  ['pariş', true],
  ['parış', true],
  ['paris', true],
  ['paraş', true],
  ['parış yüzaltı teslim', true],
  ['bugün hava güzel', false],
  ['yüzaltı hazır', false],
  ['siparız', false],
];
let ok = true;
tests.forEach(([t, expected]) => {
  const got = TRIGGER_REGEX.test(t);
  const pass = got === expected;
  if (!pass) ok = false;
  console.log(pass ? 'PASS' : 'FAIL', got ? 'TRIGGER' : 'ignore', JSON.stringify(t));
});
console.log(ok ? '\nAll pass!' : '\nSome failures!');
