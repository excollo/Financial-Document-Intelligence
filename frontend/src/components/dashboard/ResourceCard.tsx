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

interface ResourceCardProps {
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
  // For Job result documents
  relatedDocs?: { drhp?: any; rhp?: any };
}

export const ResourceCard: React.FC<ResourceCardProps> = ({
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
  const renderIcon = () => {
    switch (itemType) {
      case 'document': return <FileText className="h-3 w-3 text-[#4B2A06] mb-[1vw]" />;
      case 'summary': return <FileText className="h-3 w-3 text-green-600 mb-[1vw]" />;
      case 'report': return <BarChart3 className="h-3 w-3 text-blue-600 mb-[1vw]" />;
      case 'job': return <Shield className="h-3 w-3 text-orange-600 mb-[1vw]" />;
    }
  };

  const borderClass = () => {
    if (itemType === 'summary') return "border-l-4 border-l-green-500";
    if (itemType === 'report') return "border-l-4 border-l-blue-500";
    if (itemType === 'job') return "border-l-4 border-l-orange-500";
    return "";
  };

  const getTitle = () => {
    if (itemType === 'document') return item.name;
    return item.title || (itemType === 'job' ? 'Intelligence Job' : 'Untitled');
  };

  return (
    <div
      key={`${itemType}-${item.id}`}
      ref={innerRef}
      className={`flex flex-col items-start bg-[#F3F4F6] rounded-xl p-[1vw] min-w-[180px] min-h-[110px] w-full cursor-pointer hover:bg-[#ECECEC] transition relative ${borderClass()}
        ${selected ? "ring-2 ring-[#4B2A06] bg-[#ECECEC]" : ""}
        ${highlighted ? "ring-4 ring-orange-400 bg-yellow-100 animate-pulse" : ""}
      `}
      onClick={() => onOpen(item)}
      onAnimationEnd={onAnimationEnd}
    >
      <div className="flex w-full justify-between items-start">
        <div className="flex-1 min-w-0">
          {renderIcon()}
        </div>
        <div className="flex" onClick={(e) => e.stopPropagation()}>
          {onRename && (
            <button
              className="text-muted-foreground hover:text-[#4B2A06] p-[0.3vw]"
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
              className="text-muted-foreground hover:text-[#4B2A06] p-[0.3vw]"
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
            className="text-muted-foreground hover:text-destructive p-[0.3vw]"
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

      {isRenaming && onRenameChange && onRenameSubmit && onRenameCancel && onRenameKeyDown ? (
        <div className="flex items-center w-full mt-[0.5vw] mb-[0.5vw]">
          <input
            className="font-semibold text-[#232323] mb-1 max-w-full truncate block border border-gray-300 rounded px-[0.5vw] py-[0.3vw] outline-none focus:outline-none focus:ring-0 focus:border-gray-300"
            style={{ maxWidth: "120px" }}
            value={renameValue}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.stopPropagation()}
            onChange={onRenameChange}
            onBlur={() => onRenameSubmit(item)}
            onKeyDown={(e) => onRenameKeyDown(e, item)}
          />
          <button
            className="ml-[0.5vw] text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onRenameCancel();
            }}
            title="Cancel rename"
          >
            <X className="h-[0.8vw] w-[0.8vw] min-w-[12px] min-h-[12px]" />
          </button>
        </div>
      ) : (
        <span
          className="font-semibold text-[#232323] mb-1 max-w-full truncate block"
          style={{
            maxWidth: "180px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={getTitle()}
        >
          {getTitle()}
        </span>
      )}

      {itemType === 'document' && (
        <span className="text-[#A1A1AA] text-sm">
          {item.size || (item.fileSize ? `${Math.round(item.fileSize / 1024)} KB` : "")}
        </span>
      )}

      {itemType === 'report' && relatedDocs && (
        <div className="text-xs text-gray-500 truncate block mb-1">
          {relatedDocs.drhp?.name || 'DRHP'} {relatedDocs.drhp && relatedDocs.rhp ? 'vs' : ''} {relatedDocs.rhp?.name || 'RHP'}
        </div>
      )}

      {itemType === 'summary' && relatedDocs?.drhp && (
        <span className="text-xs text-gray-500 truncate block mb-1">
          {relatedDocs.drhp.name}
        </span>
      )}

      <div className="flex items-center justify-between w-full mt-[0.5vw]">
        <span className="text-[#A1A1AA] text-xs">
          {(() => {
            const date = item.updatedAt || item.uploadedAt;
            return date ? new Date(date).toLocaleDateString() : "";
          })()}
        </span>
        <div className="flex items-center gap-1">
          <div className={`flex justify-between items-center ${itemType === 'report' ? 'gap-1' : ''}`}>
            <span className={`text-xs px-2 py-1 ${itemType === 'document' ? 'mx-1' : 'mx-1'} rounded-full 
              ${itemType === 'document' ? 'bg-[#ECE9E2] text-[#4B2A06]' : ''}
              ${itemType === 'summary' ? 'bg-green-100 text-green-700' : ''}
              ${itemType === 'report' ? 'bg-blue-100 text-blue-700' : ''}
            `}>
              {itemType === 'document' ? item.type : itemType.charAt(0).toUpperCase() + itemType.slice(1)}
            </span>
            
            {itemType === 'document' && (item.relatedRhpId || item.relatedDrhpId) && (
              <span
                className="text-sm p-1.5 rounded-full bg-green-800 text-white flex items-center gap-1 cursor-pointer"
                title={item.type === "DRHP" ? "Linked with RHP" : "Linked with DRHP"}
              >
                <CheckCircle className="h-3 w-3" />
              </span>
            )}
            
            {item.status && item.status.toLowerCase() !== 'completed' && item.status.toLowerCase() !== 'ready' && (
              <StatusBadge status={item.status} error={item.error} />
            )}
          </div>
        </div>
      </div>

      {itemType === 'job' && item.status === 'completed' && item.output_urls && (
        <div className="flex gap-2 mt-2 w-full">
          {item.output_urls.docx && (
            <button 
              onClick={(e) => { e.stopPropagation(); window.open(item.output_urls.docx, '_blank'); }}
              className="text-[10px] px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              DOCX
            </button>
          )}
          {item.output_urls.excel && (
            <button 
              onClick={(e) => { e.stopPropagation(); window.open(item.output_urls.excel, '_blank'); }}
              className="text-[10px] px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-700"
            >
              EXCEL
            </button>
          )}
        </div>
      )}
    </div>
  );
};
