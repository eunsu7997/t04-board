// Cloudflare Worker: /api/* 처리. 정적 화면(public/)은 assets가 제공합니다.
// 비밀키를 쓰지 않습니다. Open-Meteo는 키 없이 공개 호출됩니다.
import { LIVE_SOURCE, classifyTransport, normalizeOpenMeteo, validateNormalizedReading, DELTA_RULE_KO } from './core.js';
import { applySuccess, applyError, resetReplay, getState } from './store.js';
import { FIXTURES } from './fixtures.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });

// ---- replay adapter: fixture의 transport/payload를 그대로 같은 분류·저장 경로에 넣음 ----
export async function runFixture(db, fixture, serverNow) {
  const meta = {
    fixture_id: fixture.fixture_id,
    virtual_now: fixture.virtual_now,
    server_now: serverNow,
    retry_after_seconds: fixture.transport.headers?.['retry-after'] ? Number(fixture.transport.headers['retry-after']) : null
  };
  const c = classifyTransport(fixture.transport);
  if (!c.ok) return applyError(db, 'replay', c.error_code, meta);
  try {
    validateNormalizedReading(fixture.payload);
  } catch (e) {
    return applyError(db, 'replay', 'schema_error', { ...meta, detail: String(e.message) });
  }
  return applySuccess(db, 'replay', fixture.payload, JSON.stringify(fixture.payload), meta);
}

// ---- live adapter: 실제 공개 원천 호출 → 같은 분류·정규화·저장 경로 ----
export async function runLive(db, fetchImpl = fetch, now = () => new Date()) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIVE_SOURCE.deadline_ms);
  let res;
  const fetchedAt = now().toISOString();
  try {
    res = await fetchImpl(LIVE_SOURCE.source_url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
  } catch (e) {
    clearTimeout(timer);
    const code = e && e.name === 'AbortError' ? 'timeout' : 'offline';
    await applyError(db, 'live', code, { detail: String(e && e.message) });
    return { outcome: 'error', error_code: code };
  }
  let text;
  try { text = await res.text(); } catch (e) {
    clearTimeout(timer);
    const code = e && e.name === 'AbortError' ? 'timeout' : 'offline';
    await applyError(db, 'live', code, { detail: 'body read failed' });
    return { outcome: 'error', error_code: code };
  }
  clearTimeout(timer);
  const c = classifyTransport({ mode: 'http', status: res.status });
  if (!c.ok) {
    const ra = res.headers.get('retry-after');
    await applyError(db, 'live', c.error_code, { retry_after_seconds: ra ? Number(ra) : null, detail: `HTTP ${res.status}` });
    return { outcome: 'error', error_code: c.error_code };
  }
  let reading;
  try {
    reading = normalizeOpenMeteo(JSON.parse(text), fetchedAt);
  } catch (e) {
    await applyError(db, 'live', 'schema_error', { detail: String(e.message) });
    return { outcome: 'error', error_code: 'schema_error' };
  }
  await applySuccess(db, 'live', reading, text, {});
  return { outcome: 'success', error_code: 'none' };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    const db = env.DB;
    const liveLocked = String(env.LIVE_LOCK || '').toLowerCase() === 'true';
    try {
      if (p === '/api/config' && request.method === 'GET') {
        return json({ live_lock: liveLocked, source: LIVE_SOURCE, timezone: 'Asia/Seoul', delta_rule_ko: DELTA_RULE_KO });
      }
      if (p === '/api/state' && request.method === 'GET') {
        const ns = url.searchParams.get('ns') === 'replay' ? 'replay' : 'live';
        return json(await getState(db, ns));
      }
      if (p === '/api/fixtures' && request.method === 'GET') {
        return json(Object.values(FIXTURES).map((f) => ({
          fixture_id: f.fixture_id, description_ko: f.description_ko, virtual_now: f.virtual_now, expected: f.expected
        })));
      }
      if (p === '/api/live/fetch' && request.method === 'POST') {
        if (liveLocked) return json({ error: 'live_locked', message_ko: '실제 날짜 2건 확보 후 실제 조회를 잠갔습니다. 저장된 기록을 보여 줍니다.' }, 423);
        const r = await runLive(db);
        return json({ ...r, state: await getState(db, 'live') });
      }
      if (p === '/api/replay/reset' && request.method === 'POST') {
        await resetReplay(db);
        return json({ ok: true, state: await getState(db, 'replay') });
      }
      if (p === '/api/replay/run' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const f = FIXTURES[body.fixture_id];
        if (!f) return json({ error: 'unknown_fixture' }, 400);
        await runFixture(db, f, new Date().toISOString());
        return json({ ok: true, fixture_id: f.fixture_id, expected: f.expected, state: await getState(db, 'replay') });
      }
      // 영수증용 payload: 실제 기록 한 날짜의 4개 필드를 저장값 그대로 돌려줌
      if (p === '/api/live/receipt-payload' && request.method === 'GET') {
        const date = url.searchParams.get('date');
        const st = await getState(db, 'live');
        const row = st.rows.find((r) => r.record_date === date);
        if (!row) return json({ error: 'not_found' }, 404);
        return json({ source_url: row.source_url, source_observed_at: row.source_time, normalized_value: row.normalized_value, unit: row.unit });
      }
      if (p.startsWith('/api/')) return json({ error: 'not_found' }, 404);
      return env.ASSETS.fetch(request);
    } catch (e) {
      return json({ error: 'server_error', message: String(e && e.message) }, 500);
    }
  }
};
