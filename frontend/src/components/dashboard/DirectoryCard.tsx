import React from "react";
import { 
  Folder as FolderIcon, 
  Pencil, 
  Share2, 
  Building2, 
  Trash2, 
  X, 
  CheckCircle, 
  BarChart3, 
  FileText 
} from "lucide-react";

interface DirectoryCardProps {
  directory: any;
  onOpen: (dir: any) => void;
  onRename: (dir: any) => void;
  onDelete: (dir: any) => void;
  onShare: (dirId: string) => void;
  onMoveToWorkspace?: (dirId: string, name: string) => void;
  onCompare: (dir: any) => void;
  linkedStatus: boolean;
  documentTypes?: { hasDrhp: boolean; hasRhp: boolean };
  reportsCount: number;
  summariesCount: number;
  isAdmin: boolean;
  compareLoading: boolean;
  renamingId: string | null;
  renameValue: string;
  onRenameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRenameSubmit: (dir: any) => void;
  onRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, dir: any) => void;
  onRenameCancel: () => void;
  onViewReports: (dir: any) => void;
}

export const DirectoryCard: React.FC<DirectoryCardProps> = ({
  directory,
  onOpen,
  onRename,
  onDelete,
  onShare,
  onMoveToWorkspace,
  onCompare,
  linkedStatus,
  documentTypes,
  reportsCount,
  summariesCount,
  isAdmin,
  compareLoading,
  renamingId,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameKeyDown,
  onRenameCancel,
  onViewReports,
}) => {
  const isRenaming = renamingId === directory.id;

  return (
    <div
      className="flex flex-col items-start bg-[#F3F4F6] justify-between rounded-xl p-[1vw] min-w-[180px] min-h-[150px] w-full cursor-pointer hover:bg-[#ECECEC] transition relative"
      onClick={() => onOpen(directory)}
    >
      <div className="flex w-full justify-between items-start">
        <div className="flex-1 min-w-0">
          <FolderIcon className="h-4 w-4 text-[#4B2A06] mb-[1vw]" />
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {/* Compare button */}
          <button
            className={`text-[#4B2A06] hover:text-[#3A2004] p-1 flex items-center justify-center ${compareLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!compareLoading) onCompare(directory);
            }}
            title={linkedStatus ? "View comparison report" : "Compare documents in this directory"}
            disabled={compareLoading}
          >
            {linkedStatus ? (
              <img
                className="h-3 w-3 object-contain"
                src="https://img.icons8.com/pastel-glyph/128/document--v1.png"
                alt="view"
                style={{ display: 'block', minWidth: '12px', minHeight: '12px' }}
              />
            ) : (
              <img
                className="h-3 w-3 object-contain"
                src="https://img.icons8.com/ios/50/compare.png"
                alt="compare"
                style={{ display: 'block', minWidth: '12px', minHeight: '12px' }}
              />
            )}
          </button>
          
          <button
            className="text-[#4B2A06] hover:text-[#3A2004] p-1"
            onClick={(e) => {
              e.stopPropagation();
              onRename(directory);
            }}
            title="Rename directory"
          >
            <Pencil className="h-3 w-3" />
          </button>
          
          <button
            className="text-[#4B2A06] hover:text-[#3A2004] p-1"
            onClick={(e) => {
              e.stopPropagation();
              onShare(directory.id);
            }}
            title="Share directory"
          >
            <Share2 className="h-3 w-3" />
          </button>
          
          {isAdmin && onMoveToWorkspace && (
            <button
              className="text-[#4B2A06] hover:text-[#3A2004] p-1"
              onClick={(e) => {
                e.stopPropagation();
                onMoveToWorkspace(directory.id, directory.name);
              }}
              title="Move to workspace (Admin only)"
            >
              <Building2 className="h-3 w-3" />
            </button>
          )}
          
          <button
            className="text-[#4B2A06] hover:text-red-600 p-1"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(directory);
            }}
            title="Delete directory"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {isRenaming ? (
        <div className="flex items-center gap-2 w-full mb-1" onClick={(e) => e.stopPropagation()}>
          <input
            className="font-semibold text-[#232323] border border-gray-300 rounded px-2 py-1 text-sm outline-none focus:outline-none focus:ring-0 focus:border-gray-300 flex-1"
            value={renameValue}
            autoFocus
            onChange={onRenameChange}
            onBlur={() => onRenameSubmit(directory)}
            onKeyDown={(e) => onRenameKeyDown(e, directory)}
          />
          <button
            className="text-gray-400 hover:text-red-500"
            onClick={(e) => {
              e.stopPropagation();
              onRenameCancel();
            }}
            title="Cancel rename"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-[#232323] max-w-full truncate block" style={{ maxWidth: "220px" }}>
            {directory.name}
          </span>
          {directory.isShared && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 flex items-center gap-1 flex-shrink-0" title="Shared directory">
              <Share2 className="h-3 w-3" />
              Shared
            </span>
          )}
        </div>
      )}

      {documentTypes && (
        <div className="flex items-center gap-1 mb-1 flex-wrap">
          {documentTypes.hasDrhp && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#ECE9E2] text-[#4B2A06] flex items-center gap-1">
              DRHP
              <CheckCircle className="h-3 w-3" />
            </span>
          )}
          {documentTypes.hasRhp && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#ECE9E2] text-[#4B2A06] flex items-center gap-1">
              RHP
              <CheckCircle className="h-3 w-3" />
            </span>
          )}
          {reportsCount > 0 && (
            <span
              className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 flex items-center gap-1 cursor-pointer hover:bg-blue-200"
              onClick={(e) => {
                e.stopPropagation();
                onViewReports(directory);
              }}
              title={`${reportsCount} comparison report${reportsCount > 1 ? 's' : ''} available`}
            >
              <BarChart3 className="h-3 w-3" />
              {reportsCount} Report{reportsCount > 1 ? 's' : ''}
            </span>
          )}
          {summariesCount > 0 && (
            <span
              className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex items-center gap-1"
              title={`${summariesCount} summar${summariesCount > 1 ? 'ies' : 'y'} available`}
            >
              <FileText className="h-3 w-3" />
              {summariesCount} Summar{summariesCount > 1 ? 'ies' : 'y'}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
