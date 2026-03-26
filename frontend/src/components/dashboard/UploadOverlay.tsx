import React from "react";
import { Loader2 } from "lucide-react";

interface UploadOverlayProps {
  isUploading: boolean;
}

export const UploadOverlay: React.FC<UploadOverlayProps> = ({ isUploading }) => {
  if (!isUploading) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[9999]">
      <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4 shadow-2xl">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-16 w-16 animate-spin text-[#4B2A06]" />
          <div className="text-center">
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              Processing Document
            </h3>
            <p className="text-sm text-gray-600 mb-2">
              Your document is being uploaded and processed through our system.
            </p>
            <p className="text-xs text-gray-500">
              Please do not close this window or refresh the page.
            </p>
            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-gray-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>This may take a few moments...</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
