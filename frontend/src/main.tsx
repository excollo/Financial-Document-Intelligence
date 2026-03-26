import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { toast } from "sonner";

createRoot(document.getElementById("root")!).render(<App />);

function checkGlobalReadyFlags() {
  Object.keys(localStorage).forEach((key) => {
    if (key.startsWith("summary_ready_")) {
      toast.success("Summary is ready!");
      localStorage.removeItem(key); // Remove after showing toast
    }
    if (key.startsWith("report_ready_")) {
      toast.success("Comparison report is ready!");
      localStorage.removeItem(key); // Remove after showing toast
    }
  });
}

window.addEventListener("focus", checkGlobalReadyFlags);
checkGlobalReadyFlags();
