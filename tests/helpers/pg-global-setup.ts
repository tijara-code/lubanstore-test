/**
 * The `pg` project's setup: one migrated template database per run on LM_TEST_PG_URL (each
 * harness clones it — a fresh database per test file, per harness), every database of the run
 * dropped at the end.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { TestProject } from "vitest/node";

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = "/" + name;
  return u.toString();
}

export default async function setup(project: TestProject) {
  const url = process.env.LM_TEST_PG_URL;
  if (!url) throw new Error("the pg project needs LM_TEST_PG_URL (postgres://user@host:port/anydb)");
  const run = "lmt" + Date.now().toString(36);
  const template = run + "_tpl";
  const admin = postgres(withDatabase(url, "postgres"), { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database "${template}"`);
  const m = postgres(withDatabase(url, template), { max: 1, prepare: false, onnotice: () => {} });
  try {
    await migrate(drizzle(m), { migrationsFolder: new URL("../../db/migrations", import.meta.url).pathname });
  } finally {
    await m.end();
  }
  project.provide("pgUrl", url);
  project.provide("pgTemplate", template);
  return async () => {
    const dbs = await admin<{ datname: string }[]>`select datname from pg_database where datname like ${run + "%"}`;
    for (const d of dbs) if (d.datname !== template) await admin.unsafe(`drop database if exists "${d.datname}" with (force)`);
    await admin.unsafe(`drop database if exists "${template}" with (force)`);
    await admin.end();
  };
}
