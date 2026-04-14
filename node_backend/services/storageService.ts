import { 
  BlobServiceClient, 
  StorageSharedKeyCredential, 
  generateBlobSASQueryParameters, 
  BlobSASPermissions,
  SASProtocol
} from "@azure/storage-blob";
import dotenv from "dotenv";

dotenv.config();

const AZURE_BLOB_ACCOUNT_NAME = process.env.AZURE_BLOB_ACCOUNT_NAME || "";
const AZURE_BLOB_ACCOUNT_KEY = process.env.AZURE_BLOB_ACCOUNT_KEY || "";
const AZURE_BLOB_CONTAINER_NAME = process.env.AZURE_BLOB_CONTAINER_NAME || "drhp-files";
const AZURE_BLOB_CONNECTION_STRING = process.env.AZURE_BLOB_STORAGE_CONNECTION_STRING;

// Create the BlobServiceClient
const blobServiceClient = AZURE_BLOB_CONNECTION_STRING 
  ? BlobServiceClient.fromConnectionString(AZURE_BLOB_CONNECTION_STRING)
  : new BlobServiceClient(
      `https://${AZURE_BLOB_ACCOUNT_NAME}.blob.core.windows.net`,
      new StorageSharedKeyCredential(AZURE_BLOB_ACCOUNT_NAME, AZURE_BLOB_ACCOUNT_KEY)
    );

const containerClient = blobServiceClient.getContainerClient(AZURE_BLOB_CONTAINER_NAME);

export const storageService = {
  /**
   * Generates a SAS URL for a blob that expires in a certain time
   * @param blobName The name of the blob
   * @param expiresMinutes Minutes until the SAS URL expires
   * @returns The full URL with SAS token
   */
  async getPresignedUrl(blobName: string, expiresMinutes: number = 60): Promise<string> {
    const blobClient = containerClient.getBlobClient(blobName);
    
    // If we have a connection string, we can try to parse credentials from it for SAS generation
    // but the easiest way is to use the account name and key directly if available.
    if (!AZURE_BLOB_ACCOUNT_NAME || !AZURE_BLOB_ACCOUNT_KEY) {
      // If no keys, we might need a different way to generate SAS if only connection string was used
      // For simplicity, we assume account name/key are provided as per user request
      throw new Error("Azure Storage Account Name and Key are required for SAS generation");
    }

    const sharedKeyCredential = new StorageSharedKeyCredential(
      AZURE_BLOB_ACCOUNT_NAME,
      AZURE_BLOB_ACCOUNT_KEY
    );

    const sasOptions = {
      containerName: AZURE_BLOB_CONTAINER_NAME,
      blobName: blobName,
      permissions: BlobSASPermissions.parse("r"), // Read only
      startsOn: new Date(),
      expiresOn: new Date(new Date().valueOf() + expiresMinutes * 60 * 1000),
      protocol: SASProtocol.HttpsAndHttp
    };

    const sasToken = generateBlobSASQueryParameters(sasOptions, sharedKeyCredential).toString();
    return `${blobClient.url}?${sasToken}`;
  },

  /**
   * Downloads a blob to a buffer
   * @param blobName The name of the blob
   * @returns The file content as a Buffer
   */
  async downloadFile(blobName: string): Promise<Buffer> {
    const blobClient = containerClient.getBlobClient(blobName);
    return await blobClient.downloadToBuffer();
  },

  /**
   * Deletes a blob from storage
   * @param blobName The name of the blob to delete
   */
  async deleteFile(blobName: string): Promise<void> {
    const blobClient = containerClient.getBlobClient(blobName);
    await blobClient.deleteIfExists();
  },

  /**
   * Uploads a buffer to storage
   * @param blobName The name of the blob
   * @param buffer The file content
   * @param contentType The MIME type
   */
  async uploadFile(blobName: string, buffer: Buffer, contentType: string): Promise<string> {
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: contentType }
    });
    return blobName;
  }
};
