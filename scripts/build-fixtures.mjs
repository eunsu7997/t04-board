// aleph-fixtures/*.json → src/fixtures.js 재생성 (fixture 원문을 Worker 번들에 넣기 위함)
import fs from 'node:fs';
const ids = {};
for (const f of fs.readdirSync('aleph-fixtures').sort()) {
  const j = JSON.parse(fs.readFileSync('aleph-fixtures/' + f, 'utf8'));
  ids[j.fixture_id] = j;
}
fs.writeFileSync('src/fixtures.js',
  '// 자동 생성: scripts/build-fixtures.mjs. ALEPH T04 공개 합성 fixture 9종 원문 그대로.\nexport const FIXTURES = ' +
  JSON.stringify(ids, null, 2) + ';\n');
console.log('fixtures:', Object.keys(ids).length);
