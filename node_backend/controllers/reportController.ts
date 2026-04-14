import { Request, Response } from "express";
import { Report } from "../models/Report";
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

export const reportController = {
  async compareDocuments(req: AuthRequest, res: Response) {
    try {
      const { drhpNamespace, rhpNamespace, sessionId, prompt } = req.body;

      // Handle both drhpId and drhpDocumentId (compat with reportN8nService)
      const drhpId = req.body.drhpId || req.body.drhpDocumentId;
      const rhpId = req.body.rhpId || req.body.rhpDocumentId;

      if (!drhpId || !rhpId || !drhpNamespace || !rhpNamespace) {
        return res.status(400).json({
          error: "Missing required fields for comparison",
          received: { drhpId: !!drhpId, rhpId: !!rhpId, drhpNamespace: !!drhpNamespace, rhpNamespace: !!rhpNamespace }
        });
      }

      const pythonApiUrl = process.env.PYTHON_API_URL || "http://localhost:8000";
      const domain = req.userDomain || (req as any).user?.domain;

      // Get domainId
      let domainId = (req as any).user?.domainId;
      if (!domainId && req.user?._id) {
        const user = await User.findById(req.user._id).select("domainId").lean();
        domainId = user?.domainId;
      }

      console.log(`Triggering Python Comparison: ${drhpNamespace} vs ${rhpNamespace}`);

      const payload = {
        drhpNamespace,
        rhpNamespace,
        drhpDocumentId: drhpId,
        rhpDocumentId: rhpId,
        sessionId: sessionId || Date.now().toString(),
        domain: domain,
        domainId: domainId,
        authorization: req.headers.authorization,
        metadata: {
          workspaceId: req.currentWorkspace || domain,
          triggeredBy: req.user?._id
        }
      };

      const pythonResponse = await axios.post(`${pythonApiUrl}/jobs/comparison`, payload, {
        headers: {
          "X-Internal-Secret": INTERNAL_SECRET
        },
        timeout: 30000
      });

      if (pythonResponse.data && pythonResponse.data.status === "accepted") {
        return res.json({
          status: "processing",
          job_id: pythonResponse.data.job_id,
          message: "Comparison job started successfully"
        });
      }

      res.status(500).json({ error: "Failed to start comparison job", details: pythonResponse.data });
    } catch (error: any) {
      console.error("Error in compareDocuments:", error.message);
      res.status(500).json({ error: "Comparison trigger failed", message: error.message });
    }
  },

  async getAll(req: AuthRequest, res: Response) {
    try {
      const link = (req as any).linkAccess;

      // Get current workspace from request
      const currentWorkspace = req.currentWorkspace || req.userDomain;
      const domain = req.userDomain || (link?.domain);

      const query: any = {};
      if (domain) query.domain = domain;
      if (currentWorkspace) query.workspaceId = currentWorkspace;

      console.log("Fetching reports with query:", JSON.stringify(query));

      // Handle link access
      if (link) {
        if (link.resourceType === "document") {
          // If link is for a specific document, show reports that reference that document
          const { Document } = await import("../models/Document");
          const document = await Document.findOne({
            id: link.resourceId,
            domain: link.domain,
          });
          if (document) {
            // Show reports that reference this document as DRHP or RHP
            query.$or = [
              { drhpId: document.id },
              { rhpId: document.id },
              { drhpNamespace: document.namespace },
              { rhpNamespace: document.namespace || document.rhpNamespace },
            ];
          } else {
            // Document not found, return empty array
            return res.json([]);
          }
        } else if (link.resourceType === "directory") {
          // If link is for a directory, show reports for all documents in that directory
          const { Document } = await import("../models/Document");
          const documents = await Document.find({
            directoryId: link.resourceId,
            domain: link.domain,
          });
          const documentIds = documents.map(doc => doc.id);
          const documentNamespaces = documents.map(doc => doc.namespace);
          if (documentIds.length > 0 || documentNamespaces.length > 0) {
            query.$or = [
              { drhpId: { $in: documentIds } },
              { rhpId: { $in: documentIds } },
              { drhpNamespace: { $in: documentNamespaces } },
              { rhpNamespace: { $in: documentNamespaces } },
            ];
          } else {
            // No documents in directory, return empty array
            return res.json([]);
          }
        }
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
          const sharedDocumentNamespaces = sharedDocs.map(doc => doc.namespace);

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
                sharedDocumentNamespaces.push(...originalDocs.map(doc => doc.namespace));
              }
            }
          }

          // Include reports for shared documents
          if (sharedDocumentIds.length > 0 || sharedDocumentNamespaces.length > 0) {
            const sharedReportsQuery: any[] = [
              { drhpId: { $in: sharedDocumentIds } },
              { rhpId: { $in: sharedDocumentIds } },
            ];

            if (sharedDocumentNamespaces.length > 0) {
              sharedReportsQuery.push(
                { drhpNamespace: { $in: sharedDocumentNamespaces } },
                { rhpNamespace: { $in: sharedDocumentNamespaces } }
              );
            }

            // Combine with workspace reports
            // Remove domain/workspaceId from base query since we're using $or
            delete query.domain;
            delete query.workspaceId;
            query.$or = [
              { domain: domain, workspaceId: currentWorkspace },
              ...sharedReportsQuery,
            ];
          }
        }
        // If no shared directories, query already has domain and workspaceId, so it will show all workspace reports
      }

      // Visibility: All members of the workspace can see all reports in that workspace.
      // Do not further restrict by userId/microsoftId for reads.

    const rawReports = await Report.find(query).lean();
      console.log(`Found ${rawReports.length} reports`);
      
      const reports = rawReports.sort((a: any, b: any) => {
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return timeB - timeA;
      });
      res.json(reports);
    } catch (error: any) {
      console.error("Error fetching reports:", error);
      res.status(500).json({ 
        message: "Error fetching reports", 
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  },

  async getById(req: AuthRequest, res: Response) {
    try {
      const query: any = {
        id: req.params.id,
        domain: req.userDomain, // Ensure user can only access reports from their domain
      };

      const report = await Report.findOne(query);
      if (!report) {
        return res.status(404).json({ error: "Report not found" });
      }
      res.json(report);
    } catch (error) {
      console.error("Error fetching report:", error);
      res.status(500).json({ message: "Error fetching report" });
    }
  },

  async create(req: AuthRequest, res: Response) {
    try {
      const { title, content, drhpNamespace, rhpNamespace, domainId: bodyDomainId, domain: bodyDomain } =
        req.body;

      // Handle both drhpId and drhpDocumentId
      const drhpId = req.body.drhpId || req.body.drhpDocumentId;
      const rhpId = req.body.rhpId || req.body.rhpDocumentId;

      if (
        !title ||
        !content ||
        !drhpId ||
        !rhpId ||
        !drhpNamespace ||
        !rhpNamespace
      ) {
        return res.status(400).json({
          message: "Missing required fields",
          required: {
            title: !!title,
            content: !!content,
            drhpId: !!drhpId,
            rhpId: !!rhpId,
            drhpNamespace: !!drhpNamespace,
            rhpNamespace: !!rhpNamespace,
          },
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

      // Ensure one report per DRHP/RHP pair in the workspace: replace previous if exists
      await Report.deleteMany({
        domain: actualDomain,
        workspaceId: currentWorkspace,
        drhpNamespace,
        rhpNamespace,
      });

      const reportData: any = {
        id: Date.now().toString(),
        title,
        content,
        drhpId,
        rhpId,
        drhpNamespace,
        rhpNamespace,
        domain: actualDomain, // Add domain for workspace isolation - backward compatibility
        domainId: domainId, // Link to Domain schema (required)
        workspaceId: currentWorkspace, // Add workspace for team isolation
        updatedAt: new Date(),
      };

      // Add user information if available
      if (req.user) {
        if (req.user.microsoftId) {
          reportData.microsoftId = req.user.microsoftId;
        } else if (req.user._id) {
          reportData.userId = req.user._id.toString();
        }
      }


      const report = new Report(reportData);
      await report.save();

      // Update directory's updatedAt when report is created
      if (drhpId) {
        const { Document } = await import("../models/Document");
        const { Directory } = await import("../models/Directory");
        const doc = await Document.findOne({ id: drhpId, workspaceId: currentWorkspace });
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
          action: "report.created",
          resourceType: "report",
          resourceId: report.id,
          title: `New report created: ${report.title}`,
          notifyWorkspace: true,
        });
      }

      res.status(201).json(report);
    } catch (error) {
      console.error("Error creating report:", error);
      res
        .status(500)
        .json({ error: "Failed to create report", details: error });
    }
  },

  async reportStatusUpdate(req: Request, res: Response) {
    try {
      const { jobId, status, error } = req.body;
      if (!jobId || !status) {
        return res.status(400).json({ message: "Missing jobId or status" });
      }
      // Emit real-time update
      io.emit("compare_status", { jobId, status, error });
      res
        .status(200)
        .json({ message: "Status update emitted", jobId, status, error });
    } catch (err) {
      res.status(500).json({
        message: "Failed to emit status update",
        error: err instanceof Error ? err.message : err,
      });
    }
  },


  // Download DOCX generated from HTML content by report ID
  async downloadDocx(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const report = await Report.findOne({ id });
      if (!report || !report.content) {
        return res.status(404).json({ error: "Report not found" });
      }

      // Write HTML to a temp file
      const tmpDir = os.tmpdir();
      const htmlPath = path.join(tmpDir, `report_${id}.html`);
      const docxPath = path.join(tmpDir, `report_${id}.docx`);
      await writeFile(htmlPath, report.content, "utf8");

      // Convert HTML to DOCX using Pandoc
      await execAsync(`pandoc "${htmlPath}" -o "${docxPath}"`);

      // Send DOCX file
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${(report.title || "report").replace(/[^a-z0-9]/gi, "_")}.docx"`
      );
      res.sendFile(docxPath, async (err) => {
        // Clean up temp files
        if (err) {
          console.error("Error sending file:", err);
        }
        try {
          await unlink(htmlPath);
          await unlink(docxPath);
        } catch (cleanupError) {
          console.error("Error cleaning up temp files:", cleanupError);
        }
      });
    } catch (error) {
      console.error("Error generating DOCX with Pandoc:", error);
      res.status(500).json({ error: "Failed to generate DOCX" });
    }
  },



  async update(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const query: any = {
        id,
        domain: req.userDomain, // Ensure user can only update reports from their domain
      };

      // All workspace members can update reports in their workspace
      // No user-based filtering needed - workspace isolation is sufficient

      const report = await Report.findOneAndUpdate(query, req.body, {
        new: true,
      });
      if (!report) {
        return res.status(404).json({ error: "Report not found" });
      }
      res.json(report);
    } catch (error) {
      console.error("Error updating report:", error);
      res.status(500).json({ error: "Failed to update report" });
    }
  },

  async delete(req: AuthRequest, res: Response) {
    try {
      const query: any = {
        id: req.params.id,
        domain: req.userDomain, // Ensure user can only delete reports from their domain
      };

      // Admins can delete all reports in their domain, regular users see only their own
      if (req.user.role !== "admin") {
        if (req.user.microsoftId) {
          query.microsoftId = req.user.microsoftId;
        } else if (req.user._id) {
          query.userId = req.user._id.toString();
        } else {
          return res.status(400).json({ error: "No user identifier found" });
        }
      }

      const report = await Report.findOne(query);
      if (!report) {
        return res.status(404).json({ error: "Report not found" });
      }

      await report.deleteOne();
      await publishEvent({
        actorUserId: req.user?._id?.toString?.(),
        domain: req.userDomain!,
        action: "report.deleted",
        resourceType: "report",
        resourceId: report.id,
        title: `Report deleted: ${report.title || report.id}`,
        notifyWorkspace: true,
      });
      res.json({ message: "Report deleted successfully" });
    } catch (error) {
      console.error("Error deleting report:", error);
      res.status(500).json({ error: "Failed to delete report" });
    }
  },

  async downloadPdfFromHtml(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const report = await Report.findOne({ id });
      if (!report || !report.content) {
        return res.status(404).json({ error: "Report not found" });
      }

      // Call PDF.co API to generate PDF from HTML
      try {
        const pdfcoResponse = await axios.post(
          "https://api.pdf.co/v1/pdf/convert/from/html",
          {
            html: report.content,
            name: `${report.title || "report"}.pdf`,
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
          `attachment; filename=\"${report.title || "report"}.pdf\"`
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

  // Admin: Get all reports across all workspaces in domain
  async getAllAdmin(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user || user.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const query: any = {
        domain: req.user?.domain || req.userDomain, // Use user's actual domain for admin
      };

      const rawReports = await Report.find(query);
      const reports = rawReports.sort((a: any, b: any) => {
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return timeB - timeA;
      });

      // Get all workspaces to map workspaceId to workspace name
      const { Workspace } = await import("../models/Workspace");
      const workspaces = await Workspace.find({ domain: req.user?.domain || req.userDomain });
      const workspaceMap = new Map(workspaces.map(ws => [ws.workspaceId, { workspaceId: ws.workspaceId, name: ws.name, slug: ws.slug }]));

      // Add workspace information to each report
      const reportsWithWorkspace = reports.map(report => {
        const reportObj = report.toObject ? report.toObject() : report;
        const wsData = workspaceMap.get(reportObj.workspaceId);
        
        return {
          ...reportObj,
          workspaceId: wsData || { 
            workspaceId: reportObj.workspaceId, 
            name: 'Excollo', 
            slug: 'unknown' 
          }
        };
      });

      res.json(reportsWithWorkspace);
    } catch (error) {
      console.error("Error fetching admin reports:", error);
      res.status(500).json({ error: "Failed to fetch reports" });
    }
  },
};
