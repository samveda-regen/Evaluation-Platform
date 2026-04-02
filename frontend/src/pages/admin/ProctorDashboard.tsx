/**
 * ProctorDashboard Component
 *
 * Admin dashboard for viewing proctoring data:
 * - Session overview
 * - Violation list with filters
 * - Recording playback
 * - Trust scores
 * - Event review and dismissal
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { format } from 'date-fns';

import api from '../../services/api';
import { violationLabel } from '../../utils/violationLabels';

const REPORT_EVENT_TYPES = new Set([
  'tab_switch',
  'window_blur',
  'fullscreen_exit',
  'copy_paste_attempt',
  'camera_blocked',
  'multiple_faces',
  'phone_detected',
  'face_not_detected',
  'looking_away',
  'voice_detected',
  'secondary_monitor_detected',
]);

interface ProctorSession {
  id: string;
  attemptId: string;
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  screenShareEnabled: boolean;
  monitorCount: number;
  externalMonitorDetected: boolean;
  faceVerified: boolean;
  startedAt: string;
  endedAt: string | null;
  trustScore: number;
  attempt: {
    candidate: {
      id: string;
      name: string;
      email: string;
    };
    test: {
      id: string;
      name: string;
    };
    violations: number;
    isFlagged: boolean;
  };
}

interface ProctorEvent {
  id: string;
  eventType: string;
  severity: string;
  confidence: number;
  description: string;
  metadata: string | null;
  snapshotUrl: string | null;
  audioClipUrl: string | null;
  timestamp: string;
  duration: number | null;
  reviewed: boolean;
  reviewedAt: string | null;
  dismissed: boolean;
  reviewNotes: string | null;
}

export default function ProctorDashboard() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<ProctorSession | null>(null);
  const [events, setEvents] = useState<ProctorEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [reviewedFilter, setReviewedFilter] = useState<string>('all');

  // Modal states
  const [selectedEvent, setSelectedEvent] = useState<ProctorEvent | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [showReviewModal, setShowReviewModal] = useState(false);

  useEffect(() => {
    if (attemptId) {
      fetchSessionData();
    }
  }, [attemptId]);

  const fetchSessionData = async () => {
    try {
      setLoading(true);

      // Get proctoring summary
      const summaryRes = await api.get(`/proctoring/admin/attempt/${attemptId}/summary`);

      if (summaryRes.data.sessionInfo) {
        // Get detailed session info
        const sessionId = summaryRes.data.sessionInfo?.id;
        if (sessionId) {
          const [sessionRes, eventsRes] = await Promise.all([
            api.get(`/proctoring/admin/session/${sessionId}`),
            api.get(`/proctoring/admin/session/${sessionId}/events`),
          ]);

          setSession(sessionRes.data.session);
          setEvents(eventsRes.data.events || []);
        }
      }
    } catch (error) {
      console.error('Failed to fetch session data:', error);
      toast.error('Failed to load proctoring data');
    } finally {
      setLoading(false);
    }
  };

  const handleReviewEvent = async (eventId: string, dismissed: boolean) => {
    try {
      await api.patch(`/proctoring/admin/event/${eventId}/review`, {
        dismissed,
        reviewNotes,
      });

      toast.success(dismissed ? 'Event dismissed' : 'Event reviewed');
      setShowReviewModal(false);
      setSelectedEvent(null);
      setReviewNotes('');
      fetchSessionData();
    } catch (error) {
      toast.error('Failed to review event');
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-200';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getTrustScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const reportEvents = events.filter(event => REPORT_EVENT_TYPES.has(event.eventType));
  const filteredEvents = reportEvents.filter(event => {
    if (severityFilter !== 'all' && event.severity !== severityFilter) return false;
    if (reviewedFilter === 'reviewed' && !event.reviewed) return false;
    if (reviewedFilter === 'unreviewed' && event.reviewed) return false;
    if (reviewedFilter === 'dismissed' && !event.dismissed) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-700">No Proctoring Data</h2>
        <p className="text-gray-500 mt-2">No proctoring session found for this attempt.</p>
        <button
          onClick={() => navigate(-1)}
          className="mt-4 btn btn-primary"
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Trust Score Report</h1>
            <p className="text-gray-500">
              {session.attempt.candidate.name} - {session.attempt.test.name} (Matrix-aligned trust report)
            </p>
          </div>
          <button onClick={() => navigate(-1)} className="btn btn-secondary">
            Back
          </button>
        </div>

        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="card">
            <h3 className="text-sm font-medium text-gray-500">Trust Score</h3>
            <p className={`text-3xl font-bold ${getTrustScoreColor(session.trustScore)}`}>
              {session.trustScore.toFixed(0)}%
            </p>
          </div>
          <div className="card">
            <h3 className="text-sm font-medium text-gray-500">Report Violations</h3>
            <p className="text-3xl font-bold text-gray-800">{reportEvents.length}</p>
          </div>
          <div className="card">
            <h3 className="text-sm font-medium text-gray-500">Monitors Detected</h3>
            <p className={`text-3xl font-bold ${session.monitorCount > 1 ? 'text-red-600' : 'text-gray-800'}`}>
              {session.monitorCount}
            </p>
          </div>
          <div className="card">
            <h3 className="text-sm font-medium text-gray-500">Status</h3>
            <div className="flex items-center gap-2 mt-1">
              {session.attempt.isFlagged ? (
                <span className="badge badge-error">Flagged</span>
              ) : (
                <span className="badge badge-success">Normal</span>
              )}
            </div>
          </div>
        </div>

        {/* Session Info */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Session Details</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Camera:</span>
              <span className={`ml-2 ${session.cameraEnabled ? 'text-green-600' : 'text-red-600'}`}>
                {session.cameraEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Microphone:</span>
              <span className={`ml-2 ${session.microphoneEnabled ? 'text-green-600' : 'text-red-600'}`}>
                {session.microphoneEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Face Verified:</span>
              <span className={`ml-2 ${session.faceVerified ? 'text-green-600' : 'text-yellow-600'}`}>
                {session.faceVerified ? 'Yes' : 'No'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">External Monitor:</span>
              <span className={`ml-2 ${session.externalMonitorDetected ? 'text-red-600' : 'text-green-600'}`}>
                {session.externalMonitorDetected ? 'Detected' : 'None'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Started:</span>
              <span className="ml-2">{format(new Date(session.startedAt), 'MMM d, yyyy HH:mm')}</span>
            </div>
            <div>
              <span className="text-gray-500">Ended:</span>
              <span className="ml-2">
                {session.endedAt ? format(new Date(session.endedAt), 'MMM d, yyyy HH:mm') : 'In Progress'}
              </span>
            </div>
          </div>
        </div>

        {/* Violations/Events */}
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Violation Report ({filteredEvents.length})</h2>
            <div className="flex gap-2">
              <select
                value={severityFilter}
                onChange={e => setSeverityFilter(e.target.value)}
                className="input text-sm"
              >
                <option value="all">All Severity</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <select
                value={reviewedFilter}
                onChange={e => setReviewedFilter(e.target.value)}
                className="input text-sm"
              >
                <option value="all">All Status</option>
                <option value="unreviewed">Unreviewed</option>
                <option value="reviewed">Reviewed</option>
                <option value="dismissed">Dismissed</option>
              </select>
            </div>
          </div>

          {filteredEvents.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No reportable violations found</p>
          ) : (
            <div className="space-y-3">
              {filteredEvents.map(event => (
                <div
                  key={event.id}
                  className={`border rounded-lg p-4 ${event.dismissed ? 'opacity-50' : ''}`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`badge border ${getSeverityColor(event.severity)}`}>
                          {event.severity}
                        </span>
                        <span className="font-medium">{violationLabel(event.eventType)}</span>
                        {event.reviewed && (
                          <span className="badge badge-info">Reviewed</span>
                        )}
                        {event.dismissed && (
                          <span className="badge badge-warning">Dismissed</span>
                        )}
                      </div>
                      <p className="text-gray-600 text-sm">{event.description}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {format(new Date(event.timestamp), 'MMM d, yyyy HH:mm:ss')}
                        {event.confidence && ` | Confidence: ${event.confidence.toFixed(0)}%`}
                        {event.duration ? ` | Duration: ${(event.duration / 1000).toFixed(1)}s` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {event.snapshotUrl && (
                        <a
                          href={event.snapshotUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary-600 hover:text-primary-800"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </a>
                      )}
                      {!event.reviewed && (
                        <button
                          onClick={() => {
                            setSelectedEvent(event);
                            setShowReviewModal(true);
                          }}
                          className="btn btn-sm btn-secondary"
                        >
                          Review
                        </button>
                      )}
                    </div>
                  </div>

                  {event.snapshotUrl && (
                    <img
                      src={event.snapshotUrl}
                      alt="Violation snapshot"
                      className="mt-3 rounded max-h-48 object-contain"
                    />
                  )}

                  {event.reviewNotes && (
                    <div className="mt-2 p-2 bg-gray-50 rounded text-sm">
                      <span className="text-gray-500">Review notes: </span>
                      {event.reviewNotes}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Review Modal */}
        {showReviewModal && selectedEvent && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h2 className="text-xl font-bold mb-4">Review Violation</h2>
              <p className="text-gray-600 mb-4">
                <strong>{violationLabel(selectedEvent.eventType)}</strong>: {selectedEvent.description}
              </p>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Review Notes (optional)
                </label>
                <textarea
                  value={reviewNotes}
                  onChange={e => setReviewNotes(e.target.value)}
                  className="input w-full h-24"
                  placeholder="Add any notes about this violation..."
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => handleReviewEvent(selectedEvent.id, false)}
                  className="btn btn-primary flex-1"
                >
                  Mark Reviewed
                </button>
                <button
                  onClick={() => handleReviewEvent(selectedEvent.id, true)}
                  className="btn btn-warning flex-1"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => {
                    setShowReviewModal(false);
                    setSelectedEvent(null);
                    setReviewNotes('');
                  }}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
