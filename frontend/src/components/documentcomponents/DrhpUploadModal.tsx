import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { toast } from "sonner";

interface DrhpUploadModalProps {
  onUploadSuccess?: (file: File) => void;
  setIsUploading?: (val: boolean) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const DrhpUploadModal: React.FC<DrhpUploadModalProps> = ({
  onUploadSuccess,
  setIsUploading,
  open,
  onOpenChange,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && !uploading) {
      onOpenChange(false);
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } else if (newOpen) {
      onOpenChange(true);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error("Please select a file first");
      return;
    }

    if (file.type !== "application/pdf") {
      toast.error("Please select a PDF file");
      return;
    }

    setUploading(true);
    setIsUploading?.(true);

    try {
      // Call the callback with the selected file
      // The parent component will handle the actual upload
      onUploadSuccess?.(file);

      // Don't close modal immediately - let parent handle it after upload completes
      // The modal will be closed by the parent component after upload processing
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to prepare upload"
      );
      setUploading(false);
      setIsUploading?.(false);
    }
    // Note: Don't set uploading to false here - parent component manages the upload state
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[500px] bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>Upload DRHP Document</DialogTitle>
          <DialogDescription>
            Upload a DRHP (Draft Red Herring Prospectus) document.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="file">Select DRHP PDF File</Label>
            <Input
              id="file"
              type="file"
              accept=".pdf"
              className="bg-white text-gray-400 file:text-[#4B2a09] file:text-sm file:font-medium file:border-none file:cursor-pointer border border-[#E5E5E5] rounded-md"
              onChange={handleFileSelect}
              ref={fileInputRef}
              disabled={uploading}
            />
            {file && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle className="h-4 w-4" />
                {file.name} selected
              </div>
            )}
          </div>

          <div className="bg-blue-50 p-3 rounded-md">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-medium">Note:</p>
                <p>
                  Please ensure the PDF file is a valid DRHP document. The first page MUST contain "Draft Red Herring Prospectus".
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              onOpenChange(false);
            }}
            className="bg-gray-200 text-[#4B2A06] hover:bg-gray-200 border-none hover:text-[#4B2A06]"
            disabled={uploading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleUpload();
            }}
            disabled={!file || uploading}
            className="flex items-center gap-2 bg-[#4B2A06] text-white hover:bg-[#4B2A06]/90 border-none hover:text-white"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload DRHP
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

