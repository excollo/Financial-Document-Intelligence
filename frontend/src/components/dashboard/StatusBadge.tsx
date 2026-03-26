import React from "react";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";

interface StatusBadgeProps {
  status: string;
  error?: any;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, error }) => {
  const cleanStatus = status?.trim().toLowerCase();
  
  // Extract error message if it's an object or string
  const errorMessage = typeof error === 'string' 
    ? error 
    : (error?.message || error?.error || JSON.stringify(error) || "Unknown error");

  switch (cleanStatus) {
    case 'completed':
    case 'ready':
      return (
        <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 flex items-center gap-1">
          Completed <CheckCircle className="h-3 w-3" />
        </span>
      );
    case 'failed':
      return (
        <span 
          className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 flex items-center gap-1 cursor-help"
          title={errorMessage}
        >
          Failed <AlertCircle className="h-3 w-3" />
        </span>
      );
    case 'processing':
    case 'uploading':
      return (
        <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 flex items-center gap-1">
          Processing <Loader2 className="h-3 w-3 animate-spin" />
        </span>
      );
    default:
      return (
        <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">
          {status || 'Unknown'}
        </span>
      );
  }
};
