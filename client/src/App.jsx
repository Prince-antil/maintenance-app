import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useAuth } from './context/AuthContext.jsx';
import { useUI } from './context/UIContext.jsx';
import Dashboard from './pages/Dashboard.jsx';
import CategoryView from './pages/CategoryView.jsx';
import WelcomePage from './pages/WelcomePage.jsx';
import Machines from './pages/Machines.jsx';
import MachineProfile from './pages/MachineProfile.jsx';
import TopNavbar from './components/TopNavbar.jsx';
import Sidebar from './components/Sidebar.jsx';
import Footer from './components/Footer.jsx';
import QuickActionsPanel from './components/QuickActionsPanel.jsx';
import LoginModal from './components/LoginModal.jsx';
import UploadModal from './components/UploadModal.jsx';
import MachineModal from './components/MachineModal.jsx';
import DocumentPreviewModal from './components/DocumentPreviewModal.jsx';

function AppContent() {
  const { user, loading } = useAuth();
  const {
    uploadState, closeUpload,
    showLogin, closeLogin,
    showAddMachine, closeAddMachine,
    previewFile, closePreview,
    signalRefresh,
  } = useUI();
  const navigate = useNavigate();
  const [showWelcome, setShowWelcome] = useState(false);

  // Show welcome page right after login
  useEffect(() => {
    if (user && !sessionStorage.getItem('ccpl_entered')) {
      setShowWelcome(true);
    }
  }, [user]);

  const handleEnterDashboard = () => {
    sessionStorage.setItem('ccpl_entered', 'true');
    setShowWelcome(false);
    navigate('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" role="status" />
          <p className="text-slate-400 text-sm">Loading CCPL Maintenance & Reliability Hub...</p>
        </div>
      </div>
    );
  }

  // Full-screen welcome experience for freshly logged-in users
  if (showWelcome && user) {
    return <WelcomePage onEnterDashboard={handleEnterDashboard} />;
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <TopNavbar />

      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 min-w-0 flex flex-col page-enter">
          <div className="flex-1 p-4 lg:p-6">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/category/:categoryName" element={<CategoryView />} />
              <Route path="/machines" element={<Machines />} />
              <Route path="/machines/:machineId" element={<MachineProfile />} />
            </Routes>
          </div>
          <Footer />
        </main>
      </div>

      <QuickActionsPanel />

      {/* Global modals */}
      {showLogin && <LoginModal onClose={closeLogin} />}
      {uploadState && user?.role === 'admin' && (
        <UploadModal
          initialCategory={uploadState.category}
          onClose={closeUpload}
          onSuccess={signalRefresh}
        />
      )}
      {showAddMachine && user?.role === 'admin' && <MachineModal onClose={closeAddMachine} />}
      {previewFile && <DocumentPreviewModal file={previewFile} onClose={closePreview} />}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
