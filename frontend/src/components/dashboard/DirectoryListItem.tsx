import React from "react";
import { 
  Folder as FolderIcon, 
  GitCompareArrows,
  Pencil, 
  Share2, 
  Building2, 
  Trash2, 
  X, 
  CheckCircle, 
  BarChart3, 
  FileText 
} from "lucide-react";

interface DirectoryListItemProps {
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

export const DirectoryListItem: React.FC<DirectoryListItemProps> = ({
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
  const canCompare = !!documentTypes?.hasDrhp && !!documentTypes?.hasRhp;

  return (
    <div
      className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-gray-50/80 cursor-pointer transition-all duration-200 border-b border-gray-100 group/row"
      onClick={() => onOpen(directory)}
    >
      <div className="col-span-5 flex items-center gap-3">
        <FolderIcon className="h-4 w-4 text-[#4B2A06]" />
        {isRenaming ? (
          <div className="flex items-center gap-2 " onClick={(e) => e.stopPropagation()}>
            <input
              className="font-medium text-gray-900 border border-gray-300 rounded px-2 py-1 text-sm outline-none focus:outline-none focus:ring-0 focus:border-gray-300"
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
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">{directory.name}</span>
            {directory.isShared && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 flex items-center gap-1">
                <Share2 className="h-3 w-3" />
                Shared
              </span>
            )}
          </div>
        )}
      </div>

      <div className="col-span-4 flex items-center gap-2 flex-wrap">
        {documentTypes && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {documentTypes.hasDrhp && (
              <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#ECE9E2] text-[#4B2A06] border border-[#DEDACD] flex items-center gap-1 shrink-0 shadow-sm">
                DRHP
                <CheckCircle className="h-2.5 w-2.5" />
              </span>
            )}
            {documentTypes.hasRhp && (
              <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#ECE9E2] text-[#4B2A06] border border-[#DEDACD] flex items-center gap-1 shrink-0 shadow-sm">
                RHP
                <CheckCircle className="h-2.5 w-2.5" />
              </span>
            )}
            {reportsCount > 0 && (
              <span
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100 flex items-center gap-1.5 cursor-pointer hover:bg-blue-100 transition-colors shadow-sm shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewReports(directory);
                }}
              >
                <BarChart3 className="h-3 w-3" />
                {reportsCount} Report{reportsCount > 1 ? 's' : ''}
              </span>
            )}
            {summariesCount > 0 && (
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center gap-1.5 shadow-sm shrink-0">
                <FileText className="h-3 w-3" />
                {summariesCount} Summar{summariesCount > 1 ? 'ies' : 'y'}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="col-span-2 text-sm text-gray-500">
        {directory.updatedAt ? new Date(directory.updatedAt).toLocaleDateString() : (directory.createdAt ? new Date(directory.createdAt).toLocaleDateString() : '')}
      </div>

      <div className="col-span-1 flex items-center justify-end gap-1">
        <button
          className={`text-[#4B2A06] p-1.5 rounded-md hover:bg-gray-100 transition-all ${(!canCompare || compareLoading) ? 'opacity-50 cursor-not-allowed' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (canCompare && !compareLoading) onCompare(directory);
          }}
          disabled={!canCompare || compareLoading}
          title={canCompare ? "Compare documents" : "Upload both DRHP and RHP to compare"}
        >
          <GitCompareArrows className="h-3.5 w-3.5" />
        </button>
        <button
          className="text-[#4B2A06] p-1.5 rounded-md hover:bg-gray-100 transition-all"
          onClick={(e) => {
            e.stopPropagation();
            onRename(directory);
          }}
          title="Rename directory"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          className="text-[#4B2A06] p-1.5 rounded-md hover:bg-gray-100 transition-all"
          onClick={(e) => {
            e.stopPropagation();
            onShare(directory.id);
          }}
          title="Share directory"
        >
          <Share2 className="h-3.5 w-3.5" />
        </button>
        {isAdmin && onMoveToWorkspace && (
          <button
            className="text-[#4B2A06] p-1.5 rounded-md hover:bg-gray-100 transition-all"
            onClick={(e) => {
              e.stopPropagation();
              onMoveToWorkspace(directory.id, directory.name);
            }}
            title="Move to workspace"
          >
            <Building2 className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          className="text-red-500 hover:text-red-600 p-1.5 rounded-md hover:bg-red-50 transition-all"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(directory);
          }}
          title="Delete directory"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};
