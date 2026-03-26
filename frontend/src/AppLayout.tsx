import { Outlet, useLocation } from "react-router-dom";

const AppLayout = () => {
  const location = useLocation();

  // A simple way to get a namespace if it exists in the path
  const getNamespaceFromPath = (path: string) => {
    const match = path.match(/^\/doc\/([^/]+)/);
    return match ? match[1] : undefined;
  };

  // const namespace = getNamespaceFromPath(location.pathname);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* TopNav header removed from all pages */}
      <main className="flex-1 flex flex-col">
        <Outlet />
      </main>
    </div>
  );
};

export default AppLayout;
