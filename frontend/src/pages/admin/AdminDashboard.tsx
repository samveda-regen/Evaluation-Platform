import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { format } from 'date-fns';

interface DashboardStats {
  totalTests: number;
  activeTests: number;
  totalAttempts: number;
  totalQuestions: number;
}

interface RecentAttempt {
  id: string;
  startTime: string;
  status: string;
  score?: number;
  candidate: { name: string; email: string };
  test: { name: string };
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentAttempts, setRecentAttempts] = useState<RecentAttempt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const { data } = await adminApi.getDashboard();
      setStats(data.stats);
      setRecentAttempts(data.recentAttempts);
    } catch (error) {
      toast.error('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Dashboard</h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="card bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <h3 className="text-lg opacity-90">Total Tests</h3>
          <p className="text-4xl font-bold mt-2">{stats?.totalTests || 0}</p>
          <Link to="/admin/tests" className="text-sm opacity-80 hover:opacity-100 mt-2 inline-block">
            View all →
          </Link>
        </div>

        <div className="card bg-gradient-to-br from-green-500 to-green-600 text-white">
          <h3 className="text-lg opacity-90">Active Tests</h3>
          <p className="text-4xl font-bold mt-2">{stats?.activeTests || 0}</p>
          <span className="text-sm opacity-80 mt-2 inline-block">Currently live</span>
        </div>

        <div className="card bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <h3 className="text-lg opacity-90">Total Attempts</h3>
          <p className="text-4xl font-bold mt-2">{stats?.totalAttempts || 0}</p>
          <span className="text-sm opacity-80 mt-2 inline-block">All time</span>
        </div>

        <div className="card bg-gradient-to-br from-orange-500 to-orange-600 text-white">
          <h3 className="text-lg opacity-90">Total Questions</h3>
          <p className="text-4xl font-bold mt-2">{stats?.totalQuestions || 0}</p>
          <span className="text-sm opacity-80 mt-2 inline-block">MCQ + Coding</span>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card mb-8">
        <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <Link to="/admin/tests/new" className="btn btn-primary">
            Create Test
          </Link>
          <Link to="/admin/repository/question-bank" className="btn btn-secondary">
            Open Library
          </Link>
        </div>
      </div>

      {/* Recent Attempts */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Recent Test Attempts</h2>
        {recentAttempts.length === 0 ? (
          <p className="text-gray-500">No attempts yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left border-b">
                  <th className="pb-3 font-medium">Candidate</th>
                  <th className="pb-3 font-medium">Test</th>
                  <th className="pb-3 font-medium">Start Time</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {recentAttempts.map((attempt) => (
                  <tr key={attempt.id} className="border-b last:border-0">
                    <td className="py-3">
                      <div>
                        <p className="font-medium">{attempt.candidate.name}</p>
                        <p className="text-sm text-gray-500">{attempt.candidate.email}</p>
                      </div>
                    </td>
                    <td className="py-3">{attempt.test.name}</td>
                    <td className="py-3 text-sm">
                      {format(new Date(attempt.startTime), 'MMM d, yyyy h:mm a')}
                    </td>
                    <td className="py-3">
                      <span
                        className={`badge ${
                          attempt.status === 'submitted'
                            ? 'badge-success'
                            : attempt.status === 'auto_submitted'
                            ? 'badge-warning'
                            : attempt.status === 'in_progress'
                            ? 'badge-info'
                            : 'badge-danger'
                        }`}
                      >
                        {attempt.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3">
                      {attempt.score !== null ? attempt.score : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
