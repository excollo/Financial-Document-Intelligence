import axios from "axios";
import { SessionData } from "./sessionService";
import { documentService } from "@/services/api";

const N8N_WEBHOOK_URL = import.meta.env.VITE_N8N_WEBHOOK_URL;

export interface UploadResponse {
  success: boolean;
  error?: string;
  documentId?: string;
  namespace?: string;
  status: "processing" | "completed" | "failed";
  message?: string;
  document?: any;
}

export interface DocumentStatusResponse {
  status: "processing" | "completed" | "failed";
  documentId?: string;
  namespace?: string;
  error?: string;
  message?: string;
}

export interface ExistingDocumentResponse {
  exists: boolean;
  document?: any;
  message: string;
}

export const uploadService = {
  normalizeNamespace(fileName: string): string {
    let s = fileName.trim();
    // Keep .pdf extension - don't remove it
    s = s.replace(/[\-_]+/g, " ");
    s = s.replace(/\s+/g, " ");
    return s.trim();
  },
  // async uploadFile(
  //   file: File,
  //   sessionData: SessionData
  // ): Promise<UploadResponse> {
  //   try {
  //     const formData = new FormData();
  //     formData.append("file", file);
  //     formData.append("session_id", sessionData.id);
  //     formData.append("timestamp", new Date().toISOString());
  //     formData.append("action", "upload");
  //     formData.append("namespace",file.name.replace(".pdf", ""));
  //     formData.append("filename", file.name.replace(".pdf", ""));

  //     const uploadResponse = await axios.post(N8N_WEBHOOK_URL, formData, {
  //       headers: { "Content-Type": "multipart/form-data" },
  //       timeout: 300000, // 5 minutes timeout for processing
  //     });

  //     console.log("Form response:", formData);

  //     // Store document in MongoDB
  //     if (uploadResponse.data.success) {
  //       try {
  //         const documentData = {
  //           id: uploadResponse.data.documentId || sessionData.id,
  //           name: file.name,
  //           namespace: file.name,
  //           status: uploadResponse.data.status || "processing",
  //           uploadedAt: new Date().toISOString(),
  //         };

  //         await documentService.create(documentData);
  //         console.log("Document stored in MongoDB:", documentData);

  //         // If the document is still processing, poll for status
  //         if (documentData.status === "processing") {
  //           let attempts = 0;
  //           const maxAttempts = 60; // 5 minutes with 5-second intervals
  //           const pollInterval = 5000; // 5 seconds

  //           while (attempts < maxAttempts) {
  //             await new Promise((resolve) => setTimeout(resolve, pollInterval));
  //             const statusResponse = await this.checkDocumentStatus(
  //               documentData.id,
  //               sessionData
  //             );

  //             if (statusResponse.status !== "processing") {
  //               // Update document status in MongoDB
  //               await documentService.update(documentData.id, {
  //                 status: statusResponse.status,
  //               });
  //               return {
  //                 success: true,
  //                 documentId: documentData.id,
  //                 namespace: documentData.namespace,
  //                 status: statusResponse.status,
  //                 message: statusResponse.message,
  //               };
  //             }
  //             attempts++;
  //           }
  //         }
  //       } catch (dbError) {
  //         console.error("Error storing document in MongoDB:", dbError);
  //       }
  //     }

  //     return {
  //       success: uploadResponse.data.success,
  //       error: uploadResponse.data.error,
  //       documentId: uploadResponse.data.documentId || sessionData.id,
  //       namespace:
  //         uploadResponse.data.namespace || file.name.replace(".pdf", ""),
  //       status: uploadResponse.data.status || "processing",
  //       message: uploadResponse.data.message,
  //     };
  //   } catch (error) {
  //     console.error("Error uploading file:", error);
  //     return {
  //       success: false,
  //       error: error instanceof Error ? error.message : "Upload failed",
  //       status: "failed",
  //     };
  //   }
  // },

  async checkDocumentStatus(
    documentId: string,
    sessionData: SessionData
  ): Promise<DocumentStatusResponse> {
    try {
      // Fetch document from backend
      const doc = await documentService.getById(documentId);
      return {
        status: doc.status || "failed",
        documentId: doc.id,
        namespace: doc.namespace,
        message:
          doc.status === "processing"
            ? "Document is still processing."
            : doc.status === "completed"
              ? "Document processing completed."
              : "Document processing failed.",
      };
    } catch (error) {
      console.error("Error checking document status from backend:", error);
      return {
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  async checkExistingDocument(
    fileName: string
  ): Promise<ExistingDocumentResponse> {
    try {
      // Use full filename with .pdf extension
      const namespace = fileName;
      const response = await documentService.checkExistingByNamespace(
        namespace
      );
      return response;
    } catch (error) {
      console.error("Error checking existing document:", error);
      return {
        exists: false,
        message: "Error checking existing document",
      };
    }
  },

  async uploadFileToBackend(file: File): Promise<any> {
    // Use full filename with .pdf extension as namespace
    const namespace = file.name;
    // First check if document already exists
    const existingCheck = await this.checkExistingDocument(file.name);

    if (existingCheck.exists) {
      return {
        success: false,
        existingDocument: existingCheck.document,
        message: existingCheck.message,
        error: "Document already exists",
      };
    }
    const token = localStorage.getItem("accessToken");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("namespace", namespace);

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/documents/upload`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      }
    );
    if (!response.ok) {
      // Gracefully handle 409 duplicate from backend
      if (response.status === 409) {
        const data = await response.json();
        return {
          success: false,
          existingDocument: data.existingDocument,
          message: data.error || "Document already exists",
          error: "Document already exists",
        };
      }
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to upload file to backend");
    }
    return response.json();
  },

  async uploadRhpToBackend(file: File, drhpId: string): Promise<any> {
    const token = localStorage.getItem("accessToken");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("drhpId", drhpId); // <-- This is the missing piece

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/documents/upload-rhp`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      }
    );
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to upload RHP file");
    }
    return response.json();
  },
};
