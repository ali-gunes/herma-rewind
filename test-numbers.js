const numberParts = [
    'doksan', 'seksen', 'yetmiş', 'altmış', 'elli', 'kırk', 'otuz', 'yirmi',
    'sıfır', 'sekiz', 'yedi', 'dört', 'beş', 'altı', 'üç', 'iki',
    'dokuz', 'bin', 'yüz', 'bir', 'on'
];
const numberValues = {
    'sıfır':0,'bir':1,'iki':2,'üç':3,'dört':4,'beş':5,'altı':6,'yedi':7,'sekiz':8,'dokuz':9,
    'on':10,'yirmi':20,'otuz':30,'kırk':40,'elli':50,'altmış':60,'yetmiş':70,'seksen':80,'doksan':90,
    'yüz':100,'bin':1000
};
const singleDigits = {
    'sıfır':'0','bir':'1','iki':'2','üç':'3','dört':'4',
    'beş':'5','altı':'6','yedi':'7','sekiz':'8','dokuz':'9'
};

function splitCompound(word) {
    const result = [];
    let rem = word;
    while (rem.length > 0) {
        let matched = false;
        for (const p of numberParts) {
            if (rem.startsWith(p)) {
                result.push(p);
                rem = rem.slice(p.length);
                matched = true;
                break;
            }
        }
        if (!matched) return null;
    }
    return result.length > 1 ? result : null;
}

function numSeqToStr(tokens) {
    const allSingle = tokens.every(t => singleDigits[t] !== undefined);
    const hasSifir = tokens.includes('sıfır');
    if (hasSifir || (allSingle && tokens.length > 1)) {
        return tokens.map(t => singleDigits[t] !== undefined ? singleDigits[t] : '?').join('');
    }
    let total = 0, pending = 0;
    for (const t of tokens) {
        const v = numberValues[t];
        if (v === 1000) { total += (pending || 1) * 1000; pending = 0; }
        else if (v === 100) { total += (pending || 1) * 100; pending = 0; }
        else { pending += v; }
    }
    return String(total + pending);
}

function processText(raw) {
    const cleaned = raw.toLowerCase().replace(/([^\d])-([^\d])/g, '$1 $2');
    const rawTokens = cleaned.split(/\s+/)
        .map(t => t.replace(/[.,!?;:'"()\[\]{}-]+/g, '').trim())
        .filter(Boolean);
    const tokens = [];
    for (const tok of rawTokens) {
        const exp = splitCompound(tok);
        if (exp) tokens.push(...exp);
        else tokens.push(tok);
    }
    const output = [];
    let run = [];
    const flush = () => { if (run.length) { output.push(numSeqToStr(run)); run = []; } };
    for (const tok of tokens) {
        if (numberValues[tok] !== undefined) run.push(tok);
        else { flush(); output.push(tok); }
    }
    flush();
    return output;
}

const tests = [
    // [input, expectedTokens]
    ['yüzaltı hazır',             ['106', 'hazır']],
    ['yüz altı hazır',            ['106', 'hazır']],
    ['yüz beş hazır',             ['105', 'hazır']],
    ['bir sıfır altı hazır',      ['106', 'hazır']],
    ['bir sıfır sıfır beş hazır', ['1005', 'hazır']],
    ['bin beş hazır',             ['1005', 'hazır']],
    ['bin yüz on yedi hazır',     ['1117', 'hazır']],
    ['iki yüz on beş hazır',      ['215', 'hazır']],
    ['yüzaltı.',                  ['106']],
    ['hazır.',                    ['hazır']],
    ['yüzbeş teslim edildi',      ['105', 'teslim', 'edildi']],
    ['yus beş hazır.',            ['yus', '5', 'hazır']],
];

let passed = 0;
tests.forEach(([input, expected]) => {
    const result = processText(input);
    const ok = JSON.stringify(result) === JSON.stringify(expected);
    const icon = ok ? 'PASS' : 'FAIL';
    console.log(icon, JSON.stringify(input));
    if (!ok) {
        console.log('     Got:     ', JSON.stringify(result));
        console.log('     Expected:', JSON.stringify(expected));
    }
    if (ok) passed++;
});
console.log('\nPassed:', passed + '/' + tests.length);
