import React, { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Search,
  Folder,
  AlertTriangle,
  Check,
  Loader2,
  Plus,
  FileText,
} from "lucide-react";
import { directoryService } from "@/services/api";
import { toast } from "sonner";
import { useDebounce } from "@/hooks/useDebounce";

interface DirectorySuggestion {
  id: string;
  name: string;
  normalizedName: string;
  similarity: number;
  documentCount: number;
  drhpCount: number;
  rhpCount: number;
  lastDocumentUpload?: Date;
}

interface DirectorySelectorProps {
  open: boolean;
  onClose: () => void;
  onSelect: (directoryId: string) => void;
  onCreateNew?: (directoryId: string, name: string) => void;
  required?: boolean;
}

export function DirectorySelector({
  open,
  onClose,
  onSelect,
  onCreateNew,
  required = true,
}: DirectorySelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<DirectorySuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDirectoryId, setSelectedDirectoryId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newDirectoryName, setNewDirectoryName] = useState("");
  const [creating, setCreating] = useState(false);
  const [duplicateCheck, setDuplicateCheck] = useState<{
    isDuplicate: boolean;
    exactMatch: any;
    similarDirectories: DirectorySuggestion[];
  } | null>(null);

  const debouncedSearch = useDebounce(searchQuery, 300);

  // Search directories when query changes
  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setSuggestions([]);
      setSelectedDirectoryId(null);
      setDuplicateCheck(null);
      return;
    }

    const performSearch = async () => {
      if (!debouncedSearch || debouncedSearch.trim() === "") {
        // Show recent/popular directories when no query
        setLoading(true);
        try {
          const results = await directoryService.search("", 10);
          setSuggestions(results);
        } catch (error: any) {
          console.error("Error searching directories:", error);
          toast.error("Failed to load directories");
        } finally {
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      try {
        const results = await directoryService.search(debouncedSearch, 10);
        setSuggestions(results);
      } catch (error: any) {
        console.error("Error searching directories:", error);
        toast.error("Failed to search directories");
      } finally {
        setLoading(false);
      }
    };

    performSearch();
  }, [debouncedSearch, open]);

  // Check for duplicates when creating new directory
  const checkDuplicate = useCallback(async (name: string) => {
    if (!name || name.trim() === "") {
      setDuplicateCheck(null);
      return;
    }

    try {
      const result = await directoryService.checkDuplicate(name);
      setDuplicateCheck(result);
    } catch (error: any) {
      console.error("Error checking duplicate:", error);
    }
  }, []);

  const handleCreateNew = async () => {
    if (!newDirectoryName || newDirectoryName.trim() === "") {
      toast.error("Please enter a directory name");
      return;
    }

    // Check for duplicates
    const duplicateResult = await directoryService.checkDuplicate(newDirectoryName);
    
    if (duplicateResult.isDuplicate && duplicateResult.exactMatch) {
      toast.error("A directory with this name already exists");
      setSelectedDirectoryId(duplicateResult.exactMatch.id);
      setShowCreateDialog(false);
      // Select the existing directory
      onSelect(duplicateResult.exactMatch.id);
      return;
    }

    if (duplicateResult.similarDirectories.length > 0) {
      // Show warning but allow creation
      const shouldProceed = confirm(
        `Similar directories found (${duplicateResult.similarDirectories[0].similarity}% match). Do you want to create a new directory anyway?`
      );
      if (!shouldProceed) {
        // User wants to use existing
        setSelectedDirectoryId(duplicateResult.similarDirectories[0].id);
        setShowCreateDialog(false);
        onSelect(duplicateResult.similarDirectories[0].id);
        return;
      }
    }

    setCreating(true);
    try {
      const newDir = await directoryService.create(newDirectoryName.trim(), null);
      toast.success("Directory created successfully");
      setShowCreateDialog(false);
      setNewDirectoryName("");
      
      // Call onCreateNew callback if provided, then select the directory
      if (onCreateNew) {
        onCreateNew(newDir.id, newDir.name);
      }
      
      // Select the newly created directory
      onSelect(newDir.id);
      
      // Refresh search
      const results = await directoryService.search("", 10);
      setSuggestions(results);
    } catch (error: any) {
      console.error("Error creating directory:", error);
      if (error.response?.status === 409) {
        if (error.response.data.similarDirectories?.length > 0) {
          toast.error("Similar directories found. Please use an existing directory.");
          setDuplicateCheck(error.response.data);
        } else if (error.response.data.existingDirectory) {
          // Use existing directory
          setSelectedDirectoryId(error.response.data.existingDirectory.id);
          setShowCreateDialog(false);
          onSelect(error.response.data.existingDirectory.id);
        } else {
          toast.error(error.response.data.error || "Directory already exists");
        }
      } else {
        toast.error("Failed to create directory");
      }
    } finally {
      setCreating(false);
    }
  };

  const handleSelect = (directoryId: string) => {
    setSelectedDirectoryId(directoryId);
    onSelect(directoryId);
    onClose();
  };

  const getSimilarityColor = (similarity: number) => {
    if (similarity === 100) return "bg-green-100 text-green-700 border-green-200";
    if (similarity >= 90) return "bg-yellow-100 text-yellow-700 border-yellow-200";
    if (similarity >= 80) return "bg-orange-100 text-orange-700 border-orange-200";
    return "bg-gray-100 text-gray-700 border-gray-200";
  };

  const getSimilarityIcon = (similarity: number) => {
    if (similarity === 100) return <Check className="h-4 w-4" />;
    if (similarity >= 85) return <AlertTriangle className="h-4 w-4" />;
    return null;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[#4B2A06]">
              Select Company Directory
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search directories by company name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-white border-gray-300 text-[#4B2A06]"
              />
            </div>

            {/* Suggestions List */}
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : suggestions.length === 0 ? (
                <div className="p-4 text-sm text-gray-500 text-center">
                  {searchQuery ? "No directories found" : "No directories yet"}
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {suggestions.map((dir) => (
                    <button
                      key={dir.id}
                      onClick={() => {
                        // When clicking on a suggested directory, open it immediately
                        onSelect(dir.id);
                        onClose();
                      }}
                      className={`w-full p-4 text-left hover:bg-gray-50 transition-colors ${
                        selectedDirectoryId === dir.id ? "bg-blue-50" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Folder className="h-4 w-4 text-gray-600" />
                            <span className="font-medium text-[rgba(38,40,43,1)]">
                              {dir.name}
                            </span>
                            {dir.similarity < 100 && (
                              <Badge
                                className={`text-xs ${getSimilarityColor(dir.similarity)}`}
                              >
                                {getSimilarityIcon(dir.similarity)}
                                <span className="ml-1">{dir.similarity.toFixed(0)}%</span>
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-[rgba(114,120,127,1)] mt-1">
                            <span className="flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              {dir.documentCount} docs
                            </span>
                            {dir.drhpCount > 0 && (
                              <Badge variant="outline" className="text-xs">
                                {dir.drhpCount} DRHP
                              </Badge>
                            )}
                            {dir.rhpCount > 0 && (
                              <Badge variant="outline" className="text-xs">
                                {dir.rhpCount} RHP
                              </Badge>
                            )}
                          </div>
                        </div>
                        {selectedDirectoryId === dir.id && (
                          <Check className="h-5 w-5 text-green-600" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Create New Button */}
            <Button
              onClick={() => {
                setNewDirectoryName(searchQuery || "");
                setShowCreateDialog(true);
              }}
              className="w-full bg-[#4B2A06] text-white hover:bg-[#3A2004]"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create New Directory
            </Button>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {selectedDirectoryId && (
              <Button
                onClick={() => handleSelect(selectedDirectoryId)}
                className="bg-[#4B2A06] text-white hover:bg-[#3A2004]"
              >
                Select
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Directory Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#4B2A06]">Create New Directory</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-[rgba(38,40,43,1)] mb-2 block">
                Company Name
              </label>
              <Input
                placeholder="Enter company name..."
                value={newDirectoryName}
                onChange={(e) => {
                  setNewDirectoryName(e.target.value);
                  checkDuplicate(e.target.value);
                }}
                className="bg-white border-gray-300 text-[#4B2A06]"
              />
            </div>

            {/* Duplicate Warning */}
            {duplicateCheck?.isDuplicate && duplicateCheck.exactMatch && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-red-800">
                      Directory already exists
                    </p>
                    <p className="text-xs text-red-600 mt-1">
                      "{duplicateCheck.exactMatch.name}" already exists. Please use it instead.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Similar Directories Warning */}
            {duplicateCheck?.similarDirectories &&
              duplicateCheck.similarDirectories.length > 0 &&
              !duplicateCheck.isDuplicate && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-yellow-800">
                        Similar directories found
                      </p>
                      <div className="mt-2 space-y-1">
                        {duplicateCheck.similarDirectories.slice(0, 3).map((dir) => (
                          <button
                            key={dir.id}
                            onClick={() => {
                              setSelectedDirectoryId(dir.id);
                              setShowCreateDialog(false);
                              handleSelect(dir.id);
                            }}
                            className="text-xs text-yellow-700 hover:text-yellow-900 underline block"
                          >
                            "{dir.name}" ({dir.similarity.toFixed(0)}% match) - Use this
                            instead?
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateNew}
              disabled={creating || !newDirectoryName.trim()}
              className="bg-[#4B2A06] text-white hover:bg-[#3A2004]"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Directory"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

