import { MongoClient, Db, Document, IndexSpecification } from "mongodb";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

type SyncOptions = {
  batchSize: number;
  copyIndexes: boolean;
};

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== "string") return fallback;
  return ["1", "true", "yes", "y"].includes(value.trim().toLowerCase());
}

function buildIndexOptions(indexDef: any): Record<string, any> {
  const options: Record<string, any> = {};
  const allowed = [
    "name",
    "unique",
    "sparse",
    "expireAfterSeconds",
    "partialFilterExpression",
    "collation",
    "weights",
    "default_language",
    "language_override",
    "textIndexVersion",
    "2dsphereIndexVersion",
    "bits",
    "min",
    "max",
    "bucketSize",
    "wildcardProjection",
  ];

  for (const key of allowed) {
    if (typeof indexDef[key] !== "undefined") {
      options[key] = indexDef[key];
    }
  }

  return options;
}

async function copyIndexes(sourceDb: Db, targetDb: Db, collectionName: string) {
  const sourceCollection = sourceDb.collection(collectionName);
  const targetCollection = targetDb.collection(collectionName);
  const indexDefs = await sourceCollection.indexes();

  for (const indexDef of indexDefs) {
    if (indexDef.name === "_id_") continue;
    const keys = indexDef.key as Record<string, any>;
    const normalizedKeys: IndexSpecification = Object.fromEntries(
      Object.entries(keys).map(([field, direction]) => [field, direction as any])
    );
    const options = buildIndexOptions(indexDef);
    await targetCollection.createIndex(normalizedKeys, options);
  }
}

async function syncCollection(
  sourceDb: Db,
  targetDb: Db,
  collectionName: string,
  options: SyncOptions
) {
  const sourceCollection = sourceDb.collection(collectionName);
  const targetCollection = targetDb.collection(collectionName);

  if (options.copyIndexes) {
    await copyIndexes(sourceDb, targetDb, collectionName);
  }

  const cursor = sourceCollection.find({});
  let processed = 0;
  let batch: Document[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    await targetCollection.bulkWrite(
      batch.map((doc) => ({
        replaceOne: {
          filter: { _id: doc._id },
          replacement: doc,
          upsert: true,
        },
      })),
      { ordered: false }
    );
    processed += batch.length;
    batch = [];
  };

  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= options.batchSize) {
      await flush();
    }
  }

  await flush();
  return processed;
}

async function syncDatabase(
  sourceDb: Db,
  targetDb: Db,
  targetDbName: string,
  options: SyncOptions
) {
  console.log(`\n🔄 Sync started -> ${targetDbName}`);
  const collections = await sourceDb.listCollections({}, { nameOnly: true }).toArray();
  const userCollections = collections
    .map((c) => c.name)
    .filter((name) => !name.startsWith("system."));

  for (const collectionName of userCollections) {
    console.log(`   📦 ${collectionName} ...`);
    const total = await syncCollection(sourceDb, targetDb, collectionName, options);
    console.log(`      ✅ upserted ${total} documents`);
  }

  console.log(`✅ Sync completed -> ${targetDbName}`);
}

async function run() {
  const SOURCE_URI =
    process.env.MIGRATION_SOURCE_URI || process.env.MONGODB_URI || process.env.COSMOSDB_URI;
  const SOURCE_DB = process.env.MIGRATION_SOURCE_DB || "financial-doc-intelligence";
  const TARGET_BASE_URI = process.env.MIGRATION_TARGET_BASE_URI || "";
  const TARGET_DB_MAIN =
    process.env.MIGRATION_TARGET_DB_MAIN || "finanacialDocIntelligence";
  const TARGET_DB_DEVELOP =
    process.env.MIGRATION_TARGET_DB_DEVELOP || "financialDocIntellingence-develop";
  const BATCH_SIZE = Number(process.env.MIGRATION_BATCH_SIZE || "500");
  const COPY_INDEXES = parseBool(process.env.MIGRATION_COPY_INDEXES, true);

  if (!SOURCE_URI) {
    throw new Error(
      "Set MIGRATION_SOURCE_URI, MONGODB_URI, or COSMOSDB_URI for the source database connection."
    );
  }
  if (!TARGET_BASE_URI) {
    throw new Error(
      "MIGRATION_TARGET_BASE_URI is required for destination cluster connection."
    );
  }

  const sourceClient = new MongoClient(SOURCE_URI);
  const targetClient = new MongoClient(TARGET_BASE_URI);

  try {
    console.log("🚀 Connecting to source and target Mongo/Cosmos clusters...");
    await sourceClient.connect();
    await targetClient.connect();
    console.log("✅ Connected");

    const sourceDb = sourceClient.db(SOURCE_DB);
    const targetMainDb = targetClient.db(TARGET_DB_MAIN);
    const targetDevelopDb = targetClient.db(TARGET_DB_DEVELOP);

    const options: SyncOptions = {
      batchSize: Number.isFinite(BATCH_SIZE) && BATCH_SIZE > 0 ? BATCH_SIZE : 500,
      copyIndexes: COPY_INDEXES,
    };

    console.log(`\nSource DB: ${SOURCE_DB}`);
    console.log(`Target DB (main): ${TARGET_DB_MAIN}`);
    console.log(`Target DB (develop): ${TARGET_DB_DEVELOP}`);
    console.log(
      `Options: batchSize=${options.batchSize}, copyIndexes=${options.copyIndexes}`
    );

    await syncDatabase(sourceDb, targetMainDb, TARGET_DB_MAIN, options);
    await syncDatabase(sourceDb, targetDevelopDb, TARGET_DB_DEVELOP, options);

    console.log("\n🎉 Migration completed for both target databases.");
  } finally {
    await Promise.all([sourceClient.close(), targetClient.close()]);
  }
}

run().catch((error) => {
  console.error("❌ Migration failed:", error);
  process.exitCode = 1;
});
