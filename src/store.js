// 저장 계층 (Cloudflare D1). ns = 'live'(실제 공개 원천) | 'replay'(합성 평가 상태).
// 두 네임스페이스는 같은 함수를 쓰지만 reset은 replay만 지웁니다.
import { compareRows, validateNormalizedReading, ERROR_CODES } from './core.js';

const NS = new Set(['live', 'replay']);
function assertNs(ns) { if (!NS.has(ns)) throw new TypeError('bad namespace'); }

export function recordIdFor(ns, r) { return `${ns}-${r.signal_id}-${r.record_date}`; }

// 같은 (ns, signal_id, record_date)는 한 행만. 행 갱신과 상태 갱신은 한 batch(트랜잭션)로 묶습니다.
export async function applySuccess(db, ns, reading, rawText, meta = {}) {
  assertNs(ns);
  validateNormalizedReading(reading);
  const now = meta.server_now || new Date().toISOString();
  const lastRun = JSON.stringify({
    fixture_id: meta.fixture_id ?? null, virtual_now: meta.virtual_now ?? null,
    outcome: 'success', error_code: 'none', retry_after_seconds: null, at: now
  });
  await db.batch([
    db.prepare(`
      INSERT INTO daily_readings
        (ns, signal_id, record_date, record_id, normalized_value, unit, source_name, source_url,
         source_time, first_fetched_at, last_fetched_at, record_timezone, raw_text, reading_json)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11, ?12, ?13)
      ON CONFLICT (ns, signal_id, record_date) DO UPDATE SET
        normalized_value = excluded.normalized_value,
        unit = excluded.unit,
        source_name = excluded.source_name,
        source_url = excluded.source_url,
        source_time = excluded.source_time,
        last_fetched_at = excluded.last_fetched_at,
        raw_text = excluded.raw_text,
        reading_json = excluded.reading_json`
    ).bind(ns, reading.signal_id, reading.record_date, recordIdFor(ns, reading), reading.normalized_value,
      reading.unit, reading.source_name, reading.source_url, reading.source_time, reading.fetched_at,
      reading.record_timezone, rawText ?? null, JSON.stringify(reading)),
    db.prepare(`
      INSERT INTO board_status (ns, freshness, error_code, current_json, last_run_json, sequence, updated_at)
      VALUES (?1, 'fresh', 'none', ?2, ?3, 1, ?4)
      ON CONFLICT (ns) DO UPDATE SET
        freshness = 'fresh', error_code = 'none', current_json = excluded.current_json,
        last_run_json = excluded.last_run_json, sequence = board_status.sequence + 1,
        updated_at = excluded.updated_at`
    ).bind(ns, JSON.stringify(reading), lastRun, now)
  ]);
}

// 실패는 행과 마지막 정상값(current_json)을 건드리지 않고 상태만 stale/error_code로 바꿉니다.
export async function applyError(db, ns, errorCode, meta = {}) {
  assertNs(ns);
  if (!ERROR_CODES.includes(errorCode)) throw new TypeError('unsupported error code');
  const now = meta.server_now || new Date().toISOString();
  const lastRun = JSON.stringify({
    fixture_id: meta.fixture_id ?? null, virtual_now: meta.virtual_now ?? null,
    outcome: 'error', error_code: errorCode, retry_after_seconds: meta.retry_after_seconds ?? null,
    detail: meta.detail ?? null, at: now
  });
  await db.prepare(`
    INSERT INTO board_status (ns, freshness, error_code, current_json, last_run_json, sequence, updated_at)
    VALUES (?1, 'stale', ?2, NULL, ?3, 1, ?4)
    ON CONFLICT (ns) DO UPDATE SET
      freshness = 'stale', error_code = excluded.error_code,
      last_run_json = excluded.last_run_json, sequence = board_status.sequence + 1,
      updated_at = excluded.updated_at`
  ).bind(ns, errorCode, lastRun, now).run();
}

// 합성 평가 상태만 빈 상태로 되돌립니다. live 기록에는 손대지 않습니다.
export async function resetReplay(db) {
  await db.batch([
    db.prepare(`DELETE FROM daily_readings WHERE ns = 'replay'`),
    db.prepare(`DELETE FROM board_status WHERE ns = 'replay'`)
  ]);
}

export async function getState(db, ns) {
  assertNs(ns);
  const { results } = await db.prepare(`
    SELECT record_id, signal_id, record_date, normalized_value, unit, source_name, source_url,
           source_time, first_fetched_at, last_fetched_at, record_timezone, raw_text
    FROM daily_readings WHERE ns = ?1 ORDER BY record_date ASC`).bind(ns).all();
  const st = await db.prepare(`SELECT * FROM board_status WHERE ns = ?1`).bind(ns).first();
  const current = st && st.current_json ? JSON.parse(st.current_json) : null;
  const comparison = compareRows(results, current);
  return {
    ns,
    rows: results,
    row_count: results.length,
    current_reading: current,
    status: st ? { freshness: st.freshness, error_code: st.error_code } : null,
    last_run: st && st.last_run_json ? JSON.parse(st.last_run_json) : null,
    sequence: st ? st.sequence : 0,
    comparison,
    delta: comparison.magnitude
  };
}
