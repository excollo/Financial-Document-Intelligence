import React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface DirectoryListHeaderProps {
  sortBy: "alphabetical" | "lastModified";
  onSortChange: (sortBy: "alphabetical" | "lastModified") => void;
}

export const DirectoryListHeader: React.FC<DirectoryListHeaderProps> = ({
  sortBy,
  onSortChange,
}) => {
  return (
    <div className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 rounded-lg px-6 py-3">
      <div className="grid grid-cols-12 gap-4 text-sm font-semibold text-gray-600">
        <div className="col-span-5">Name</div>
        <div className="col-span-4">Documents</div>
        <div className="col-span-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSortChange(sortBy === "lastModified" ? "alphabetical" : "lastModified");
            }}
            className="flex items-center gap-1.5 hover:text-[#4B2A06] transition-colors group"
            title={sortBy === "lastModified" ? "Click to sort A-Z" : "Click to sort by Last Modified"}
          >
            <span className="select-none">
              {sortBy === "lastModified" ? "Last modified" : "Sort: A-Z"}
            </span>
            <div className="flex flex-col items-center justify-center gap-0">
              <ChevronUp
                className={`h-3 w-3 font-bold transition-colors ${
                  sortBy === "lastModified" ? "text-[#4B2A06]" : "text-gray-400"
                }`}
              />
              <ChevronDown
                className={`h-3 w-3 font-bold transition-colors -mt-0.5 ${
                  sortBy === "alphabetical" ? "text-[#4B2A06]" : "text-gray-400"
                }`}
              />
            </div>
          </button>
        </div>
        <div className="col-span-1 text-left">Actions</div>
      </div>
    </div>
  );
};
