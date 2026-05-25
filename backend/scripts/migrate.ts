import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(
  __dirname,
  "../supabase/migrations/20260523000001_initial_schema.sql",
);

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "DATABASE_URL is required to run migrations.\n" +
        "Supabase Dashboard → Project Settings → Database → Connection string (URI)\n" +
        "Add to backend/.env as DATABASE_URL=postgresql://...\n" +
        "Or paste the SQL file into Supabase SQL Editor:\n" +
        migrationPath,
    );
    process.exit(1);
  }

  const sql = readFileSync(migrationPath, "utf8");
  const db = postgres(databaseUrl, { max: 1 });
  try {
    await db.unsafe(sql);
    console.log("Migration applied successfully.");
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
