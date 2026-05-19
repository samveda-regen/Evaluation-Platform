/**
 * PerformanceAnalytics Dashboard
 *
 * Admin dashboard for viewing AI-powered performance analytics:
 * - Difficulty-based analysis
 * - Topic-wise performance
 * - Skill analysis
 * - Candidate comparison
 * - Leaderboard
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';

import api from '../../services/api';

interface DifficultyAnalysis {
  easy: { totalCorrect: number; totalQuestions: number; avgAccuracy: number };
  medium: { totalCorrect: number; totalQuestions: number; avgAccuracy: number };
  hard: { totalCorrect: number; totalQuestions: number; avgAccuracy: number };
  totalAttempts: number;
}

interface TopicAnalysis {
  topic: string;
  totalCorrect: number;
  totalQuestions: number;
  avgAccuracy: number;
  candidateCount: number;
}

interface SkillAnalysis {
  skill: string;
  totalCorrect: number;
  totalQuestions: number;
  avgAccuracy: number;
  candidateCount: number;
}

interface CandidateComparison {
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  score: number;
  percentage: number;
  percentile: number;
  grade: string;
  trustScore: number;
  violations: number;
  isFlagged: boolean;
  difficultyAccuracy: {
    easy: number;
    medium: number;
    hard: number;
  } | null;
}

interface TestAnalytics {
  totalAttempts: number;
  completedAttempts: number;
  averageScore: number;
  medianScore: number;
  highestScore: number;
  lowestScore: number;
  passRate: number;
  flaggedAttempts: number;
  averageTrustScore: number;
  scoreDistribution: Record<string, number>;
}

type ChartDatum = {
  label: string;
  value: number;
  sublabel?: string;
  colorClass?: string;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

const hasChartData = (items: ChartDatum[]) => items.some((item) => item.value > 0);

function BarChart({
  items,
  emptyMessage,
}: {
  items: ChartDatum[];
  emptyMessage: string;
}) {
  const maxValue = Math.max(...items.map((item) => item.value), 0);

  return (
    <div className="relative min-h-[260px] rounded-lg border border-slate-100 bg-slate-50/60 px-5 pb-5 pt-4">
      <div className="absolute inset-x-5 top-8 bottom-16 grid grid-rows-4">
        {[0, 1, 2, 3].map((line) => (
          <div key={line} className="border-t border-slate-200" />
        ))}
      </div>
      {!hasChartData(items) && (
        <div className="absolute inset-x-0 top-20 z-10 text-center text-sm text-slate-500">
          {emptyMessage}
        </div>
      )}
      <div className="relative z-20 flex h-56 items-end gap-4">
        {items.map((item) => {
          const height = maxValue > 0 ? Math.max(8, (item.value / maxValue) * 170) : 4;
          return (
            <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <div className="flex h-[178px] w-full items-end justify-center">
                <div
                  className={`w-full max-w-[72px] rounded-t-lg ${item.colorClass || 'bg-blue-500'} shadow-sm transition-all`}
                  style={{ height: `${height}px`, opacity: item.value > 0 ? 1 : 0.35 }}
                  title={`${item.label}: ${item.value}`}
                />
              </div>
              <div className="min-h-[40px] text-center">
                <p className="truncate text-sm font-semibold text-slate-800">{item.label}</p>
                <p className="text-xs text-slate-500">{item.sublabel ?? item.value}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HorizontalMetricChart({
  items,
  emptyMessage,
}: {
  items: ChartDatum[];
  emptyMessage: string;
}) {
  return (
    <div className="space-y-4">
      {!hasChartData(items) && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
          {emptyMessage}
        </div>
      )}
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{item.label}</p>
              {item.sublabel && <p className="text-xs text-slate-500">{item.sublabel}</p>}
            </div>
            <span className="text-sm font-bold text-slate-900">{item.value.toFixed(1)}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div
              className={`h-2 rounded-full ${item.colorClass || 'bg-blue-500'}`}
              style={{ width: `${clampPercent(item.value)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PerformanceAnalytics() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'difficulty' | 'topics' | 'skills' | 'comparison'>('overview');

  // Data states
  const [testAnalytics, setTestAnalytics] = useState<TestAnalytics | null>(null);
  const [difficultyAnalysis, setDifficultyAnalysis] = useState<DifficultyAnalysis | null>(null);
  const [topicAnalysis, setTopicAnalysis] = useState<TopicAnalysis[]>([]);
  const [skillAnalysis, setSkillAnalysis] = useState<SkillAnalysis[]>([]);
  const [comparison, setComparison] = useState<CandidateComparison[]>([]);

  // Filters
  const [scoreFilter, setScoreFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [sortBy, setSortBy] = useState<'score' | 'percentile' | 'trustScore'>('score');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);

  useEffect(() => {
    if (testId) {
      fetchData();
    }
  }, [testId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const testRes = await api.get(`/analytics/test/${testId}`);
      const [diffRes, topicRes, skillRes, comparisonRes] = await Promise.all([
        api.get(`/analytics/test/${testId}/difficulty`),
        api.get(`/analytics/test/${testId}/topics`),
        api.get(`/analytics/test/${testId}/skills`),
        api.get(`/analytics/test/${testId}/comparison`),
      ]);

      setTestAnalytics(testRes.data.analytics);
      setDifficultyAnalysis(diffRes.data.analysis);
      setTopicAnalysis(topicRes.data.topics || []);
      setSkillAnalysis(skillRes.data.skills || []);
      setComparison(comparisonRes.data.comparison || []);
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
      toast.error('Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  };

  const regenerateAnalytics = async () => {
    try {
      toast.loading('Regenerating analytics...');
      await api.post(`/analytics/test/${testId}/regenerate`);
      toast.dismiss();
      toast.success('Analytics regenerated successfully');
      fetchData();
    } catch (error) {
      toast.dismiss();
      toast.error('Failed to regenerate analytics');
    }
  };

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A+': case 'A': return 'text-green-600 bg-green-100';
      case 'B+': case 'B': return 'text-blue-600 bg-blue-100';
      case 'C': return 'text-yellow-600 bg-yellow-100';
      case 'D': return 'text-orange-600 bg-orange-100';
      case 'F': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getTrustScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const filteredComparison = comparison
    .filter(c => {
      if (showFlaggedOnly && !c.isFlagged) return false;
      if (scoreFilter === 'high' && c.percentage < 70) return false;
      if (scoreFilter === 'medium' && (c.percentage < 40 || c.percentage >= 70)) return false;
      if (scoreFilter === 'low' && c.percentage >= 40) return false;
      return true;
    })
    .sort((a, b) => {
      const aVal = a[sortBy] ?? 0;
      const bVal = b[sortBy] ?? 0;
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

  const scoreDistributionItems: ChartDatum[] = Object.entries(testAnalytics?.scoreDistribution || {})
    .sort((a, b) => {
      const aStart = parseInt(a[0].split('-')[0], 10);
      const bStart = parseInt(b[0].split('-')[0], 10);
      return aStart - bStart;
    })
    .map(([range, count]) => ({
      label: range,
      value: count,
      sublabel: `${count} candidate${count === 1 ? '' : 's'}`,
      colorClass: 'bg-blue-600',
    }));

  const difficultyItems: ChartDatum[] = difficultyAnalysis
    ? (['easy', 'medium', 'hard'] as const).map((level) => {
        const colorClass = {
          easy: 'bg-emerald-500',
          medium: 'bg-amber-500',
          hard: 'bg-red-500',
        }[level];
        const label = level.charAt(0).toUpperCase() + level.slice(1);

        return {
          label,
          value: difficultyAnalysis[level].avgAccuracy,
          sublabel: `${difficultyAnalysis[level].totalCorrect}/${difficultyAnalysis[level].totalQuestions} correct`,
          colorClass,
        };
      })
    : [];

  const topicItems: ChartDatum[] = topicAnalysis.map((topic) => ({
    label: topic.topic,
    value: topic.avgAccuracy,
    sublabel: `${topic.totalCorrect}/${topic.totalQuestions} correct across ${topic.candidateCount} candidate${topic.candidateCount === 1 ? '' : 's'}`,
    colorClass: topic.avgAccuracy >= 70 ? 'bg-emerald-500' : topic.avgAccuracy >= 50 ? 'bg-amber-500' : 'bg-red-500',
  }));

  const skillItems: ChartDatum[] = skillAnalysis.map((skill) => ({
    label: skill.skill,
    value: skill.avgAccuracy,
    sublabel: `${skill.totalCorrect}/${skill.totalQuestions} correct across ${skill.candidateCount} candidate${skill.candidateCount === 1 ? '' : 's'}`,
    colorClass: skill.avgAccuracy >= 70 ? 'bg-emerald-500' : skill.avgAccuracy >= 50 ? 'bg-amber-500' : 'bg-red-500',
  }));

  const insightCards = testAnalytics
    ? [
        {
          label: 'Score Health',
          value:
            testAnalytics.averageScore > 0
              ? `Average score is ${testAnalytics.averageScore.toFixed(1)}, with a ${testAnalytics.passRate.toFixed(1)}% pass rate.`
              : 'No scored performance yet. Charts will become more informative after evaluated submissions.',
        },
        {
          label: 'Integrity Signal',
          value:
            testAnalytics.averageTrustScore > 0
              ? `Average trust score is ${testAnalytics.averageTrustScore.toFixed(0)}%, with ${testAnalytics.flaggedAttempts} flagged attempt${testAnalytics.flaggedAttempts === 1 ? '' : 's'}.`
              : 'No proctoring trust score has been recorded for these attempts yet.',
        },
        {
          label: 'Focus Area',
          value:
            difficultyItems.length > 0
              ? `${difficultyItems.reduce((lowest, item) => (item.value < lowest.value ? item : lowest), difficultyItems[0]).label} questions need the most attention based on current accuracy.`
              : 'Difficulty insights will appear after attempt analytics are generated.',
        },
      ]
    : [];

  const comparisonChartItems: ChartDatum[] = filteredComparison.slice(0, 8).map((candidate) => ({
    label: candidate.candidateName || candidate.candidateEmail,
    value: candidate.percentage || 0,
    sublabel: `${(candidate.percentage || 0).toFixed(0)}% score`,
    colorClass: (candidate.percentage || 0) >= 70 ? 'bg-emerald-500' : (candidate.percentage || 0) >= 40 ? 'bg-amber-500' : 'bg-red-500',
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Performance Analytics</h1>
          <p className="text-gray-500">AI-powered performance analysis and insights</p>
        </div>
          <div className="flex gap-2">
            <button onClick={regenerateAnalytics} className="btn btn-secondary">
              Regenerate
            </button>
            <button onClick={() => navigate(-1)} className="btn btn-secondary">
              Back
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            {[
              { id: 'overview', label: 'Overview' },
              { id: 'difficulty', label: 'Difficulty Analysis' },
              { id: 'topics', label: 'Topic Analysis' },
              { id: 'skills', label: 'Skill Analysis' },
              { id: 'comparison', label: 'Candidate Comparison' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`py-3 px-6 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && testAnalytics && (
          <div className="space-y-6">
            {/* Key Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="card">
                <h3 className="text-sm font-medium text-gray-500">Total Attempts</h3>
                <p className="text-3xl font-bold text-gray-800">{testAnalytics.totalAttempts}</p>
              </div>
              <div className="card">
                <h3 className="text-sm font-medium text-gray-500">Average Score</h3>
                <p className="text-3xl font-bold text-primary-600">{testAnalytics.averageScore?.toFixed(1) || 0}</p>
              </div>
              <div className="card">
                <h3 className="text-sm font-medium text-gray-500">Pass Rate</h3>
                <p className="text-3xl font-bold text-green-600">{testAnalytics.passRate?.toFixed(1) || 0}%</p>
              </div>
              <div className="card">
                <h3 className="text-sm font-medium text-gray-500">Avg Trust Score</h3>
                <p className={`text-3xl font-bold ${getTrustScoreColor(testAnalytics.averageTrustScore || 0)}`}>
                  {testAnalytics.averageTrustScore?.toFixed(0) || 0}%
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-blue-100 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">AI Performance Summary</h2>
                  <p className="text-sm text-slate-500">Generated from score, difficulty, and proctoring signals.</p>
                </div>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">Live insights</span>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {insightCards.map((insight) => (
                  <div key={insight.label} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-900">{insight.label}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{insight.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Score Statistics */}
            <div className="card">
              <h2 className="text-lg font-semibold mb-4">Score Statistics</h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">Highest</p>
                  <p className="text-xl font-bold text-green-600">{testAnalytics.highestScore?.toFixed(1) || 0}</p>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">Median</p>
                  <p className="text-xl font-bold text-gray-800">{testAnalytics.medianScore?.toFixed(1) || 0}</p>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">Average</p>
                  <p className="text-xl font-bold text-primary-600">{testAnalytics.averageScore?.toFixed(1) || 0}</p>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">Lowest</p>
                  <p className="text-xl font-bold text-red-600">{testAnalytics.lowestScore?.toFixed(1) || 0}</p>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">Flagged</p>
                  <p className="text-xl font-bold text-orange-600">{testAnalytics.flaggedAttempts || 0}</p>
                </div>
              </div>
            </div>

            {/* Score Distribution Chart */}
            <div className="card">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Score Distribution</h2>
                <span className="text-sm text-slate-500">{testAnalytics.totalAttempts} attempt{testAnalytics.totalAttempts === 1 ? '' : 's'}</span>
              </div>
              <BarChart
                items={scoreDistributionItems.length > 0 ? scoreDistributionItems : [{ label: '0-9', value: 0, sublabel: '0 candidates', colorClass: 'bg-blue-600' }]}
                emptyMessage="No scored submissions are available for distribution yet."
              />
            </div>
          </div>
        )}

        {/* Difficulty Analysis Tab */}
        {activeTab === 'difficulty' && difficultyAnalysis && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {(['easy', 'medium', 'hard'] as const).map(level => {
                const data = difficultyAnalysis[level];
                const colors = {
                  easy: 'bg-green-500',
                  medium: 'bg-yellow-500',
                  hard: 'bg-red-500',
                };
                return (
                  <div key={level} className="card">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold capitalize">{level}</h3>
                      <span className={`w-3 h-3 rounded-full ${colors[level]}`} />
                    </div>
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-500">Average Accuracy</span>
                          <span className="font-medium">{data.avgAccuracy.toFixed(1)}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${colors[level]}`}
                            style={{ width: `${data.avgAccuracy}%` }}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-gray-500">Total Correct</p>
                          <p className="font-semibold text-lg">{data.totalCorrect}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Total Questions</p>
                          <p className="font-semibold text-lg">{data.totalQuestions}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="card">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold">Difficulty Comparison</h3>
                <span className="text-sm text-slate-500">{difficultyAnalysis.totalAttempts} analyzed attempt{difficultyAnalysis.totalAttempts === 1 ? '' : 's'}</span>
              </div>
              <BarChart
                items={difficultyItems.map((item) => ({
                  ...item,
                  sublabel: `${item.value.toFixed(1)}% - ${item.sublabel}`,
                }))}
                emptyMessage="Difficulty data exists, but no correct answers have been recorded yet."
              />
            </div>
          </div>
        )}

        {/* Topics Tab */}
        {activeTab === 'topics' && (
          <div className="card space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Topic-wise Performance</h2>
              <p className="text-sm text-slate-500">Accuracy by topic across submitted attempts.</p>
            </div>
            {topicAnalysis.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No topic data available</p>
            ) : (
              <HorizontalMetricChart
                items={topicItems}
                emptyMessage="Topic analytics are available, but no correct answers have been recorded yet."
              />
            )}
          </div>
        )}

        {/* Skills Tab */}
        {activeTab === 'skills' && (
          <div className="card space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Skill-wise Performance</h2>
              <p className="text-sm text-slate-500">Accuracy by tags and skills detected from question metadata.</p>
            </div>
            {skillAnalysis.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No skill data available</p>
            ) : (
              <HorizontalMetricChart
                items={skillItems}
                emptyMessage="Skill analytics are available, but no correct answers have been recorded yet."
              />
            )}
          </div>
        )}

        {/* Comparison Tab */}
        {activeTab === 'comparison' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="card flex flex-wrap gap-4 items-center">
              <select
                value={scoreFilter}
                onChange={(e) => setScoreFilter(e.target.value as typeof scoreFilter)}
                className="input"
              >
                <option value="all">All Scores</option>
                <option value="high">High (70%+)</option>
                <option value="medium">Medium (40-70%)</option>
                <option value="low">Low (&lt;40%)</option>
              </select>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="input"
              >
                <option value="score">Sort by Score</option>
                <option value="percentile">Sort by Percentile</option>
                <option value="trustScore">Sort by Trust Score</option>
              </select>

              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as typeof sortOrder)}
                className="input"
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showFlaggedOnly}
                  onChange={(e) => setShowFlaggedOnly(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">Flagged only</span>
              </label>

              <span className="text-sm text-gray-500 ml-auto">
                Showing {filteredComparison.length} of {comparison.length} candidates
              </span>
            </div>

            <div className="card">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Candidate Score Comparison</h2>
                  <p className="text-sm text-slate-500">Top visible candidates based on the current filters.</p>
                </div>
              </div>
              <BarChart
                items={comparisonChartItems.length > 0 ? comparisonChartItems : [{ label: 'No candidates', value: 0, sublabel: '0% score', colorClass: 'bg-slate-400' }]}
                emptyMessage="No candidate scores match the selected filters."
              />
            </div>

            {/* Comparison Table */}
            <div className="card overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Rank</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Candidate</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Score</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Grade</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Percentile</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Trust</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Difficulty</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredComparison.map((candidate, index) => (
                    <tr key={candidate.candidateId} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4 font-medium">#{index + 1}</td>
                      <td className="py-3 px-4">
                        <p className="font-medium">{candidate.candidateName}</p>
                        <p className="text-xs text-gray-500">{candidate.candidateEmail}</p>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-bold">{candidate.score?.toFixed(1)}</span>
                        <span className="text-gray-500 text-sm ml-1">({candidate.percentage?.toFixed(0)}%)</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded text-sm font-medium ${getGradeColor(candidate.grade)}`}>
                          {candidate.grade || 'N/A'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {candidate.percentile ? `${candidate.percentile}%` : 'N/A'}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`font-medium ${getTrustScoreColor(candidate.trustScore || 0)}`}>
                          {candidate.trustScore?.toFixed(0) || 'N/A'}%
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {candidate.difficultyAccuracy ? (
                          <div className="flex gap-1">
                            <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                              E:{candidate.difficultyAccuracy.easy?.toFixed(0)}%
                            </span>
                            <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">
                              M:{candidate.difficultyAccuracy.medium?.toFixed(0)}%
                            </span>
                            <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                              H:{candidate.difficultyAccuracy.hard?.toFixed(0)}%
                            </span>
                          </div>
                        ) : 'N/A'}
                      </td>
                      <td className="py-3 px-4">
                        {candidate.isFlagged && (
                          <span className="badge badge-error">Flagged</span>
                        )}
                        {candidate.violations > 0 && (
                          <span className="text-xs text-orange-600 ml-1">
                            {candidate.violations} violations
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filteredComparison.length === 0 && (
                <p className="text-gray-500 text-center py-8">No candidates match the filters</p>
              )}
            </div>
          </div>
        )}
    </div>
  );
}
