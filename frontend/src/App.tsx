import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useAuthStore } from './context/authStore';

// Admin pages
import AdminLogin from './pages/admin/AdminLogin';
import AdminDashboard from './pages/admin/AdminDashboard';
import TestList from './pages/admin/TestList';
import TestForm from './pages/admin/TestForm';
import TestDetails from './pages/admin/TestDetails';
import MCQForm from './pages/admin/MCQForm';
import CodingForm from './pages/admin/CodingForm';
import AttemptDetails from './pages/admin/AttemptDetails';
import AgentTestForm from './pages/admin/AgentTestForm';
import TestSettings from './pages/admin/TestSettings';
import ProctorDashboard from './pages/admin/ProctorDashboard';
import PerformanceAnalytics from './pages/admin/PerformanceAnalytics';
import RepositoryLayout from './pages/admin/repository/RepositoryLayout';
import QuestionBank from './pages/admin/repository/QuestionBank';
import CustomQuestions from './pages/admin/repository/CustomQuestions';
import IDVerificationData from './pages/admin/IDVerificationData';
import TrustReports from './pages/admin/TrustReports';

// Candidate pages
import CandidateLogin from './pages/candidate/CandidateLogin';
import TestInvitation from './pages/candidate/TestInvitation';
import TestInstructions from './pages/candidate/TestInstructions';
import TestInterface from './pages/candidate/TestInterface';
import TestComplete from './pages/candidate/TestComplete';

// Components
import AdminLayout from './components/AdminLayout';

function ProtectedAdminRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAdminAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/admin/login" replace />;
}

function ProtectedCandidateRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isCandidateAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/test/login" replace />;
}

function TestResultsRedirect() {
  const { testId } = useParams();
  if (!testId) return <Navigate to="/admin/tests" replace />;
  return <Navigate to={`/admin/tests/${testId}?tab=candidates`} replace />;
}

function TestInvitationsRedirect() {
  const { testId } = useParams();
  if (!testId) return <Navigate to="/admin/tests" replace />;
  return <Navigate to={`/admin/tests/${testId}?tab=candidates`} replace />;
}

export default function App() {
  return (
    <Routes>
      {/* Home redirect */}
      <Route path="/" element={<Navigate to="/admin/login" replace />} />

      {/* Admin routes */}
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route
        path="/admin"
        element={
          <ProtectedAdminRoute>
            <AdminLayout />
          </ProtectedAdminRoute>
        }
      >
        <Route index element={<Navigate to="tests/new" replace />} />
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="tests" element={<TestList />} />
        <Route path="tests/new" element={<TestForm />} />
        <Route path="tests/agent" element={<AgentTestForm />} />
        <Route path="tests/:testId" element={<TestDetails />} />
        <Route path="tests/:testId/edit" element={<TestForm />} />
        <Route path="tests/:testId/settings" element={<TestSettings />} />
        <Route path="tests/:testId/results" element={<TestResultsRedirect />} />
        <Route path="tests/:testId/analytics" element={<PerformanceAnalytics />} />
        <Route path="attempts/:attemptId" element={<AttemptDetails />} />
        <Route path="attempts/:attemptId/proctoring" element={<ProctorDashboard />} />
        <Route path="mcq/new" element={<MCQForm />} />
        <Route path="coding/new" element={<CodingForm />} />
        <Route path="repository" element={<RepositoryLayout />}>
          <Route index element={<Navigate to="question-bank" replace />} />
          <Route path="question-bank" element={<QuestionBank />} />
          <Route path="custom" element={<CustomQuestions />} />
        </Route>
        <Route path="coding/:questionId/edit" element={<CodingForm />} />
        <Route path="id-verification-data" element={<IDVerificationData />} />
        <Route path="trust-reports" element={<TrustReports />} />
        <Route path="tests/:testId/invitations" element={<TestInvitationsRedirect />} />
      </Route>

      {/* Candidate routes */}
      <Route path="/test/login" element={<CandidateLogin />} />
      <Route path="/test/invite/:token" element={<TestInvitation />} />
      <Route
        path="/test/instructions"
        element={
          <ProtectedCandidateRoute>
            <TestInstructions />
          </ProtectedCandidateRoute>
        }
      />
      <Route
        path="/test/start"
        element={
          <ProtectedCandidateRoute>
            <TestInterface />
          </ProtectedCandidateRoute>
        }
      />
      <Route
        path="/test/complete"
        element={
          <ProtectedCandidateRoute>
            <TestComplete />
          </ProtectedCandidateRoute>
        }
      />

      {/* 404 */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
