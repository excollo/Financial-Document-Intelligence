// Blocks accidental page refresh/navigation during long-running operations.
// Shows a full-screen overlay and intercepts F5/Ctrl+R while `isProcessing` is true.
import { useEffect } from "react";

export const useRefreshProtection = (
  isProcessing: boolean,
  message: string = "Please wait until the current process completes."
) => {
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isProcessing) {
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent F5 or Ctrl+R refresh
      if (isProcessing && (e.key === "F5" || (e.ctrlKey && e.key === "r"))) {
        e.preventDefault();
        alert(message);
      }
    };

    // Add visual indicator to prevent refresh
    const addRefreshBlocker = () => {
      const blocker = document.createElement("div");
      blocker.id = "refresh-blocker";
      blocker.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        text-align:center;
        height: 100%;
        padding: 20px;
        text-align: center;
        z-index: 9999;
        display: none;
      `;
      blocker.textContent = message;
      document.body.appendChild(blocker);
    };

    const showRefreshBlocker = () => {
      const blocker = document.getElementById("refresh-blocker");
      if (blocker) {
        blocker.style.display = "block";
      }
    };

    const hideRefreshBlocker = () => {
      const blocker = document.getElementById("refresh-blocker");
      if (blocker) {
        blocker.style.display = "none";
      }
    };

    // Initialize the blocker
    if (!document.getElementById("refresh-blocker")) {
      addRefreshBlocker();
    }

    // Show/hide blocker based on processing state
    if (isProcessing) {
      showRefreshBlocker();
    } else {
      hideRefreshBlocker();
    }

    // Add event listeners
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("keydown", handleKeyDown);

    // Cleanup
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("keydown", handleKeyDown);
      const blocker = document.getElementById("refresh-blocker");
      if (blocker) {
        blocker.remove();
      }
    };
  }, [isProcessing, message]);
};
