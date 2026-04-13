import { BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";
import dotenv from "dotenv";

dotenv.config();

const AZURE_BLOB_ACCOUNT_NAME = process.env.AZURE_BLOB_ACCOUNT_NAME;
const AZURE_BLOB_ACCOUNT_KEY = process.env.AZURE_BLOB_ACCOUNT_KEY;
const AZURE_BLOB_CONTAINER_NAME = process.env.AZURE_BLOB_CONTAINER_NAME;
const AZURE_BLOB_CONNECTION_STRING = process.env.AZURE_BLOB_STORAGE_CONNECTION_STRING;

if (!AZURE_BLOB_ACCOUNT_NAME || !AZURE_BLOB_ACCOUNT_KEY || !AZURE_BLOB_CONTAINER_NAME) {
  console.warn("⚠️ Azure Blob Storage environment variables are missing");
}

// Create the BlobServiceClient
export const blobServiceClient = AZURE_BLOB_CONNECTION_STRING 
  ? BlobServiceClient.fromConnectionString(AZURE_BLOB_CONNECTION_STRING)
  : (AZURE_BLOB_ACCOUNT_NAME && AZURE_BLOB_ACCOUNT_KEY)
    ? new BlobServiceClient(
        `https://${AZURE_BLOB_ACCOUNT_NAME}.blob.core.windows.net`,
        new StorageSharedKeyCredential(AZURE_BLOB_ACCOUNT_NAME, AZURE_BLOB_ACCOUNT_KEY)
      )
    : null;

export const AZURE_BLOB_CONTAINER = AZURE_BLOB_CONTAINER_NAME || "drhp-files";
