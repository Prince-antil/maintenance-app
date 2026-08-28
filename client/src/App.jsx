import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect, lazy, Suspense } from 'react';
import { useAuth } from './context/AuthContext.jsx';
import { useUI } from './context/UIContext.jsx';
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
import MasterImportModal from './components/MasterImportModal.jsx';
import ToastViewport from './components/ToastViewport.jsx';

// Lazily loaded CMMS modules — keeps the initial bundle lean
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Breakdowns = lazy(() => import('./pages/Breakdowns.jsx'));
const PreventiveMaintenance = lazy(() => import('./pages/PreventiveMaintenance.jsx'));
const Energy = lazy(() => import('./pages/Energy.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const SOPLibrary = lazy(() => import('./pages/SOPLibrary.jsx'));

const LOGIN_MODAL_KEY = 'ccpl_show_login_modal';

function AppContent() {
  const { user, loading } = useAuth();
  const {
    uploadState, closeUpload,
    showLogin, openLogin, closeLogin,
    showAddMachine, closeAddMachine,
    showMasterImport, closeMasterImport,
    previewFile, closePreview,
    signalRefresh,
    toasts, dismissToast,
  } = useUI();
  const navigate = useNavigate();
  const location = useLocation();
  const [showWelcome, setShowWelcome] = useState(false);

  // ── Route guard: force login for all protected routes ───────────────────
  const isLoginPage = location.pathname === '/login';
  const isPublicRoute = false; // All routes require auth
  const needsAuth = !isPublicRoute && !isLoginPage;

  // When user is null after loading, force-open login modal
  useEffect(() => {
    if (!loading && needsAuth && !user) {
      openLogin();
    }
  }, [loading, user, needsAuth, openLogin]);

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

  // ── Loading state ──────────────────────────────────────────────────────
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

  // ── Auth guard: block all content when unauthenticated ─────────────────
  if (needsAuth && !user) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center px-6">
          <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/25 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div>
            <h2 className="text-white text-xl font-bold mb-1">Authentication Required</h2>
            <p className="text-slate-400 text-sm max-w-sm">
              You must be logged in to access this page. The login dialog will open automatically.
            </p>
          </div>
          <button
            onClick={openLogin}
            className="btn-primary inline-flex items-center gap-2 text-sm mt-2"
          >
            Open Login
          </button>
        </div>
        {showLogin && <LoginModal onClose={closeLogin} />}
        <ToastViewport toasts={toasts} dismissToast={dismissToast} />
      </div>
    );
  }

  // ── Full-screen welcome experience for freshly logged-in users ─────────
  if (showWelcome && user) {
    return <WelcomePage onEnterDashboard={handleEnterDashboard} />;
  }

  // ── Authenticated app shell ────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <TopNavbar />

      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 min-w-0 flex flex-col page-enter">
          <div className="flex-1 p-4 lg:p-6">
            <Suspense
              fallback={
                <div className="max-w-7xl mx-auto space-y-4 animate-pulse" role="status" aria-label="Loading module">
                  <div className="h-9 w-64 rounded-control bg-white/[0.05]" />
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[...Array(4)].map((_, i) => <div key={i} className="h-20 glass-card" />)}
                  </div>
                  <div className="h-72 glass-card" />
                </div>
              }
            >
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/category/:categoryName" element={<CategoryView />} />
                <Route path="/machines" element={<Machines />} />
                <Route path="/machines/:machineId" element={<MachineProfile />} />
                <Route path="/breakdowns" element={<Breakdowns />} />
                <Route path="/pm" element={<PreventiveMaintenance />} />
                <Route path="/energy" element={<Energy />} />
                <Route path="/sop" element={<SOPLibrary />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </Suspense>
          </div>
          <Footer />
        </main>
      </div>

      <QuickActionsPanel />

      {/* Global modals */}
      {showLogin && <LoginModal onClose={closeLogin} />}
      {uploadState && user?.role === 'admin' && (
        <UploadModal
          initialState={uploadState}
          onClose={closeUpload}
          onSuccess={signalRefresh}
        />
      )}
      {showAddMachine && user?.role === 'admin' && <MachineModal onClose={closeAddMachine} />}
      {showMasterImport && user?.role === 'admin' && (
        <MasterImportModal
          onClose={closeMasterImport}
          onSuccess={signalRefresh}
        />
      )}
      {previewFile && <DocumentPreviewModal file={previewFile} onClose={closePreview} />}
      <ToastViewport toasts={toasts} dismissToast={dismissToast} />
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
