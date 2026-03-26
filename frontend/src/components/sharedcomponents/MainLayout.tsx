import React from "react";
import { useOutletContext, Outlet, useLocation } from "react-router-dom";
import { ProtectedLayoutContext } from "@/pages/sharedpages/ProtectedLayout";
import { useState } from "react";

export function MainLayout() {
  const {
    recentDocuments,
    currentDocument,
    handleDocumentSelect,
    isSidebarOpen,
    setIsSidebarOpen,
  } = useOutletContext<ProtectedLayoutContext>();

  const lastNamespace =
    currentDocument?.namespace ||
    (recentDocuments && recentDocuments[0]?.namespace);

  const location = useLocation();
  const isUploadPage = location.pathname === "/upload";
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* <TopNav lastNamespace={lastNamespace} /> */}
      <div className="flex-1 flex flex-col">
        <div className="flex flex-1 min-h-0">
          {/* Mobile: floating menu button and drawer */}
          {isUploadPage && isMobile && (
            <>
              {!isMobileSidebarOpen && (
                <button
                  className="fixed top-3 left-3 z-30 bg-card border border-border rounded-full shadow p-2 flex items-center justify-center hover:bg-muted transition-colors"
                  style={{ width: 40, height: 40 }}
                  onClick={() => setIsMobileSidebarOpen(true)}
                  aria-label="Open recent documents sidebar"
                >
                  <span className="text-xl">&#9776;</span>
                </button>
              )}
              {isMobileSidebarOpen && (
                <div className="fixed inset-0 z-40 flex">
                  {/* Overlay background */}
                  <div
                    className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                    onClick={() => setIsMobileSidebarOpen(false)}
                  />
                  {/* Sidebar content */}
                  <div className="relative w-4/5 max-w-xs h-full bg-card border-r border-border flex flex-col z-50 animate-slide-in-left">
                    <button
                      className="absolute top-2 right-2 z-50 bg-muted border border-border rounded-full p-1 hover:bg-background"
                      onClick={() => setIsMobileSidebarOpen(false)}
                      aria-label="Close sidebar"
                    >
                      <span className="text-xl">&times;</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {/* Desktop/tablet: regular sidebar */}
          {isUploadPage && !isMobile && (
            <div
              className={`transition-all duration-300 bg-card border-r border-border flex flex-col ${
                isSidebarOpen ? "w-80" : "w-0"
              }`}
              style={{ overflow: "hidden" }}
            >
              <div className="flex-1 overflow-y-auto">
                {isSidebarOpen && (
                  <button
                    className="h-10 w-10 self-end mt-5 mr-4 p-1 rounded hover:bg-muted text-foreground"
                    onClick={() => setIsSidebarOpen(false)}
                    title="Hide sidebar"
                  >
                    <span>&#10005;</span>
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="flex-1 flex flex-col">
            <Outlet context={useOutletContext()} />
          </div>
        </div>
      </div>
    </div>
  );
}
