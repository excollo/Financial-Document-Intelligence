import React, { useState, useEffect } from "react";
import { X, FileText, Search, Calendar, User } from "lucide-react";
import { documentService } from "@/services/api";
import { toast } from "sonner";

interface Document {
  id: string;
  name: string;
  type: string;
  uploadedAt: string;
  namespace: string;
  relatedRhpId?: string;
  relatedDrhpId?: string;
}

interface CompareDocumentModalProps {
  open: boolean;
  onClose: () => void;
  selectedDocument: Document;
  availableDocuments: Document[];
  onDocumentSelect: (selectedDoc: Document, targetDoc: Document) => void;
  loading?: boolean;
}

export const CompareDocumentModal: React.FC<CompareDocumentModalProps> = ({
  open,
  onClose,
  selectedDocument,
  availableDocuments,
  onDocumentSelect,
  loading = false,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredDocuments, setFilteredDocuments] = useState<Document[]>([]);
  const [selectedTargetDocument, setSelectedTargetDocument] = useState<Document | null>(null);

  useEffect(() => {
    if (searchTerm.trim()) {
      const filtered = availableDocuments.filter((doc) =>
        doc.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredDocuments(filtered);
    } else {
      setFilteredDocuments(availableDocuments);
    }
  }, [searchTerm, availableDocuments]);

  useEffect(() => {
    if (!open) {
      setSearchTerm("");
      setSelectedTargetDocument(null);
    }
  }, [open]);

  const handleDocumentClick = (targetDocument: Document) => {
    setSelectedTargetDocument(targetDocument);
  };

  const handleOkClick = () => {
    if (selectedTargetDocument) {
      onDocumentSelect(selectedDocument, selectedTargetDocument);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[60vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6  border-gray-200">
          <h2 className="text-2xl font-bold text-[#FF7A1A]">
            Select Document
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <input
              type="text"
              placeholder="Search for Files by their names, time, and day"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="outline-none focus:outline-none focus:ring-0 focus:border-[#E5E5E5] w-full rounded-full border border-[#E5E5E5] px-10 py-3 text-base bg-[#F9F9F9] placeholder:text-[#A1A1AA]"
            />
          </div>
        </div>

        {/* Document Table */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#4B2A06]"></div>
              <span className="ml-3 text-gray-600">Loading documents...</span>
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">
                {searchTerm
                  ? "No documents found matching your search"
                  : "No documents available for comparison"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-2 px-6 font-medium text-gray-700">Name</th>
                    <th className="text-left py-2 px-6 font-medium text-gray-700">Doc type</th>
                    <th className="text-left py-2 px-6 font-medium text-gray-700">Last modified</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocuments.map((document) => (
                    <tr
                      key={document.id}
                      className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${
                        selectedTargetDocument?.id === document.id 
                          ? " border-[#4B2A06]" 
                          : ""
                      }`}
                      onClick={(e) => {
                        // Only handle click if it's not on the radio button
                        if (e.target !== e.currentTarget.querySelector('input[type="radio"]')) {
                          handleDocumentClick(document);
                        }
                      }}
                    >
                      {/* Name Column */}
                      <td className="py-2 px-6">
                        <div className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="document-selection"
                            checked={selectedTargetDocument?.id === document.id}
                            onChange={() => handleDocumentClick(document)}
                            className="h-4 w-5  text-[#4B2A06] focus:ring-[#3A2004] border-gray-300"
                          />
                          <FileText className="h-4 w-4 text-gray-500" />
                          <span className="text-sm font-medium text-gray-900 truncate max-w-xs">
                            {document.name}
                          </span>
                        </div>
                      </td>
                      
                      {/* Doc Type Column */}
                      <td className="py-2 px-6">
                        <div className="flex gap-1">
                          <span className="text-xs px-2 py-1 rounded-full bg-[#ECE9E2] text-[#4B2A06]">
                            {document.type}
                          </span>
                          {document.type === "DRHP" && document.relatedRhpId && (
                            <span className="text-xs px-2 py-1 rounded-full bg-[#F9F6F2] text-[#FF7A1A]">
                              RHP
                            </span>
                          )}
                        </div>
                      </td>
                      
                      {/* Last Modified Column */}
                      <td className="py-2 px-6">
                        <span className="text-sm text-gray-600">
                          {formatDate(document.uploadedAt)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-2 border-t rounded-b-lg border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {filteredDocuments.length} document
              {filteredDocuments.length !== 1 ? "s" : ""} available
              {selectedTargetDocument && (
                <span className="ml-2 text-[#4B2A06] font-medium">
                  • {selectedTargetDocument.name} selected
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleOkClick}
                disabled={!selectedTargetDocument}
                className="px-4 py-2 text-white bg-[#4B2A06] rounded-lg hover:bg-[#3A2004] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

