import React from "react";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-lg p-6 border border-border w-full max-w-2xl relative">
        <button
          className="absolute top-2 right-2 text-xl font-bold text-gray-500 hover:text-gray-800"
          onClick={onClose}
          aria-label="Close settings"
        >
          ×
        </button>
        <h2 className="text-2xl font-bold text-foreground mb-4">Settings</h2>
        <div className="space-y-6">
          <div>
            <label className="block text-foreground font-medium mb-1">
              Theme
            </label>
            <select className="w-full p-2 rounded bg-muted text-muted-foreground border border-border">
              <option>Dark</option>
              <option>Light</option>
              <option>System</option>
            </select>
          </div>
          <div>
            <label className="block text-foreground font-medium mb-1">
              Notifications
            </label>
            <input type="checkbox" className="mr-2" checked readOnly />
            <span className="text-muted-foreground">
              Enable notifications (dummy)
            </span>
          </div>
          <div>
            <label className="block text-foreground font-medium mb-1">
              Account
            </label>
            <button className="px-4 py-2 rounded bg-primary text-primary-foreground hover:opacity-90 transition">
              Manage Account (dummy)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
