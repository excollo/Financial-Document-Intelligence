import { S3Client } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
dotenv.config();

const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const CLOUDFLARE_URI = process.env.CLOUDFLARE_URI;

if (
  !R2_ACCESS_KEY_ID ||
  !R2_SECRET_ACCESS_KEY ||
  !R2_BUCKET_NAME ||
  !CLOUDFLARE_URI
) {
  throw new Error("Missing Cloudflare R2 environment variables");
}

export const r2Client = new S3Client({
  region: "auto", // Cloudflare R2 uses 'auto' region
  endpoint: CLOUDFLARE_URI,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true, // Required for R2 compatibility
});

export const R2_BUCKET = R2_BUCKET_NAME;
