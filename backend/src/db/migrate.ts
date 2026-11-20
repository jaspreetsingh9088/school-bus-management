import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as path from 'path';

export async function runMigrations(url = process.env.DATABASE_URL) {
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.join(__dirname, '../../drizzle') });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL is not set: skipping migrations');
    process.exit(0);
  }
  runMigrations().then(() => console.log('Migrations applied')).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
