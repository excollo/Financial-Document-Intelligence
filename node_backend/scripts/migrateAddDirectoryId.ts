import mongoose from "mongoose";
import dotenv from "dotenv";
import { Document } from "../models/Document";

dotenv.config();

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  await mongoose.connect(uri);
  console.log("Connected to MongoDB");

  const res = await Document.updateMany(
    { directoryId: { $exists: false } },
    { $set: { directoryId: null, isDeleted: false, deletedAt: null } }
  );
  console.log(`Updated ${res.modifiedCount} documents`);
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});








