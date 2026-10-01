-- ALEPH T04 오늘의 진짜 정보판 — D1 스키마
CREATE TABLE IF NOT EXISTS daily_readings (
  ns               TEXT NOT NULL CHECK (ns IN ('live', 'replay')),
  signal_id        TEXT NOT NULL,
  record_date      TEXT NOT NULL,          -- Asia/Seoul 날짜 (fetched_at 기준)
  record_id        TEXT NOT NULL,
  normalized_value REAL NOT NULL,
  unit             TEXT NOT NULL,
  source_name      TEXT NOT NULL,
  source_url       TEXT NOT NULL,
  source_time      TEXT,                   -- 원천 관측 시각 (UTC ISO)
  first_fetched_at TEXT NOT NULL,
  last_fetched_at  TEXT NOT NULL,          -- 조회 시각 (UTC ISO)
  record_timezone  TEXT NOT NULL CHECK (record_timezone = 'Asia/Seoul'),
  raw_text         TEXT,                   -- 원자료 (live: 원응답 본문, replay: fixture payload)
  reading_json     TEXT NOT NULL,
  PRIMARY KEY (ns, signal_id, record_date)
);

CREATE TABLE IF NOT EXISTS board_status (
  ns            TEXT PRIMARY KEY CHECK (ns IN ('live', 'replay')),
  freshness     TEXT NOT NULL CHECK (freshness IN ('fresh', 'stale')),
  error_code    TEXT NOT NULL CHECK (error_code IN ('none','timeout','auth','rate_limit','offline','schema_error')),
  current_json  TEXT,                      -- 마지막 정상값 (실패해도 유지)
  last_run_json TEXT,
  sequence      INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL,
  CHECK ((freshness = 'fresh' AND error_code = 'none') OR (freshness = 'stale' AND error_code <> 'none'))
);
