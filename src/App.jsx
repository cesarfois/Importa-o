import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { queryClient, persister } from './services/queryClient';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import WorkflowHistoryPage from './pages/WorkflowHistoryPage';
import WorkflowDiagramPage from './pages/WorkflowDiagramPage';
import DashboardLayout from './components/Layout/DashboardLayout';
import CallbackPage from './pages/CallbackPage';

// Protected Route Wrapper
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const location = window.location;

  if (loading) {
    console.log('⏳ ProtectedRoute: Loading...');
    return <div>Loading...</div>;
  }

  if (!user) {
    console.warn('⛔ ProtectedRoute: Access denied. Redirecting to login.', {
      path: location.pathname,
      userState: user,
      loadingState: loading
    });
    // Save target path to redirect back after login
    sessionStorage.setItem('redirect_after_login', location.pathname + location.search);
    return <Navigate to="/login" />;
  }

  console.log('✅ ProtectedRoute: Access granted.', { path: location.pathname });
  return children;
};

function App() {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/callback" element={<CallbackPage />} />
            <Route
              path="/importacao"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <WorkflowHistoryPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />

            {/* Standalone diagram view – no sidebar/layout, only the diagram */}
            <Route
              path="/workflow-diagram"
              element={<WorkflowDiagramPage />}
            />
            <Route
              path="/importacao/workflow-diagram"
              element={<WorkflowDiagramPage />}
            />

            {/* Legacy/Redirect Routes */}
            <Route path="/compras" element={<Navigate to="/importacao" replace />} />
            <Route path="/compra-de-material" element={<Navigate to="/importacao" replace />} />
            <Route path="/compras/workflow-diagram" element={<Navigate to="/importacao/workflow-diagram" replace />} />
            <Route path="/compra-de-material/workflow-diagram" element={<Navigate to="/importacao/workflow-diagram" replace />} />

            <Route path="/" element={<Navigate to="/importacao" replace />} />
            <Route path="*" element={<Navigate to="/importacao" replace />} />
          </Routes>
        </Router>
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}

export default App;
