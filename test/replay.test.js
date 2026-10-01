// ALEPH 공개 fixture 재생 순서를 그대로 돌려 expected와 대조합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './fake-d1.js';
import { runFixture, runLive } from '../src/worker.js';
import { resetReplay, getState } from '../src/store.js';
import { FIXTURES } from '../src/fixtures.js';
import { compareRows } from '../src/core.js';

function check(state, f) {
  const e = f.expected;
  const id = f.fixture_id;
  assert.equal(state.status.freshness, e.freshness, `${id} freshness`);
  assert.equal(state.status.error_code, e.error_code, `${id} error_code`);
  assert.equal(state.row_count, e.row_count, `${id} row_count`);
  assert.equal(state.current_reading.normalized_value, e.stored_value, `${id} current value`);
  const latest = state.rows[state.rows.length - 1];
  assert.equal(latest.normalized_value, e.stored_value, `${id} stored row value`);
  assert.equal(state.delta, e.delta, `${id} delta`);
  if (e.record_date) assert.equal(state.current_reading.record_date, e.record_date, `${id} record_date`);
}

async function play(db, ids) {
  await resetReplay(db);
  let s;
  for (const id of ids) {
    await runFixture(db, FIXTURES[id], '2026-10-01T00:00:00.000Z');
    s = await getState(db, 'replay');
    check(s, FIXTURES[id]);
  }
  return s;
}

test('정상·일별 저장: D1-A → D1-B → D2', async () => {
  const db = createFakeD1();
  await resetReplay(db);
  await runFixture(db, FIXTURES['T04-NORMAL-D1-A']);
  const a = await getState(db, 'replay');
  await runFixture(db, FIXTURES['T04-NORMAL-D1-B']);
  const b = await getState(db, 'replay');
  assert.equal(a.rows[0].record_id, b.rows[0].record_id, 'same record id on same date');
  assert.equal(b.row_count, 1);
  const s = await play(db, ['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', 'T04-NORMAL-D2']);
  assert.equal(s.comparison.direction, 'increase');
  assert.equal(s.comparison.signed, 15);
});

for (const fid of ['T04-TIMEOUT', 'T04-AUTH-401', 'T04-RATE-429', 'T04-OFFLINE', 'T04-SCHEMA-BREAK']) {
  test(`실패 보존: ${fid}`, async () => {
    const db = createFakeD1();
    const s = await play(db, ['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', fid]);
    assert.equal(s.current_reading.normalized_value, 105);
    assert.equal(s.rows.length, 1);
  });
}

test('오류 뒤 회복: TIMEOUT → RECOVER-D2', async () => {
  const db = createFakeD1();
  const s = await play(db, ['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', 'T04-TIMEOUT', 'T04-RECOVER-D2']);
  assert.deepEqual(s.rows.map((r) => r.record_date), ['2026-08-24', '2026-08-25']);
});

test('RATE-429는 Retry-After를 기록', async () => {
  const db = createFakeD1();
  await play(db, ['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', 'T04-RATE-429']);
  const s = await getState(db, 'replay');
  assert.equal(s.last_run.retry_after_seconds, 60);
});

// ---- live adapter (외부 호출은 가짜 fetch로 대체) ----
const okBody = (t, time = '2026-10-01T05:15') => JSON.stringify({
  latitude: 37.55, longitude: 127, timezone: 'GMT',
  current_units: { time: 'iso8601', interval: 'seconds', temperature_2m: '°C' },
  current: { time, interval: 900, temperature_2m: t }
});
const resp = (status, body, headers = {}) => new Response(body, { status, headers });

test('live: 성공 → 같은 KST 날짜는 갱신, 다음 날짜는 새 행, 변화 재계산', async () => {
  const db = createFakeD1();
  await runLive(db, async () => resp(200, okBody(18.7)), () => new Date('2026-10-01T03:00:00Z'));
  await runLive(db, async () => resp(200, okBody(19.1)), () => new Date('2026-10-01T14:59:00Z')); // KST 23:59 같은 날
  let s = await getState(db, 'live');
  assert.equal(s.row_count, 1);
  assert.equal(s.rows[0].normalized_value, 19.1);
  assert.equal(s.rows[0].unit, '°C');
  assert.equal(s.rows[0].source_time, '2026-10-01T05:15:00.000Z');
  assert.ok(s.rows[0].raw_text.includes('19.1'), 'raw kept');
  await runLive(db, async () => resp(200, okBody(21.3, '2026-10-02T03:00')), () => new Date('2026-10-01T15:01:00Z')); // KST 10/2 00:01
  s = await getState(db, 'live');
  assert.equal(s.row_count, 2);
  assert.equal(s.comparison.signed, 2.2);
});

test('live: 실패 다섯 가지 분류, 마지막 정상값 보존', async () => {
  const db = createFakeD1();
  const now = () => new Date('2026-10-01T03:00:00Z');
  await runLive(db, async () => resp(200, okBody(18.7)), now);
  const cases = [
    ['auth', async () => resp(401, 'no')],
    ['auth', async () => resp(403, 'no')],
    ['rate_limit', async () => resp(429, 'slow', { 'retry-after': '30' })],
    ['offline', async () => { throw new TypeError('Network connection lost'); }],
    ['schema_error', async () => resp(200, JSON.stringify({ current: { temperature_2m: '18.7' } }))],
    ['schema_error', async () => resp(200, '<html>')],
    ['timeout', (_u, opt) => new Promise((_, rej) => opt.signal.addEventListener('abort', () => {
      const e = new Error('aborted'); e.name = 'AbortError'; rej(e);
    }))]
  ];
  for (const [code, f] of cases) {
    const r = await runLive(db, f, now);
    assert.equal(r.error_code, code);
    const s = await getState(db, 'live');
    assert.deepEqual(s.status, { freshness: 'stale', error_code: code });
    assert.equal(s.current_reading.normalized_value, 18.7);
    assert.equal(s.row_count, 1);
  }
});

test('replay reset은 live 기록을 지우지 않음', async () => {
  const db = createFakeD1();
  await runLive(db, async () => resp(200, okBody(18.7)), () => new Date('2026-10-01T03:00:00Z'));
  await play(db, ['T04-NORMAL-D1-A']);
  await resetReplay(db);
  assert.equal((await getState(db, 'live')).row_count, 1);
  assert.equal((await getState(db, 'replay')).row_count, 0);
});

test('변화 계산 반올림 규칙', () => {
  const rows = [{ signal_id: 's', record_date: '2026-10-01', normalized_value: 18.7, unit: '°C' }];
  const c = compareRows(rows, { signal_id: 's', record_date: '2026-10-02', normalized_value: 21.3, unit: '°C' });
  assert.equal(c.signed, 2.6);
  const m = compareRows(rows, { signal_id: 's', record_date: '2026-10-02', normalized_value: 70, unit: '°F' });
  assert.equal(m.state, 'unit_mismatch');
});
