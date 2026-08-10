import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { pool } from './pool.js';

export async function migrate(
  database: Pool = pool,
  migrationsDir = resolve(process.cwd(), 'migrations'),
): Promise<void> {
  const client = await database.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

    for (const filename of files) {
      const already = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [
        filename,
      ]);
      if (already.rowCount) continue;

      const sql = await readFile(resolve(migrationsDir, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        console.log(`Applied migration ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  try {
    await migrate();
    await pool.end();
  } catch (error) {
    console.error(error);
    await pool.end();
    process.exitCode = 1;
  }
}
