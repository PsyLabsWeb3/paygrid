import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import type { Sql } from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../supabase/migrations");

function getMigrationPaths() {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => join(migrationsDir, file));
}

function migrationVersion(migrationPath: string) {
  return migrationPath.split("/").pop()?.replace(/\.sql$/, "") ?? migrationPath;
}

async function ensureMigrationsTable(db: Sql) {
  await db`
    create table if not exists public.schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `;
}

async function hasTable(db: Sql, tableName: string) {
  const rows = await db`
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = ${tableName}
    limit 1
  `;
  return rows.length > 0;
}

async function hasColumn(db: Sql, tableName: string, columnName: string) {
  const rows = await db`
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = ${tableName}
      and column_name = ${columnName}
    limit 1
  `;
  return rows.length > 0;
}

async function hasEnumValue(db: Sql, enumName: string, enumValue: string) {
  const rows = await db`
    select 1
    from pg_type t
    join pg_enum e on t.oid = e.enumtypid
    where t.typname = ${enumName}
      and e.enumlabel = ${enumValue}
    limit 1
  `;
  return rows.length > 0;
}

async function migrationAlreadyPresent(db: Sql, version: string) {
  if (version.startsWith("20260523000001")) {
    return hasTable(db, "payment_links");
  }
  if (version.startsWith("20260528000002")) {
    return (
      (await hasColumn(db, "onramp_sessions", "provider_order_id")) &&
      (await hasColumn(db, "onramp_sessions", "provider_metadata"))
    );
  }
  if (version.startsWith("20260614000003")) {
    return hasEnumValue(db, "payment_method", "card");
  }
  if (version.startsWith("20260618000004")) {
    return hasColumn(db, "payment_links", "paygrid_link_address");
  }
  return false;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "DATABASE_URL is required to run migrations.\n" +
        "Supabase Dashboard → Project Settings → Database → Connection string (URI)\n" +
        "Add to backend/.env as DATABASE_URL=postgresql://...\n" +
        "Or paste the SQL file into Supabase SQL Editor:\n" +
        migrationsDir,
    );
    process.exit(1);
  }

  const migrationPaths = getMigrationPaths();
  if (migrationPaths.length === 0) {
    console.log("No migrations found.");
    return;
  }

  const db = postgres(databaseUrl, { max: 1 });
  try {
    await ensureMigrationsTable(db);

    let appliedCount = 0;
    let skippedCount = 0;
    for (const migrationPath of migrationPaths) {
      const version = migrationVersion(migrationPath);
      const applied = await db`
        select 1
        from public.schema_migrations
        where version = ${version}
        limit 1
      `;
      if (applied.length > 0) {
        console.log(`Skipping ${version}; already recorded.`);
        skippedCount++;
        continue;
      }

      if (await migrationAlreadyPresent(db, version)) {
        await db`
          insert into public.schema_migrations (version)
          values (${version})
          on conflict (version) do nothing
        `;
        console.log(`Skipping ${version}; already present in database.`);
        skippedCount++;
        continue;
      }

      const sql = readFileSync(migrationPath, "utf8");
      console.log(`Applying ${version}...`);
      await db.begin(async (tx) => {
        await tx.unsafe(sql);
        await tx`
          insert into public.schema_migrations (version)
          values (${version})
        `;
      });
      appliedCount++;
    }
    console.log(`Applied ${appliedCount} migration(s), skipped ${skippedCount}.`);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
