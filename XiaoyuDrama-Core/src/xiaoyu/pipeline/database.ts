import db, { db as knexDb } from "@/utils/db";

const BASE_SCHEMA_DDL = [
  String.raw`CREATE TABLE IF NOT EXISTS "o_xiaoyuPipelineRun" (
    "id" TEXT PRIMARY KEY,
    "projectId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "qualityMode" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "currentNode" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "options" TEXT NOT NULL DEFAULT '{}',
    "errorReason" TEXT,
    "createdAt" INTEGER NOT NULL,
    "updatedAt" INTEGER NOT NULL,
    "startedAt" INTEGER,
    "finishedAt" INTEGER,
    "leaseOwner" TEXT,
    "leaseUntil" INTEGER
  )`,
  String.raw`CREATE TABLE IF NOT EXISTS "o_xiaoyuPipelineNode" (
    "id" TEXT PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "dependsOn" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "nextRunAt" INTEGER NOT NULL DEFAULT 0,
    "inputHash" TEXT,
    "checkpoint" TEXT NOT NULL DEFAULT '{}',
    "output" TEXT NOT NULL DEFAULT '{}',
    "errorReason" TEXT,
    "startedAt" INTEGER,
    "updatedAt" INTEGER NOT NULL,
    "finishedAt" INTEGER,
    UNIQUE ("runId", "key")
  )`,
  String.raw`CREATE TABLE IF NOT EXISTS "o_xiaoyuPipelineEvent" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT,
    "eventType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',
    "createdAt" INTEGER NOT NULL
  )`,
  String.raw`CREATE TABLE IF NOT EXISTS "o_xiaoyuPipelineArtifact" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "runId" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "artifactType" TEXT NOT NULL,
    "artifactTable" TEXT,
    "artifactId" TEXT,
    "filePath" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" INTEGER NOT NULL
  )`,
  String.raw`CREATE TABLE IF NOT EXISTS "o_xiaoyuEpisodeMaster" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "runId" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "scriptId" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "duration" REAL NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "fps" REAL NOT NULL DEFAULT 0,
    "qualityScore" INTEGER,
    "reportPath" TEXT,
    "errorReason" TEXT,
    "createdAt" INTEGER NOT NULL,
    "updatedAt" INTEGER NOT NULL,
    UNIQUE ("runId", "scriptId")
  )`,
  String.raw`CREATE TABLE IF NOT EXISTS "o_xiaoyuRemoteJob" (
    "idempotencyKey" TEXT PRIMARY KEY,
    "remoteJobId" TEXT,
    "capability" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "runId" TEXT,
    "nodeKey" TEXT,
    "projectId" INTEGER,
    "entityType" TEXT,
    "entityId" TEXT,
    "qualityMode" TEXT,
    "policyVersion" TEXT,
    "targetFilePath" TEXT,
    "localArtifactTable" TEXT,
    "localArtifactId" TEXT,
    "result" TEXT,
    "errorReason" TEXT,
    "createdAt" INTEGER NOT NULL,
    "updatedAt" INTEGER NOT NULL
  )`,
] as const;

const BASE_SCHEMA_INDEXES = [
  String.raw`CREATE INDEX IF NOT EXISTS "idx_xy_pipeline_run_project" ON "o_xiaoyuPipelineRun" ("projectId")`,
  String.raw`CREATE INDEX IF NOT EXISTS "idx_xy_pipeline_run_status" ON "o_xiaoyuPipelineRun" ("status")`,
  String.raw`CREATE INDEX IF NOT EXISTS "idx_xy_pipeline_node_run" ON "o_xiaoyuPipelineNode" ("runId")`,
  String.raw`CREATE INDEX IF NOT EXISTS "idx_xy_pipeline_node_status" ON "o_xiaoyuPipelineNode" ("status")`,
  String.raw`CREATE INDEX IF NOT EXISTS "idx_xy_pipeline_event_run" ON "o_xiaoyuPipelineEvent" ("runId")`,
  String.raw`CREATE INDEX IF NOT EXISTS "idx_xy_pipeline_event_node" ON "o_xiaoyuPipelineEvent" ("nodeId")`,
  String.raw`CREATE INDEX IF NOT EXISTS "idx_xy_pipeline_event_created" ON "o_xiaoyuPipelineEvent" ("createdAt")`,
  String.raw`CREATE INDEX IF NOT EXISTS "idx_xy_pipeline_artifact_run" ON "o_xiaoyuPipelineArtifact" ("runId")`,
  String.raw`CREATE INDEX IF NOT EXISTS "idx_xy_pipeline_artifact_node" ON "o_xiaoyuPipelineArtifact" ("nodeKey")`,
  String.raw`CREATE INDEX IF NOT EXISTS "idx_xy_episode_run" ON "o_xiaoyuEpisodeMaster" ("runId")`,
  String.raw`CREATE INDEX IF NOT EXISTS "idx_xy_episode_project" ON "o_xiaoyuEpisodeMaster" ("projectId")`,
  String.raw`CREATE INDEX IF NOT EXISTS "idx_xy_episode_script" ON "o_xiaoyuEpisodeMaster" ("scriptId")`,
  String.raw`CREATE INDEX IF NOT EXISTS "idx_xy_episode_status" ON "o_xiaoyuEpisodeMaster" ("status")`,
  String.raw`CREATE INDEX IF NOT EXISTS "idx_xy_remote_job_remote" ON "o_xiaoyuRemoteJob" ("remoteJobId")`,
  String.raw`CREATE INDEX IF NOT EXISTS "idx_xy_remote_job_status" ON "o_xiaoyuRemoteJob" ("status")`,
  String.raw`CREATE INDEX IF NOT EXISTS "idx_xy_remote_job_run" ON "o_xiaoyuRemoteJob" ("runId")`,
  String.raw`CREATE INDEX IF NOT EXISTS "idx_xy_remote_job_project" ON "o_xiaoyuRemoteJob" ("projectId")`,
] as const;

type RuntimeSchemaState = typeof globalThis & { __xiaoyuPipelineSchemaPromise?: Promise<void> };
const runtimeSchemaState = globalThis as RuntimeSchemaState;

function sqliteMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function isSqliteBusy(error: unknown): boolean { return /SQLITE_BUSY|database is locked/i.test(sqliteMessage(error)); }
function isDuplicateColumn(error: unknown): boolean { return /duplicate column name/i.test(sqliteMessage(error)); }
async function sleep(ms: number): Promise<void> { await new Promise<void>((resolve) => setTimeout(resolve, ms)); }

async function runDdl(sql: string): Promise<void> {
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try { await knexDb.raw(sql); return; }
    catch (error) {
      if (!isSqliteBusy(error) || attempt === 6) throw error;
      await sleep(25 * 2 ** attempt);
    }
  }
}
function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`非法 SQLite 标识符：${value}`);
  return `"${value}"`;
}
async function addColumn(tableName: string, columnName: string, type: "string" | "text" | "integer"): Promise<void> {
  if (!(await db.schema.hasTable(tableName))) return;
  if (await db.schema.hasColumn(tableName, columnName)) return;
  const sqlType = type === "integer" ? "INTEGER" : "TEXT";
  const sql = `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${sqlType}`;
  try { await runDdl(sql); }
  catch (error) { if (!isDuplicateColumn(error)) throw error; }
}
async function ensureXiaoyuPipelineSchemaInternal(): Promise<void> {
  await knexDb.raw("PRAGMA busy_timeout = 10000");
  for (const sql of BASE_SCHEMA_DDL) await runDdl(sql);
  for (const sql of BASE_SCHEMA_INDEXES) await runDdl(sql);
  await addColumn("o_project", "qualityMode", "string");
  await addColumn("o_project", "computePresetVersion", "string");
  await addColumn("o_xiaoyuPipelineNode", "revision", "integer");
  await addColumn("o_xiaoyuRemoteJob", "targetFilePath", "text");
  await addColumn("o_xiaoyuRemoteJob", "localArtifactTable", "string");
  await addColumn("o_xiaoyuRemoteJob", "localArtifactId", "string");
  if ((await db.schema.hasTable("o_xiaoyuPipelineNode")) && (await db.schema.hasColumn("o_xiaoyuPipelineNode", "revision"))) {
    await db("o_xiaoyuPipelineNode").whereNull("revision").update({ revision: 0 });
  }
}
export function ensureXiaoyuPipelineSchema(): Promise<void> {
  if (!runtimeSchemaState.__xiaoyuPipelineSchemaPromise) {
    runtimeSchemaState.__xiaoyuPipelineSchemaPromise = ensureXiaoyuPipelineSchemaInternal().catch((error) => {
      delete runtimeSchemaState.__xiaoyuPipelineSchemaPromise;
      throw error;
    });
  }
  return runtimeSchemaState.__xiaoyuPipelineSchemaPromise;
}
