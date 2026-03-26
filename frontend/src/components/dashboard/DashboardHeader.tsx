import React, { useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Grid3X3,
  List,
  Loader2,
  Plus,
  Shield,
  Upload,
  Users,
} from "lucide-react";

interface DashboardHeaderProps {
  currentFolder: { id: string; name: string } | null;
  isUploading: boolean;
  hasDrhpInDirectory: boolean;
  hasRhpInDirectory: boolean;
  onBack: () => void;
  onUpload: (type: "DRHP" | "RHP") => void;
  onCreateFolder: () => void;
  viewMode: "list" | "card";
  onViewModeChange: (mode: "list" | "card") => void;
  directoryTimeFilter: string;
  onTimeFilterChange: (filter: string) => void;
  isAdmin: boolean;
  onNavigateAdmin: () => void;
  onNavigateUsers: () => void;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  currentFolder,
  isUploading,
  hasDrhpInDirectory,
  hasRhpInDirectory,
  onBack,
  onUpload,
  onCreateFolder,
  viewMode,
  onViewModeChange,
  directoryTimeFilter,
  onTimeFilterChange,
  isAdmin,
  onNavigateAdmin,
  onNavigateUsers,
}) => {
  const [showTimeFilter, setShowTimeFilter] = useState(false);
  const [showUploadDropdown, setShowUploadDropdown] = useState(false);

  const filterOptions = [
    { value: "all", label: "All Directories" },
    { value: "today", label: "Today" },
    { value: "last7", label: "Last 7 days" },
    { value: "last15", label: "Last 15 days" },
    { value: "last30", label: "Last 30 days" },
    { value: "last60", label: "Last 60 days" },
  ];

  const selectedOption =
    filterOptions.find((opt) => opt.value === directoryTimeFilter) ||
    filterOptions[0];

  return (
    <div className="flex flex-col space-y-[1.5vw] mb-[1.5vw]">
      {/* Title/Admin and Upload Button Row */}
      <div className="flex justify-between items-start">
        <div className="flex flex-col">
          {isAdmin && (
            <div className="flex gap-[1vw]">
              <button
                onClick={onNavigateAdmin}
                className="flex items-center gap-[0.5vw] bg-[#4B2A06] text-white font-semibold px-[1.5vw] py-[0.5vw] rounded-lg text-lg hover:bg-[#3A2004] transition-colors"
              >
                <Shield className="h-5 w-5" />
                Admin Dashboard
              </button>
              <button
                onClick={onNavigateUsers}
                className="flex items-center gap-[0.5vw] bg-[#FF7A1A] text-white font-semibold px-[1.5vw] py-[0.5vw] rounded-lg text-lg hover:bg-[#E56A0A] transition-colors"
              >
                <Users className="h-5 w-5" />
                User Management
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end relative">
          {currentFolder?.id ? (
            <div className="flex items-center gap-2">
              {hasDrhpInDirectory && hasRhpInDirectory ? (
                <button
                  className="flex items-center gap-[0.5vw] bg-gray-400 text-white font-semibold px-4 py-2 rounded-lg shadow-lg text-lg cursor-not-allowed opacity-60"
                  disabled={true}
                  title="Both DRHP and RHP documents already exist in this directory"
                >
                  <Upload className="h-4 w-4" />
                  Upload Document
                  <ChevronDown className="h-4 w-4" />
                </button>
              ) : hasDrhpInDirectory && !hasRhpInDirectory ? (
                <button
                  className="flex items-center gap-[0.5vw] bg-[#4B2A06] text-white font-semibold px-4 py-2 rounded-lg shadow-lg text-lg transition hover:bg-[#3A2004] focus:outline-none"
                  onClick={() => onUpload("RHP")}
                  disabled={isUploading}
                  title="Upload RHP document"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      Upload RHP
                    </>
                  )}
                </button>
              ) : hasRhpInDirectory && !hasDrhpInDirectory ? (
                <button
                  className="flex items-center gap-[0.5vw] bg-[#4B2A06] text-white font-semibold px-4 py-2 rounded-lg shadow-lg text-lg transition hover:bg-[#3A2004] focus:outline-none"
                  onClick={() => onUpload("DRHP")}
                  disabled={isUploading}
                  title="Upload DRHP document"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      Upload DRHP
                    </>
                  )}
                </button>
              ) : (
                <div className="relative upload-dropdown-container">
                  <button
                    className="flex items-center gap-[0.5vw] bg-[#4B2A06] text-white font-semibold px-4 py-2 rounded-lg shadow-lg text-lg transition hover:bg-[#3A2004] focus:outline-none"
                    onClick={() => setShowUploadDropdown(!showUploadDropdown)}
                    disabled={isUploading}
                    title="Upload document"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4" />
                        Upload Document
                        <ChevronDown className="h-4 w-4" />
                      </>
                    )}
                  </button>
                  {showUploadDropdown && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setShowUploadDropdown(false)}
                      />
                      <div className="absolute right-0 mt-2 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[180px]">
                        <button
                          className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                          onClick={() => {
                            onUpload("DRHP");
                            setShowUploadDropdown(false);
                          }}
                        >
                          <Upload className="h-4 w-4" />
                          Upload DRHP
                        </button>
                        <button
                          className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                          onClick={() => {
                            onUpload("RHP");
                            setShowUploadDropdown(false);
                          }}
                        >
                          <Upload className="h-4 w-4" />
                          Upload RHP
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <button
              className="flex items-center gap-[0.5vw] bg-[#4B2A06] text-white font-semibold px-4 py-2 rounded-lg shadow-lg text-lg transition hover:bg-[#3A2004] focus:outline-none"
              onClick={onCreateFolder}
              disabled={isUploading}
              title="Create new folder and upload document"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  Create New
                  <Plus className="h-4 w-4" />
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Filters and View Controls */}
      <div className="flex justify-between items-center mb-[2vw]">
        <div className="flex items-center gap-4">
          {currentFolder?.name ? (
            <button
              className="flex items-center bg-[#F3F4F6] gap-[0.5vw] text-[#5A6473] font-semibold rounded-lg px-[1.2vw] py-[0.5vw] text-sm hover:text-[#4B2A06]"
              onClick={onBack}
              title="Back to all directories"
            >
              <ArrowLeft className="h-4 w-4" />
              <div className="flex items-center bg-[#F3F4F6] text-[#4B2A06] font-semibold rounded-lg text-base">
                <span className="truncate max-w-[18vw]" title={currentFolder.name}>
                  {currentFolder.name}
                </span>
              </div>
            </button>
          ) : (
            <div className="relative">
              <button
                onClick={() => setShowTimeFilter(!showTimeFilter)}
                className="flex items-center gap-[0.5vw] font-semibold px-[1.5vw] py-[0.5vw] rounded-lg bg-[#F3F4F6] text-[#5A6473] hover:bg-[#E5E7EB] transition-colors relative pr-10"
              >
                <span>{selectedOption.label}</span>
                {showTimeFilter ? (
                  <ChevronUp className="h-4 w-4 absolute right-2" />
                ) : (
                  <ChevronDown className="h-4 w-4 absolute right-2" />
                )}
              </button>
              {showTimeFilter && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowTimeFilter(false)}
                  />
                  <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[180px]">
                    {filterOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          onTimeFilterChange(option.value);
                          setShowTimeFilter(false);
                        }}
                        className={`w-full text-left px-4 py-2 text-sm font-medium transition-colors ${
                          directoryTimeFilter === option.value
                            ? "bg-[#F3F4F6] text-[#4B2A06]"
                            : "text-[#5A6473] hover:bg-[#F3F4F6]"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-[0.5vw]">
          <div className="flex bg-[#F3F4F6] rounded-lg p-1">
            <button
              className={`flex items-center gap-1 px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                viewMode === "list"
                  ? "bg-white text-[#4B2A06] shadow-sm"
                  : "text-[#5A6473] hover:text-[#4B2A06]"
              }`}
              onClick={() => onViewModeChange("list")}
              title="List view"
            >
              <List className="h-4 w-4" />
              <span>List</span>
            </button>
            <button
              className={`flex items-center gap-1 px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                viewMode === "card"
                  ? "bg-white text-[#4B2A06] shadow-sm"
                  : "text-[#5A6473] hover:text-[#4B2A06]"
              }`}
              onClick={() => onViewModeChange("card")}
              title="Card view"
            >
              <Grid3X3 className="h-4 w-4" />
              <span>Cards</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
