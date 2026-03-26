import React, { useState, useRef } from "react";
import { toast } from "sonner";
import { workspaceService } from "@/services/workspaceService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Upload } from "lucide-react";
import { uploadService } from "@/lib/api/uploadService";
import { summaryN8nService } from "@/lib/api/summaryN8nService";
import { sessionService } from "@/lib/api/sessionService";

interface CreateWorkspaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
  isFirstLogin?: boolean; // Show special messaging for first login
}

export function CreateWorkspaceModal({
  open,
  onOpenChange,
  onCreated,
  isFirstLogin = false,
}: CreateWorkspaceModalProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [desc, setDesc] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toSlug = (v: string) =>
    (v || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      toast.error("Workspace name is required");
      return;
    }
    try {
      setBusy(true);

      // Create workspace
      const payload = {
        name: trimmed,
        slug: slug ? toSlug(slug) : undefined,
        description: desc.trim() || undefined,
      };
      const result = await workspaceService.createWorkspace(payload);
      const workspaceId = result.workspace.workspaceId;

      // Set workspace in localStorage for subsequent requests
      localStorage.setItem("currentWorkspace", workspaceId);

      // If file provided, upload and summarize
      if (file) {
        setUploading(true);
        toast.info(`Uploading ${file.name}...`);

        try {
          // Upload file with workspace header
          const token = localStorage.getItem("accessToken");
          const formData = new FormData();
          formData.append("file", file);
          formData.append("namespace", file.name);

          const uploadResponse = await fetch(
            `${import.meta.env.VITE_API_URL}/documents/upload`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "x-workspace": workspaceId,
              },
              body: formData,
            }
          );

          if (!uploadResponse.ok) {
            throw new Error("Upload failed");
          }

          const uploadResult = await uploadResponse.json();

          if (uploadResult?.document) {
            toast.success("Document uploaded successfully!");

            // Trigger summarize
            try {
              toast.info("Generating summary...");
              const session = sessionService.initializeSession();

              await summaryN8nService.createSummary(
                "Generate DRHP Doc Summary",
                session,
                [],
                uploadResult.document.namespace,
                uploadResult.document.id,
                undefined,
                "DRHP"
              );

              toast.success("Summary generation started!");
            } catch (summaryError: any) {
              console.error("Summary generation error:", summaryError);
              toast.warning("Workspace created, but summary generation failed. You can generate it later.");
            }
          }
        } catch (uploadError: any) {
          console.error("Upload error:", uploadError);
          toast.warning("Workspace created, but file upload failed. You can upload documents later.");
        } finally {
          setUploading(false);
        }
      }

      toast.success("Workspace created successfully!");
      setName("");
      setSlug("");
      setDesc("");
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      onOpenChange(false);
      onCreated?.();

      // Only reload if no onCreated callback handles navigation (e.g., first-login redirects to /onboarding)
      if (!onCreated) {
        window.location.reload();
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to create workspace");
    } finally {
      setBusy(false);
      setUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type !== "application/pdf") {
        toast.error("Please select a PDF file");
        return;
      }
      setFile(selectedFile);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-white">
        <DialogHeader>
          <DialogTitle className="text-[#4B2A06]">
            {isFirstLogin ? "Create Your First Workspace" : "Create Workspace"}
          </DialogTitle>
          {isFirstLogin && (
            <p className="text-sm text-gray-600 mt-2">
              Welcome! As the first admin of this domain, you need to create your first workspace to get started.
              You can optionally upload a document to summarize.
            </p>
          )}
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-[#4B2A06]">Workspace name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Team Alpha"
              className="bg-white border-gray-300 text-[#4B2A06] focus:border-[#E5E5E5] focus:ring-0"
            />
          </div>
          <div>
            <Label className="text-[#4B2A06]">Workspace URL (optional)</Label>
            <div className="flex">
              <span className="px-3 py-2 bg-gray-100 border rounded-l text-sm text-[#4B2A06]">
                /
              </span>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="team-alpha"
                className="rounded-l-none bg-white border-gray-300 text-[#4B2A06] focus:border-[#E5E5E5] focus:ring-0"
              />
            </div>
          </div>
          <div>
            <Label className="text-[#4B2A06]">Description (optional)</Label>
            <Textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Describe this workspace"
              rows={3}
              className="bg-white border-gray-300 text-[#4B2A06] focus:border-[#E5E5E5] focus:ring-0"
            />
          </div>
          <div>
            <Label className="text-[#4B2A06]">Upload Document (optional)</Label>
            <div className="mt-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                onChange={handleFileSelect}
                className="hidden"
                id="workspace-file-upload"
              />
              <label
                htmlFor="workspace-file-upload"
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-md cursor-pointer hover:bg-gray-50 text-[#4B2A06]"
              >
                <Upload className="h-4 w-4" />
                <span>{file ? file.name : "Choose PDF file to upload and summarize"}</span>
              </label>
              {file && (
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="mt-2 text-sm text-red-600 hover:text-red-800"
                >
                  Remove file
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              If you upload a document, it will be automatically summarized after workspace creation.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="bg-white text-[#4B2A06] border-gray-300 hover:bg-gray-50 hover:text-[#4B2A06]"
            >
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={busy || uploading}
              className="bg-[#4B2A06] text-white hover:bg-[#3A2004] disabled:bg-gray-400"
            >
              {busy ? (uploading ? "Uploading..." : "Creating...") : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CreateWorkspaceModal;
