import React from "react";

export const ResourceListHeader: React.FC = () => {
  return (
    <div className="bg-gray-50 border-b border-gray-200 rounded-lg px-6 py-3">
      <div className="grid grid-cols-12 gap-4 text-sm font-semibold text-gray-600 ">
        <div className="col-span-7">Name</div>
        <div className="col-span-2">Doc type</div>
        <div className="col-span-2">Last modified</div>
        <div className="col-span-1 text-right">Actions</div>
      </div>
    </div>
  );
};
