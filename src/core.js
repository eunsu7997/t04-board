// 순수 로직: 정규화·검증·실패 분류·전일 대비 계산.
// live 어댑터와 replay 어댑터가 모두 이 파일의 함수만 거쳐 저장 계층으로 갑니다.

export const ERROR_CODES = Object.freeze(['timeout', 'auth', 'rate_limit', 'offline', 'schema_error']);
export const NORMALIZED_KEYS = Object.freeze([
  'signal_id', 'normalized_value', 'unit', 'source_name', 'source_url',
  'source_time', 'fetched_at', 'record_timezone', 'record_date'
]);
export const TIMEZONE = 'Asia/Seoul';

// ---- 실제 공개 원천: Open-Meteo 서울 현재 기온 (API 키 불필요) ----
export const LIVE_SOURCE = Object.freeze({
  signal_id: 'seoul-temperature-2m',
  source_name: 'Open-Meteo 예보 API (서울 현재 기온)',
  source_url:
    'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.978&current=temperature_2m&timezone=GMT',
  deadline_ms: 4000
});

export function kstDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) throw new TypeError('invalid date-time');
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function validateNormalizedReading(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new TypeError('reading must be an object');
  const a = Object.keys(r).sort();
  const e = [...NORMALIZED_KEYS].sort();
  if (a.length !== e.length || a.some((k, i) => k !== e[i])) throw new TypeError('reading keys mismatch');
  if (typeof r.signal_id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(r.signal_id) || r.signal_id.length > 100)
    throw new TypeError('signal_id invalid');
  if (typeof r.normalized_value !== 'number' || !Number.isFinite(r.normalized_value))
    throw new TypeError('normalized_value must be a finite number');
  for (const f of ['unit', 'source_name']) {
    if (typeof r[f] !== 'string' || r[f].trim() === '') throw new TypeError(`${f} must be non-empty`);
  }
  if (r.unit.length > 24 || r.source_name.length > 120) throw new TypeError('unit/source_name too long');
  let u;
  try { u = new URL(r.source_url); } catch { throw new TypeError('source_url invalid'); }
  if (u.protocol !== 'https:') throw new TypeError('source_url must be https');
  if (r.source_time !== null && (typeof r.source_time !== 'string' || Number.isNaN(new Date(r.source_time).getTime())))
    throw new TypeError('source_time invalid');
  if (typeof r.fetched_at !== 'string' || Number.isNaN(new Date(r.fetched_at).getTime()))
    throw new TypeError('fetched_at invalid');
  if (r.record_timezone !== TIMEZONE) throw new TypeError('record_timezone must be Asia/Seoul');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.record_date) || r.record_date !== kstDate(r.fetched_at))
    throw new TypeError('record_date must be Asia/Seoul date of fetched_at');
  return true;
}

// 전송 결과 → 성공/실패 분류. live와 replay가 같은 규칙을 씁니다.
// transport: { mode: 'http'|'timeout'|'offline', status, headers }
export function classifyTransport(transport) {
  if (transport.mode === 'timeout') return { ok: false, error_code: 'timeout' };
  if (transport.mode === 'offline') return { ok: false, error_code: 'offline' };
  const s = transport.status;
  if (s === 401 || s === 403) return { ok: false, error_code: 'auth' };
  if (s === 429) return { ok: false, error_code: 'rate_limit' };
  if (s >= 200 && s < 300) return { ok: true };
  return { ok: false, error_code: 'schema_error' }; // 그 밖의 예상하지 못한 응답
}

// Open-Meteo 원응답 → 정규화. 형식이 다르면 throw (→ schema_error).
export function normalizeOpenMeteo(body, fetchedAtIso) {
  const cur = body && body.current;
  const units = body && body.current_units;
  if (!cur || !units) throw new TypeError('missing current/current_units');
  const value = cur.temperature_2m;
  const unit = units.temperature_2m;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('temperature_2m not a number');
  if (typeof unit !== 'string' || unit.trim() === '') throw new TypeError('unit missing');
  if (typeof cur.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(cur.time))
    throw new TypeError('current.time format changed');
  if (body.timezone !== 'GMT') throw new TypeError('unexpected timezone in response');
  const reading = {
    signal_id: LIVE_SOURCE.signal_id,
    normalized_value: value,
    unit,
    source_name: LIVE_SOURCE.source_name,
    source_url: LIVE_SOURCE.source_url,
    source_time: new Date(cur.time + ':00Z').toISOString(), // 응답 time은 GMT 기준
    fetched_at: fetchedAtIso,
    record_timezone: TIMEZONE,
    record_date: kstDate(fetchedAtIso)
  };
  validateNormalizedReading(reading);
  return reading;
}

function decimalsOf(n) {
  const s = String(n);
  if (s.includes('e')) return 6;
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

// 어제 대비 변화 계산 규칙 (화면에도 같은 문장으로 표시):
// 오늘값 − 직전 날짜값, 두 값 중 더 긴 소수 자릿수로 반올림. 단위가 다르면 계산하지 않음.
export const DELTA_RULE_KO =
  '변화 = 이 날짜 저장값 − 직전 날짜 저장값 (두 값 중 긴 소수 자릿수로 반올림, 단위가 다르면 계산 안 함)';

export function compareRows(rows, current) {
  if (!current) return { state: 'insufficient', direction: null, magnitude: null, signed: null, unit: null, previous: null };
  const prev = rows
    .filter((r) => r.signal_id === current.signal_id && r.record_date < current.record_date)
    .sort((a, b) => b.record_date.localeCompare(a.record_date))[0];
  if (!prev) return { state: 'insufficient', direction: null, magnitude: null, signed: null, unit: null, previous: null };
  if (prev.unit !== current.unit)
    return { state: 'unit_mismatch', direction: null, magnitude: null, signed: null, unit: null, previous: prev.record_date };
  const d = Math.max(decimalsOf(current.normalized_value), decimalsOf(prev.normalized_value));
  const signed = Number((current.normalized_value - prev.normalized_value).toFixed(d));
  return {
    state: 'comparable',
    direction: signed > 0 ? 'increase' : signed < 0 ? 'decrease' : 'unchanged',
    magnitude: Math.abs(signed),
    signed,
    unit: current.unit,
    previous: prev.record_date
  };
}
