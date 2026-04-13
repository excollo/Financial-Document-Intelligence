import { Request, Response } from "express";
import { Summary } from "../models/Summary";
import { User } from "../models/User";
import axios from "axios";
import { writeFile, unlink } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import { io } from "../index";
import { publishEvent } from "../lib/events";

const execAsync = promisify(exec);

interface AuthRequest extends Request {
  user?: any;
  userDomain?: string;
  currentWorkspace?: string;
}

const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";

export const summaryController = {
  async triggerSummary(req: AuthRequest, res: Response) {
    try {
      const { documentId, namespace, docType, metadata } = req.body;

      if (!namespace || !docType) {
        return res.status(400).json({ error: "Missing required fields (namespace, docType)" });
      }

      const pythonApiUrl = process.env.PYTHON_API_URL || "http://localhost:8000";
      const domain = req.userDomain || (req as any).user?.domain;

      // Get domainId
      let domainId = (req as any).user?.domainId;
      if (!domainId && req.user?._id) {
        const user = await User.findById(req.user._id).select("domainId").lean();
        domainId = user?.domainId;
      }

      console.log(`Triggering Python Summary for: ${namespace} (${docType})`);

      const payload = {
        namespace,
        doc_type: docType.toLowerCase(),
        metadata: {
          ...metadata,
          documentId,
          domain,
          domainId,
          workspaceId: req.currentWorkspace || domain,
          authorization: req.headers.authorization
        }
      };

      const pythonResponse = await axios.post(`${pythonApiUrl}/jobs/summary`, payload, {
        headers: {
          "X-Internal-Secret": INTERNAL_SECRET
        },
        timeout: 30000
      });

      if (pythonResponse.data && pythonResponse.data.status === "accepted") {
        return res.json({
          status: "processing",
          job_id: pythonResponse.data.job_id,
          message: "Summary generation job started"
        });
      }

      res.status(500).json({ error: "Failed to start summary job", details: pythonResponse.data });
    } catch (error: any) {
      console.error("Error in triggerSummary:", error.message);
      res.status(500).json({ error: "Summary trigger failed", message: error.message });
    }
  },

  async getAll(req: AuthRequest, res: Response) {
    try {
      const link = (req as any).linkAccess;

      // Get current workspace from request
      const currentWorkspace = req.currentWorkspace || req.userDomain;
      const domain = req.userDomain || (link?.domain);

      const query: any = {
        domain: domain, // Use link domain if available, otherwise user domain
        workspaceId: currentWorkspace,
      };

      // Handle link access
      if (link) {
        if (link.resourceType === "document") {
          // If link is for a specific document, only show summaries for that document
          query.documentId = link.resourceId;
        } else if (link.resourceType === "directory") {
          // If link is for a directory, show summaries for all documents in that directory
          const { Document } = await import("../models/Document");
          const documents = await Document.find({
            directoryId: link.resourceId,
            domain: link.domain,
          });
          const documentIds = documents.map(doc => doc.id);
          if (documentIds.length > 0) {
            query.documentId = { $in: documentIds };
          } else {
            // No documents in directory, return empty array
            return res.json([]);
          }
        }
        // For link access, don't filter by userId
      } else {
        // Check for shared directories via SharePermission
        const { SharePermission } = await import("../models/SharePermission");
        const { Document } = await import("../models/Document");
        const { Directory } = await import("../models/Directory");

        const userId = req.user?._id?.toString();
        const userEmail = req.user?.email?.toLowerCase();
        const sharedDirectoryIds: string[] = [];

        // Find all directories shared with this user
        if (userId) {
          const userShares = await SharePermission.find({
            resourceType: "directory",
            scope: "user",
            principalId: userId,
          });
          sharedDirectoryIds.push(...userShares.map(s => s.resourceId));
        }

        if (userEmail) {
          const emailShares = await SharePermission.find({
            resourceType: "directory",
            scope: "user",
            invitedEmail: userEmail,
          });
          sharedDirectoryIds.push(...emailShares.map(s => s.resourceId));
        }

        // Also check workspace-scoped shares
        if (currentWorkspace) {
          const workspaceShares = await SharePermission.find({
            resourceType: "directory",
            scope: "workspace",
            principalId: currentWorkspace,
          });
          sharedDirectoryIds.push(...workspaceShares.map(s => s.resourceId));
        }

        // Get all documents from shared directories
        if (sharedDirectoryIds.length > 0) {
          const uniqueDirIds = [...new Set(sharedDirectoryIds)];
          // Get documents from all shared directories (across domains/workspaces)
          const sharedDocs = await Document.find({
            directoryId: { $in: uniqueDirIds },
          });
          const sharedDocumentIds = sharedDocs.map(doc => doc.id);

          // Also check for shared directories created via Directory.isShared
          const sharedDirs = await Directory.find({
            isShared: true,
            sharedWithUserId: userId,
            workspaceId: currentWorkspace,
          });

          for (const sharedDir of sharedDirs) {
            if (sharedDir.sharedFromDirectoryId) {
              const originalDir = await Directory.findOne({
                id: sharedDir.sharedFromDirectoryId,
                domain: sharedDir.sharedFromDomain,
                workspaceId: sharedDir.sharedFromWorkspaceId,
              });
              if (originalDir) {
                const originalDocs = await Document.find({
                  directoryId: originalDir.id,
                  domain: originalDir.domain,
                  workspaceId: originalDir.workspaceId,
                });
                sharedDocumentIds.push(...originalDocs.map(doc => doc.id));
              }
            }
          }

          // Combine with user's own summaries or all summaries for admins
          if (req.user && req.user.role !== "admin") {
            // Regular users: show their own summaries + summaries for shared documents
            if (sharedDocumentIds.length > 0) {
              // Remove domain/workspaceId from base query since we're using $or
              delete query.domain;
              delete query.workspaceId;
              query.$or = [
                {
                  userId: req.user._id.toString(),
                  domain: domain,
                  workspaceId: currentWorkspace,
                },
                { documentId: { $in: sharedDocumentIds } },
              ];
              if (req.user.microsoftId) {
                query.$or.push({
                  microsoftId: req.user.microsoftId,
                  domain: domain,
                  workspaceId: currentWorkspace,
                });
              }
            } else {
              // No shared documents, show only user's own summaries
              if (req.user.microsoftId) {
                query.microsoftId = req.user.microsoftId;
              } else if (req.user._id) {
                query.userId = req.user._id.toString();
              }
            }
          } else {
            // Admins: show all summaries in domain + summaries for shared documents
            if (sharedDocumentIds.length > 0) {
              // Remove domain/workspaceId from base query since we're using $or
              delete query.domain;
              delete query.workspaceId;
              query.$or = [
                { domain: domain, workspaceId: currentWorkspace },
                { documentId: { $in: sharedDocumentIds } },
              ];
            }
            // Otherwise, query already has domain and workspaceId, so it will show all
          }
        } else if (req.user && req.user.role !== "admin") {
          // No shared directories, show only user's own summaries
          if (req.user.microsoftId) {
            query.microsoftId = req.user.microsoftId;
          } else if (req.user._id) {
            query.userId = req.user._id.toString();
          }
        }
      }

      const summaries = await Summary.find(query).sort({ updatedAt: -1 });
      res.json(summaries);
    } catch (error) {
      console.error("Error fetching summaries:", error);
      res.status(500).json({ message: "Error fetching summaries" });
    }
  },

  async getByDocumentId(req: AuthRequest, res: Response) {
    try {
      const { documentId } = req.params;
      // Get current workspace from request
      const currentWorkspace = req.currentWorkspace || req.userDomain;
      const link = (req as any).linkAccess;

      const query: any = {
        documentId,
        domain: req.userDomain, // Filter by user's domain (or link domain if link access)
        workspaceId: currentWorkspace, // Filter by user's workspace
      };

      // Handle link access - verify documentId matches link's resourceId
      if (link && link.resourceType === "document") {
        if (link.resourceId !== documentId) {
          return res.status(403).json({ error: "Access denied to this document" });
        }
        // Link access allows viewing summaries for the linked document
        // Use link's domain (already set by domainAuthMiddleware)
      }
      // All workspace members can see all summaries in their workspace
      // No user-based filtering needed - workspace isolation is sufficient

      const summaries = await Summary.find(query).sort({
        updatedAt: -1,
      });
      res.json(summaries);
    } catch (error) {
      console.error("Error fetching summaries:", error);
      res.status(500).json({ message: "Error fetching summaries" });
    }
  },

  async create(req: AuthRequest, res: Response) {
    try {
      console.log("Creating summary with payload:", { ...req.body, content: req.body.content?.substring(0, 100) + "..." });
      const { title, content, documentId, domainId: bodyDomainId, domain: bodyDomain } = req.body;
      if (!title || !content || !documentId) {
        console.error("Missing required fields for summary creation:", { title: !!title, content: !!content, documentId: !!documentId });
        return res.status(400).json({
          message: "Missing required fields",
          required: { title: !!title, content: !!content, documentId: !!documentId },
        });
      }

      // Get current workspace from request
      const currentWorkspace = req.currentWorkspace || req.userDomain;
      const actualDomain = req.userDomain || bodyDomain;

      // Get domainId - priority: 1) from request body (n8n), 2) from user, 3) from domain name lookup
      let domainId: string | undefined = bodyDomainId;

      if (!domainId) {
        // Try to get from user if available
        const user = req.user;
        if (user?._id) {
          const userWithDomain = await User.findById(user._id).select("domainId").lean();
          domainId = userWithDomain?.domainId || (userWithDomain as any)?.domainId;
        }
      }

      // If domainId still not found, try to get it from the domain name
      if (!domainId && actualDomain) {
        try {
          const { Domain } = await import("../models/Domain");
          const domainRecord = await Domain.findOne({ domainName: actualDomain, status: "active" });
          if (domainRecord) {
            domainId = domainRecord.domainId;
          }
        } catch (error) {
          console.error("Error fetching domainId from Domain model:", error);
        }
      }

      if (!domainId) {
        return res.status(400).json({
          error: "domainId is required. Unable to determine domainId from request body, user, or domain.",
          message: "Please ensure domainId is included in the request body or contact administrator."
        });
      }

      const summaryData: any = {
        id: Date.now().toString(),
        title,
        content,
        documentId,
        domain: actualDomain, // Add domain for workspace isolation - backward compatibility
        domainId: domainId, // Link to Domain schema (required)
        workspaceId: currentWorkspace, // Add workspace for team isolation
        updatedAt: new Date(),
      };

      // Add user information if available
      if (req.user) {
        if (req.user.microsoftId) {
          summaryData.microsoftId = req.user.microsoftId;
        } else if (req.user._id) {
          summaryData.userId = req.user._id.toString();
        }
      }

      const summary = new Summary(summaryData);
      await summary.save();

      // Update directory's updatedAt when summary is created
      if (documentId) {
        const { Document } = await import("../models/Document");
        const { Directory } = await import("../models/Directory");
        const doc = await Document.findOne({ id: documentId, workspaceId: currentWorkspace });
        if (doc?.directoryId) {
          const now = new Date();
          await Directory.updateOne(
            { id: doc.directoryId, workspaceId: currentWorkspace },
            {
              $set: {
                updatedAt: now,
              },
            }
          );
        }
      }

      // Publish event for workspace notification (only if user context available)
      if (req.user?._id && req.userDomain) {
        await publishEvent({
          actorUserId: req.user._id.toString(),
          domain: req.userDomain,
          action: "summary.created",
          resourceType: "summary",
          resourceId: summary.id,
          title: `New summary created: ${summary.title}`,
          notifyWorkspace: true,
        });
      }

      res.status(201).json(summary);
    } catch (error) {
      console.error("Error creating summary:", error);
      res.status(500).json({
        error: "Failed to create summary",
        details: error,
      });
    }
  },

  // Endpoint: Download DOCX generated from HTML content by summary ID
  async downloadDocx(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;

      // LOG START
      try { await writeFile(path.join(process.cwd(), "debug_error.log"), `Starting downloadDocx for ID: ${id}\n`, { flag: "a" }); } catch { }

      const summary = await Summary.findOne({
        $or: [
          { id: id },
          { id: Number(id) }
        ]
      });

      if (!summary || !summary.content) {
        try { await writeFile(path.join(process.cwd(), "debug_error.log"), `Summary not found or empty content for ID: ${id} (Tried Number: ${Number(id)})\n`, { flag: "a" }); } catch { }
        return res.status(404).json({ error: "Summary not found" });
      }

      // Log success found
      try { await writeFile(path.join(process.cwd(), "debug_error.log"), `Found summary: ${summary.id} (Type: ${typeof summary.id})\n`, { flag: "a" }); } catch { }


      const tmpDir = os.tmpdir();
      const docxPath = path.join(tmpDir, `summary_${id}.docx`);

      // Clean content: Replace literal \n with real newlines, remove \r, \t, etc.
      // This matches the frontend 'cleanSummaryContent' logic
      const cleanContent = (summary.content || "")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"');

      // Detect format (default to HTML for backward compatibility)
      let format = (summary as any).format || "html";

      // If format is "html" (legacy default) but content looks like markdown, switch to markdown
      if (format === "html" && (cleanContent.includes("**") || cleanContent.includes("##") || cleanContent.includes("---"))) {
        format = "markdown";
      }


      let inputPath: string;
      let pandocCommand: string;

      if (format === "markdown") {

        inputPath = path.join(tmpDir, `summary_${id}.md`);
        await writeFile(inputPath, cleanContent, "utf8");
        pandocCommand = `pandoc "${inputPath}" -f markdown -t docx -o "${docxPath}"`;
      } else {
        inputPath = path.join(tmpDir, `summary_${id}.html`);
        await writeFile(inputPath, cleanContent, "utf8");
        pandocCommand = `pandoc "${inputPath}" -f html -t docx -o "${docxPath}"`;
      }


      // Log paths
      try { await writeFile(path.join(process.cwd(), "debug_error.log"), `Paths: Input=${inputPath}, Output=${docxPath}, Cmd=${pandocCommand}\n`, { flag: "a" }); } catch { }

      // Convert to DOCX using Pandoc
      const { stdout, stderr } = await execAsync(pandocCommand);

      // Log success
      try { await writeFile(path.join(process.cwd(), "debug_error.log"), `Pandoc Success. Stdout: ${stdout}, Stderr: ${stderr}\n`, { flag: "a" }); } catch { }

      // Send DOCX file
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${(summary.title || "summary").replace(/[^a-z0-9]/gi, "_")}.docx"`
      );
      res.sendFile(docxPath, async (err) => {
        // Clean up temp files
        if (err) {
          console.error("Error sending file:", err);
          try { await writeFile(path.join(process.cwd(), "debug_error.log"), `Error sending file: ${err.message}\n`, { flag: "a" }); } catch { }
        } else {
          try { await writeFile(path.join(process.cwd(), "debug_error.log"), `File sent successfully.\n`, { flag: "a" }); } catch { }
        }
        try {
          await unlink(inputPath);
          await unlink(docxPath);
        } catch (cleanupError) {
          console.error("Error cleaning up temp files:", cleanupError);
        }
      });

    } catch (error: any) {
      console.error("Error generating DOCX with Pandoc:", error);
      // Debug logging
      try {
        await writeFile(path.join(process.cwd(), "debug_error.log"), `Error: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}\nStack: ${error.stack}\n`, { flag: "a" });
      } catch (e) { console.error("Could not write debug log", e); }

      res.status(500).json({ error: "Failed to generate DOCX", details: error.message });
    }

  },


  async update(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const query: any = {
        $or: [
          { id: id },
          { id: Number(id) }
        ],
        domain: req.userDomain, // Ensure user can only update summaries from their domain
      };

      // All workspace members can update summaries in their workspace
      // No user-based filtering needed - workspace isolation is sufficient

      const summary = await Summary.findOneAndUpdate(query, req.body, {
        new: true,
      });
      if (!summary) {
        return res.status(404).json({ message: "Summary not found" });
      }
      res.json(summary);
    } catch (error) {
      console.error("Error updating summary:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      res.status(500).json({
        message: "Error updating summary",
        error: errorMessage,
      });
    }
  },

  async delete(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const currentWorkspace = req.currentWorkspace || req.userDomain;

      const query: any = {
        $or: [
          { id: id },
          { id: Number(id) }
        ],
      };

      // Let workspace members delete summaries in the workspace
      if (currentWorkspace) {
        query.workspaceId = currentWorkspace;
      } else {
        query.domain = req.userDomain;
      }

      // All workspace members can delete summaries in their workspace
      // No user-based filtering needed - workspace isolation is sufficient

      const summary = await Summary.findOneAndDelete(query).lean();
      if (!summary) {
        return res.status(404).json({ message: "Summary not found or access denied" });
      }

      await publishEvent({
        actorUserId: req.user?._id?.toString?.(),
        domain: req.userDomain!,
        action: "summary.deleted",
        resourceType: "summary",
        resourceId: summary.id,
        title: `Summary deleted: ${summary.title || summary.id}`,
        notifyWorkspace: true,
      });

      res.json({ message: "Summary deleted successfully" });
    } catch (error) {
      console.error("Error deleting summary:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      res.status(500).json({
        message: "Error deleting summary",
        error: errorMessage,
      });
    }
  },

  async summaryStatusUpdate(req: Request, res: Response) {
    try {
      const { jobId, status, error } = req.body;
      console.log("Summary status update received from n8n:", { jobId, status, error });

      if (!jobId || !status) {
        console.error("Missing jobId or status in summary status update:", { jobId, status });
        return res.status(400).json({ message: "Missing jobId or status" });
      }

      // Emit real-time update to all connected clients
      const eventData = { jobId, status, error };
      console.log("Emitting summary_status event:", eventData);
      io.emit("summary_status", eventData);

      // Log if there's an error
      if (error) {
        console.error("Summary generation error from n8n:", { jobId, status, error });
      }

      res
        .status(200)
        .json({ message: "Status update emitted", jobId, status, error });
    } catch (err) {
      console.error("Error in summaryStatusUpdate:", err);
      res.status(500).json({
        message: "Failed to emit status update",
        error: err instanceof Error ? err.message : err,
      });
    }
  },

  async downloadHtmlPdf(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const summary = await Summary.findOne({
        $or: [
          { id: id },
          { id: Number(id) }
        ]
      });
      if (!summary || !summary.content) {
        return res.status(404).json({ error: "Summary not found" });
      }

      // Call PDF.co API to generate PDF from HTML
      try {
        const pdfcoResponse = await axios.post(
          "https://api.pdf.co/v1/pdf/convert/from/html",
          {
            html: summary.content,
            name: `${summary.title || "summary"}.pdf`,
            allowAbsoluteUrls: true,
          },
          {
            headers: {
              "x-api-key": process.env.PDFCO_API_KEY,
              "Content-Type": "application/json",
            },
          }
        );

        if (!pdfcoResponse.data || !pdfcoResponse.data.url) {
          // Check if PDF.co returned an error in the response
          if (pdfcoResponse.data?.error || pdfcoResponse.data?.status === 402) {
            const errorMsg = pdfcoResponse.data?.message || "PDF.co API error: Insufficient credits or service unavailable";
            console.error("PDF.co API error:", pdfcoResponse.data);
            return res.status(503).json({
              error: "PDF generation service temporarily unavailable",
              message: errorMsg,
              details: "The PDF generation service is currently unavailable. Please try again later or contact support."
            });
          }
          throw new Error("PDF.co did not return a PDF URL");
        }

        // Download the generated PDF and stream to client
        const pdfStream = await axios.get(pdfcoResponse.data.url, {
          responseType: "stream",
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=\"${summary.title || "summary"}.pdf\"`
        );
        pdfStream.data.pipe(res);
      } catch (pdfcoError: any) {
        // Handle PDF.co specific errors
        if (pdfcoError.response?.status === 402) {
          const errorData = pdfcoError.response?.data || {};
          console.error("PDF.co API error (402):", errorData);
          return res.status(503).json({
            error: "PDF generation service unavailable",
            message: errorData.message || "Insufficient credits for PDF generation",
            details: "The PDF generation service requires additional credits. Please contact support or try again later."
          });
        }
        if (pdfcoError.response?.status) {
          const errorData = pdfcoError.response?.data || {};
          console.error(`PDF.co API error (${pdfcoError.response.status}):`, errorData);
          return res.status(503).json({
            error: "PDF generation service error",
            message: errorData.message || "PDF generation failed",
            details: "The PDF generation service encountered an error. Please try again later."
          });
        }
        throw pdfcoError; // Re-throw if it's not a PDF.co response error
      }
    } catch (error: any) {
      console.error("Error generating PDF with PDF.co:", error);

      // Check if response was already sent
      if (res.headersSent) {
        return;
      }

      // Return proper error response
      res.status(500).json({
        error: "Failed to generate PDF",
        message: error.message || "An unexpected error occurred",
        details: "Please try again later or contact support if the problem persists."
      });
    }
  },

  // Admin: Get all summaries across all workspaces in domain
  async getAllAdmin(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user || user.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const query: any = {
        domain: req.user?.domain || req.userDomain, // Use user's actual domain for admin
      };

      const summaries = await Summary.find(query).sort({ updatedAt: -1 });

      // Get all workspaces to map workspaceId to workspace name
      const { Workspace } = await import("../models/Workspace");
      const workspaces = await Workspace.find({
        domain: req.user?.domain || req.userDomain,
      });
      const workspaceMap = new Map(
        workspaces.map((ws) => [
          ws.workspaceId,
          { workspaceId: ws.workspaceId, name: ws.name, slug: ws.slug },
        ])
      );

      // Add workspace information to each summary
      const summariesWithWorkspace = summaries.map((summary) => ({
        ...summary.toObject(),
        workspaceId: workspaceMap.get(summary.workspaceId) || {
          workspaceId: summary.workspaceId,
          name: workspaceMap.get(summary.workspaceId)?.name
            ? workspaceMap.get(summary.workspaceId)?.name
            : "Excollo",
          slug: "unknown",
        },
      }));

      res.json(summariesWithWorkspace);
    } catch (error) {
      console.error("Error fetching admin summaries:", error);
      res.status(500).json({ error: "Failed to fetch summaries" });
    }
  },
};
