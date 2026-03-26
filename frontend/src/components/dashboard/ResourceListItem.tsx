import React from "react";
import { 
  FileText, 
  Pencil, 
  Trash2, 
  Shield, 
  FolderUpIcon, 
  CheckCircle, 
  BarChart3, 
  X 
} from "lucide-react";
import { StatusBadge } from "./StatusBadge";

interface ResourceListItemProps {
  item: any;
  itemType: 'document' | 'summary' | 'report' | 'job';
  onOpen: (item: any) => void;
  onRename?: (item: any) => void;
  onDelete: (item: any) => void;
  onMove?: (item: any) => void;
  isRenaming?: boolean;
  renameValue?: string;
  onRenameChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRenameSubmit?: (item: any) => void;
  onRenameKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>, item: any) => void;
  onRenameCancel?: () => void;
  selected?: boolean;
  highlighted?: boolean;
  onAnimationEnd?: () => void;
  innerRef?: (el: HTMLDivElement | null) => void;
  // For related documents/summaries/reports
  relatedDocs?: { drhp?: any; rhp?: any };
  onDownload?: (item: any, format: string) => void;
}

export const ResourceListItem: React.FC<ResourceListItemProps> = ({
  item,
  itemType,
  onOpen,
  onRename,
  onDelete,
  onMove,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameKeyDown,
  onRenameCancel,
  selected,
  highlighted,
  onAnimationEnd,
  innerRef,
  relatedDocs
}) => {
  const getIcon = () => {
    switch (itemType) {
      case 'document': return <FileText className="h-3 w-3 text-[#4B2A06] flex-shrink-0" />;
      case 'summary': return <FileText className="h-3 w-3 text-green-600 flex-shrink-0" />;
      case 'report': return <BarChart3 className="h-3 w-3 text-blue-600 flex-shrink-0" />;
      case 'job': return <Shield className="h-4 w-4 text-orange-600" />;
    }
  };

  const getTitle = () => {
    if (itemType === 'document') return item.name;
    return item.title || (itemType === 'job' ? 'Intelligence Job' : 'Untitled');
  };

  const borderClass = () => {
    if (itemType === 'summary') return "border-l-4 border-l-green-500";
    if (itemType === 'report') return "border-l-4 border-l-blue-500";
    if (itemType === 'job') return "border-l-4 border-l-orange-500";
    return "";
  };

  return (
    <div
      key={`${itemType}-${item.id}`}
      ref={innerRef}
      className={`grid grid-cols-12 gap-4 px-6 py-4 border-b border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 cursor-pointer transition-colors relative ${borderClass()}
        ${selected ? "bg-blue-50 border-blue-200" : ""}
        ${highlighted ? "bg-yellow-100 border-yellow-300 animate-pulse" : ""}
      `}
      onClick={() => onOpen(item)}
      onAnimationEnd={onAnimationEnd}
    >
      <div className="col-span-7 flex items-center gap-3">
        {itemType === 'job' ? (
          <div className="bg-orange-50 p-2 rounded-lg">
            {getIcon()}
          </div>
        ) : (
          getIcon()
        )}
        <div className="flex-1 min-w-0">
          {isRenaming && onRenameChange && onRenameSubmit && onRenameKeyDown && onRenameCancel ? (
            <div className="flex items-center gap-2">
              <input
                className="font-medium text-gray-900 border border-gray-300 rounded px-2 py-1 text-sm outline-none focus:outline-none focus:ring-0 focus:border-gray-300"
                value={renameValue}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                onChange={onRenameChange}
                onBlur={() => onRenameSubmit(item)}
                onKeyDown={(e) => onRenameKeyDown(e, item)}
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
            <>
              <span className={`font-medium text-gray-900 truncate block ${itemType === 'job' ? 'text-sm font-semibold' : ''}`}>
                {getTitle()}
              </span>
              {(itemType === 'report' || itemType === 'summary') && relatedDocs && (
                <span className="text-xs text-gray-500 truncate block">
                  {relatedDocs.drhp?.name || 'DRHP'} {itemType === 'report' && relatedDocs.rhp ? 'vs ' + relatedDocs.rhp.name : ''}
                </span>
              )}
            </>
          )}
        </div>
      </div>
      
      <div className="col-span-2 flex items-center">
        <div className="flex gap-2 items-center">
          {itemType === 'document' && (item.relatedRhpId || item.relatedDrhpId) && (
            <span
              className="text-sm p-1.5 rounded-full bg-green-800 text-white flex items-center gap-1 cursor-pointer"
              title={item.type === "DRHP" ? "Linked with RHP" : "Linked with DRHP"}
            >
              <CheckCircle className="h-3 w-3" />
            </span>
          )}
          
          <span className={`text-xs px-2 py-1 rounded-full 
            ${itemType === 'document' ? 'bg-[#ECE9E2] text-[#4B2A06]' : ''}
            ${itemType === 'summary' ? 'bg-green-100 text-green-700' : ''}
            ${itemType === 'report' ? 'bg-blue-100 text-blue-700' : ''}
          `}>
            {itemType === 'document' ? item.type : itemType.charAt(0).toUpperCase() + itemType.slice(1)}
          </span>
          
          {item.status && item.status.toLowerCase() !== 'completed' && item.status.toLowerCase() !== 'ready' && (
            <StatusBadge status={item.status} error={item.error} />
          )}
        </div>
      </div>
      
      <div className="col-span-2 flex items-center">
        <span className="text-sm text-gray-600">
          {(() => {
            const date = item.updatedAt || item.uploadedAt;
            return date ? new Date(date).toLocaleDateString() : "";
          })()}
        </span>
      </div>
      
      <div className="col-span-1 flex items-center justify-end">
        <div className="flex items-center gap-1">
          {itemType === 'job' && item.status === 'completed' && item.output_urls?.docx && (
            <button 
              onClick={(e) => { e.stopPropagation(); window.open(item.output_urls.docx, '_blank'); }}
              className="p-1 hover:bg-blue-50 text-blue-600 rounded"
              title="Download DOCX"
            >
              <FileText className="h-4 w-4" />
            </button>
          )}
          
          {(itemType === 'report' || itemType === 'summary') && (
            <button
              className="text-[#4B2A06] hover:text-[#4B2A06] p-1"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(item);
              }}
              title={`View ${itemType}`}
            >
              {itemType === 'summary' ? (
                <FileText className="h-3 w-3" />
              ) : (
                <img
                  className="h-3 w-3 object-contain"
                  src="https://img.icons8.com/pastel-glyph/128/document--v1.png"
                  alt="view"
                  style={{ display: 'block', minWidth: '12px', minHeight: '12px' }}
                />
              )}
            </button>
          )}

          {onRename && (
            <button
              className="text-[#4B2A06] hover:text-[#4B2A06] p-1"
              onClick={(e) => {
                e.stopPropagation();
                onRename(item);
              }}
              title={`Rename ${itemType}`}
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
          
          {onMove && (
            <button
              className="text-[#4B2A06] hover:text-[#4B2A06] p-1"
              onClick={(e) => {
                e.stopPropagation();
                onMove(item);
              }}
              title="Move to folder"
            >
              <FolderUpIcon className="h-3 w-3" />
            </button>
          )}
          
          <button
            className="text-[#4B2A06] hover:text-red-600 p-1"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(item);
            }}
            title={`Delete ${itemType}`}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
};
