import { describe, it, expect, vi, beforeEach } from "vitest";
import { uploadService } from "@/lib/api/uploadService";
import { documentService } from "@/services/api";

// Mock dependencies
vi.mock("@/services/api", () => ({
  documentService: {
    checkExistingByNamespace: vi.fn(),
  },
}));

// Mock fetch
global.fetch = vi.fn();

describe("uploadService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe("normalizeNamespace", () => {
    it("should normalize file names correctly", () => {
      expect(uploadService.normalizeNamespace("My Document.pdf")).toBe(
        "My Document.pdf"
      );
      expect(uploadService.normalizeNamespace("test-file_name.pdf")).toBe(
        "test file name.pdf"
      );
      expect(uploadService.normalizeNamespace("  spaced  .pdf  ")).toBe(
        "spaced .pdf"
      );
    });
  });

  describe("checkExistingDocument", () => {
    it("should check if document exists", async () => {
      const mockDocument = {
        id: "doc-1",
        name: "Test Document.pdf",
        namespace: "Test Document.pdf",
      };

      (documentService.checkExistingByNamespace as ReturnType<typeof vi.fn>).mockResolvedValue({
        exists: true,
        document: mockDocument,
        message: "Document already exists",
      });

      const result = await uploadService.checkExistingDocument("Test Document.pdf");

      expect(documentService.checkExistingByNamespace).toHaveBeenCalledWith(
        "Test Document.pdf"
      );
      expect(result.exists).toBe(true);
      expect(result.document).toEqual(mockDocument);
    });

    it("should return false if document does not exist", async () => {
      (documentService.checkExistingByNamespace as ReturnType<typeof vi.fn>).mockResolvedValue({
        exists: false,
        message: "Document not found",
      });

      const result = await uploadService.checkExistingDocument("New Document.pdf");

      expect(result.exists).toBe(false);
    });
  });

  describe("uploadFileToBackend", () => {
    it("should upload file successfully", async () => {
      const mockFile = new File(["content"], "test.pdf", { type: "application/pdf" });
      const mockResponse = {
        success: true,
        documentId: "doc-1",
        namespace: "test.pdf",
        status: "processing",
      };

      localStorage.setItem("accessToken", "mock-token");
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await uploadService.uploadFileToBackend(mockFile);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/documents/upload"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer mock-token",
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("should return existing document if duplicate", async () => {
      const mockFile = new File(["content"], "existing.pdf", { type: "application/pdf" });
      const mockExistingDoc = {
        id: "doc-1",
        name: "existing.pdf",
      };

      (documentService.checkExistingByNamespace as ReturnType<typeof vi.fn>).mockResolvedValue({
        exists: true,
        document: mockExistingDoc,
        message: "Document already exists",
      });

      const result = await uploadService.uploadFileToBackend(mockFile);

      expect(result.success).toBe(false);
      expect(result.existingDocument).toEqual(mockExistingDoc);
    });

    it("should handle 409 conflict from backend", async () => {
      const mockFile = new File(["content"], "test.pdf", { type: "application/pdf" });
      const mockExistingDoc = {
        id: "doc-1",
        name: "test.pdf",
      };

      // Mock checkExistingDocument to return false so it proceeds to fetch
      (documentService.checkExistingByNamespace as ReturnType<typeof vi.fn>).mockResolvedValue({
        exists: false,
        message: "Document not found",
      });

      localStorage.setItem("accessToken", "mock-token");
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: "Document already exists",
          existingDocument: mockExistingDoc,
        }),
      });

      const result = await uploadService.uploadFileToBackend(mockFile);

      expect(result.success).toBe(false);
      expect(result.existingDocument).toEqual(mockExistingDoc);
    });
  });

  describe("uploadRhpToBackend", () => {
    it("should upload RHP file with DRHP ID", async () => {
      const mockFile = new File(["content"], "rhp.pdf", { type: "application/pdf" });
      const mockResponse = {
        success: true,
        documentId: "rhp-doc-1",
        drhpId: "drhp-doc-1",
      };

      localStorage.setItem("accessToken", "mock-token");
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await uploadService.uploadRhpToBackend(mockFile, "drhp-doc-1");

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/documents/upload-rhp"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer mock-token",
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("should throw error on upload failure", async () => {
      const mockFile = new File(["content"], "rhp.pdf", { type: "application/pdf" });

      localStorage.setItem("accessToken", "mock-token");
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({
          error: "Upload failed",
        }),
      });

      await expect(
        uploadService.uploadRhpToBackend(mockFile, "drhp-doc-1")
      ).rejects.toThrow("Upload failed");
    });
  });
});


