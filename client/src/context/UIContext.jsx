import { createContext, useContext, useState, useCallback } from 'react';

// Global UI orchestration: modals, sidebar state, data refresh signal
const UIContext = createContext(null);

export function UIProvider({ children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  const [uploadState, setUploadState] = useState(null); // null | { category?: string }
  const [showLogin, setShowLogin] = useState(false);
  const [showAddMachine, setShowAddMachine] = useState(false);
  const [previewFile, setPreviewFile] = useState(null); // null | { filename, file_url, file_format }
  const [refreshKey, setRefreshKey] = useState(0);

  const openUpload = useCallback((category) => setUploadState({ category: category || '' }), []);
  const closeUpload = useCallback(() => setUploadState(null), []);
  const openLogin = useCallback(() => setShowLogin(true), []);
  const closeLogin = useCallback(() => setShowLogin(false), []);
  const openAddMachine = useCallback(() => setShowAddMachine(true), []);
  const closeAddMachine = useCallback(() => setShowAddMachine(false), []);
  const openPreview = useCallback((file) => setPreviewFile(file), []);
  const closePreview = useCallback(() => setPreviewFile(null), []);
  const signalRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const toggleSidebar = useCallback(() => {
    // Desktop collapses, mobile toggles the off-canvas drawer
    if (window.innerWidth < 1024) setSidebarMobileOpen((v) => !v);
    else setSidebarCollapsed((v) => !v);
  }, []);

  return (
    <UIContext.Provider
      value={{
        sidebarCollapsed, setSidebarCollapsed,
        sidebarMobileOpen, setSidebarMobileOpen,
        toggleSidebar,
        uploadState, openUpload, closeUpload,
        showLogin, openLogin, closeLogin,
        showAddMachine, openAddMachine, closeAddMachine,
        previewFile, openPreview, closePreview,
        refreshKey, signalRefresh,
      }}
    >
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  return useContext(UIContext);
}
