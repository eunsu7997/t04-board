// node:sqlite로 만든 D1 흉내 (테스트 전용). prepare/bind/first/all/run/batch만 지원.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

export function createFakeD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const mk = (sql, args = []) => ({
    sql, args,
    bind: (...a) => mk(sql, a),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => { sqlite.prepare(sql).run(...args); return { success: true }; }
  });
  return {
    prepare: (sql) => mk(sql),
    batch: async (stmts) => {
      sqlite.exec('BEGIN');
      try { for (const s of stmts) sqlite.prepare(s.sql).run(...s.args); sqlite.exec('COMMIT'); }
      catch (e) { sqlite.exec('ROLLBACK'); throw e; }
      return stmts.map(() => ({ success: true }));
    }
  };
}
