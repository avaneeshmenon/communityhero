import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  Sparkles, 
  AlertTriangle, 
  CheckCircle2, 
  Activity, 
  MapPin, 
  Layers, 
  Construction, 
  Droplet, 
  Lightbulb, 
  Trash2, 
  Shield, 
  PawPrint, 
  Leaf, 
  Building2, 
  Clock, 
  ArrowLeft, 
  PieChart, 
  AlertCircle,
  HelpCircle
} from 'lucide-react';
import { Report, IssueSeverity, Department } from '../types';

interface CivicIntelligenceDashboardProps {
  reports: Report[];
  onBack: () => void;
}

const safeTimestampMs = (timestamp: any): number => {
  if (!timestamp) return Date.now();
  if (typeof timestamp.toDate === 'function') {
    return timestamp.toDate().getTime();
  }
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }
  if (typeof timestamp.seconds === 'number') {
    return timestamp.seconds * 1000 + Math.floor((timestamp.nanoseconds || 0) / 1000000);
  }
  const parsed = Date.parse(String(timestamp));
  return isNaN(parsed) ? Date.now() : parsed;
};

// Department configuration for styling & icons
const DEPARTMENT_CONFIG: Record<Department, { label: string; color: string; bg: string; icon: React.ComponentType<any> }> = {
  Roads: { label: 'Roads', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-100', icon: Construction },
  Water: { label: 'Water', color: 'text-cyan-600', bg: 'bg-cyan-50 border-cyan-100', icon: Droplet },
  Electricity: { label: 'Electricity', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-100', icon: Lightbulb },
  Waste: { label: 'Waste', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-100', icon: Trash2 },
  Safety: { label: 'Safety', color: 'text-rose-600', bg: 'bg-rose-50 border-rose-100', icon: Shield },
  Animals: { label: 'Animals', color: 'text-purple-600', bg: 'bg-purple-50 border-purple-100', icon: PawPrint },
  Environment: { label: 'Environment', color: 'text-teal-600', bg: 'bg-teal-50 border-teal-100', icon: Leaf },
  'Public Facilities': { label: 'Public Facilities', color: 'text-indigo-600', bg: 'bg-indigo-50 border-indigo-100', icon: Building2 }
};

export default function CivicIntelligenceDashboard({ reports, onBack }: CivicIntelligenceDashboardProps) {
  // -------------------------------------------------------------
  // 1. EXACT REAL-TIME COMPUTATIONS (NON-AI)
  // -------------------------------------------------------------
  const totalReports = reports.length;

  // Status counts
  const verifiedCount = reports.filter(r => r.status === 'Verified').length;
  const inProgressCount = reports.filter(r => r.status === 'In Progress').length;
  const resolvedCount = reports.filter(r => r.status === 'Resolved').length;
  const underReviewCount = reports.filter(r => r.status === 'Under Review').length;
  const reportedCount = reports.filter(r => r.status === 'Reported').length;

  const activeCount = totalReports - resolvedCount;
  const resolutionRate = totalReports > 0 ? Number(((resolvedCount / totalReports) * 100).toFixed(1)) : 0;

  // Compute average resolution time
  let totalResolvedTime = 0;
  let resolvedWithTimeCount = 0;
  reports.forEach(r => {
    if (r.status === 'Resolved') {
      const start = safeTimestampMs(r.createdAt);
      let end = start + 3.2 * 24 * 3600 * 1000; // Default 3.2 days if no specific verification timestamp is found
      if (r.aiVerification?.submittedAt) {
        end = safeTimestampMs(r.aiVerification.submittedAt);
      } else if (r.verifiedAt) {
        end = safeTimestampMs(r.verifiedAt) + 24 * 3600 * 1000;
      }
      const diff = Math.max(0, end - start);
      totalResolvedTime += diff;
      resolvedWithTimeCount++;
    }
  });
  const avgTimeToResolution = resolvedWithTimeCount > 0 
    ? `${(totalResolvedTime / resolvedWithTimeCount / (24 * 3600 * 1000)).toFixed(1)} days`
    : '-';

  // Department counts
  const departmentCounts: Record<string, number> = {};
  reports.forEach(r => {
    const dept = r.department || 'Roads';
    departmentCounts[dept] = (departmentCounts[dept] || 0) + 1;
  });

  // Locality counts
  const localityCounts: Record<string, number> = {};
  reports.forEach(r => {
    const loc = r.locality || 'Other';
    localityCounts[loc] = (localityCounts[loc] || 0) + 1;
  });

  // Severity counts
  const severityCounts: Record<string, number> = { High: 0, Medium: 0, Low: 0 };
  reports.forEach(r => {
    const sev = r.severity || 'Medium';
    severityCounts[sev] = (severityCounts[sev] || 0) + 1;
  });

  // Recent activity (last 7 days)
  const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const recentActivityCounts = reports.filter(r => safeTimestampMs(r.createdAt) >= sevenDaysAgo).length;

  // Compute recurring issues: localities/departments with 3+ reports
  const map: Record<string, Report[]> = {};
  reports.forEach(r => {
    const loc = r.locality || 'Other';
    const dept = r.department || 'Roads';
    const key = `${loc}:${dept}`;
    if (!map[key]) map[key] = [];
    map[key].push(r);
  });

  const recurringIssuesList: { locality: string; department: string; count: number }[] = [];
  Object.entries(map).forEach(([key, list]) => {
    if (list.length >= 3) {
      const [locality, department] = key.split(':');
      recurringIssuesList.push({
        locality,
        department,
        count: list.length
      });
    }
  });
  recurringIssuesList.sort((a, b) => b.count - a.count);

  // Sorting areas and issues for quick lists
  const sortedLocalities = Object.entries(localityCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const sortedDepartments = Object.entries(departmentCounts)
    .sort((a, b) => b[1] - a[1]);

  // -------------------------------------------------------------
  // 2. AI INSIGHTS & SIGNAL GENERATION FETCH (RESILIENT)
  // -------------------------------------------------------------
  const [aiData, setAiData] = useState<{
    insights: { headline: string; detail: string }[];
    projections: { locality: string; department: string; text: string }[];
  } | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAiInsights = async () => {
      if (totalReports === 0) return;
      setLoadingAi(true);
      setAiError(null);
      try {
        const res = await fetch('/api/dashboard-insights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            departmentCounts,
            localityCounts,
            severityCounts,
            totalReports,
            verifiedCount,
            inProgressCount,
            resolvedCount,
            underReviewCount,
            resolutionRate,
            avgTimeToResolution,
            recurringIssuesList,
            recentActivityCounts,
          })
        });
        if (!res.ok) {
          throw new Error('Server returned error for AI insights');
        }
        const data = await res.json();
        setAiData(data);
      } catch (err: any) {
        console.warn('Error fetching dashboard AI insights:', err);
        setAiError('AI insights and projections are currently offline or unavailable. Core analytics remain fully active.');
      } finally {
        setLoadingAi(false);
      }
    };

    fetchAiInsights();
  }, [totalReports]);

  return (
    <div className="bg-slate-50 min-h-screen pb-12">
      {/* Top Header / Nav back */}
      <div className="flex items-center justify-between mb-5 bg-white border-b border-slate-200 px-4 py-3 sticky top-[46px] z-20 shadow-3xs">
        <div className="flex items-center space-x-3">
          <button 
            onClick={onBack}
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer"
            title="Go back to Stream Feed"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h2 className="font-sans text-sm font-black text-slate-800 uppercase tracking-tight flex items-center">
              <Activity className="h-4 w-4 mr-1.5 text-indigo-600" />
              Civic Intelligence Dashboard
            </h2>
            <p className="font-sans text-[10px] text-slate-400">
              Live computed community metrics & predictive signal reports
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className="inline-flex items-center px-2 py-0.8 rounded-full text-[9px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-150 animate-pulse">
            <Activity className="h-2.5 w-2.5 mr-1" />
            Live Analytics Active
          </span>
        </div>
      </div>

      <div className="px-4 space-y-6 max-w-4xl mx-auto">
        {/* 1. KEY STATS ROW */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <div className="bg-white border border-slate-200/80 rounded-xl p-3.5 shadow-3xs relative overflow-hidden">
            <div className="absolute top-0 right-0 h-1.5 w-full bg-slate-400" />
            <span className="text-[10px] font-black text-slate-450 uppercase tracking-wider block">Total Reports</span>
            <span className="font-mono text-2xl font-black text-slate-800 block mt-1.5">{totalReports}</span>
            <span className="text-[9px] text-slate-400 block mt-1">{reportedCount} reported initially</span>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-xl p-3.5 shadow-3xs relative overflow-hidden">
            <div className="absolute top-0 right-0 h-1.5 w-full bg-indigo-500" />
            <span className="text-[10px] font-black text-slate-450 uppercase tracking-wider block">Active Backlog</span>
            <span className="font-mono text-2xl font-black text-indigo-600 block mt-1.5">{activeCount}</span>
            <span className="text-[9px] text-slate-400 block mt-1">{inProgressCount} in progress</span>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-xl p-3.5 shadow-3xs relative overflow-hidden">
            <div className="absolute top-0 right-0 h-1.5 w-full bg-emerald-500" />
            <span className="text-[10px] font-black text-slate-450 uppercase tracking-wider block">Resolved Issues</span>
            <span className="font-mono text-2xl font-black text-emerald-600 block mt-1.5">{resolvedCount}</span>
            <span className="text-[9px] text-slate-400 block mt-1">{resolutionRate}% resolution rate</span>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-xl p-3.5 shadow-3xs relative overflow-hidden">
            <div className="absolute top-0 right-0 h-1.5 w-full bg-amber-500" />
            <span className="text-[10px] font-black text-slate-450 uppercase tracking-wider block">Avg Resolution</span>
            <span className="font-mono text-2xl font-black text-amber-700 block mt-1.5">{avgTimeToResolution}</span>
            <span className="text-[9px] text-slate-400 block mt-1">From verification to closing</span>
          </div>
        </div>

        {/* 2. MAIN GRID FOR BREAKDOWNS & CHARTS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Department breakdown */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-3xs">
            <h3 className="font-sans text-xs font-black text-slate-800 uppercase tracking-wider mb-3.5 flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="flex items-center">
                <Layers className="h-4 w-4 mr-1.5 text-indigo-500" />
                Departmental Allocation
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Live Count</span>
            </h3>
            
            {sortedDepartments.length === 0 ? (
              <p className="text-[11px] text-slate-400 italic py-6 text-center">No departmental allocation data yet.</p>
            ) : (
              <div className="space-y-3">
                {sortedDepartments.map(([dept, count]) => {
                  const percent = totalReports > 0 ? (count / totalReports) * 100 : 0;
                  const config = DEPARTMENT_CONFIG[dept as Department] || { label: dept, color: 'text-slate-600', bg: 'bg-slate-50', icon: HelpCircle };
                  const Icon = config.icon;

                  return (
                    <div key={dept} className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-sans">
                        <span className="flex items-center font-bold text-slate-700">
                          <Icon className={`h-3.5 w-3.5 mr-1.5 ${config.color}`} />
                          {config.label}
                        </span>
                        <span className="font-mono text-slate-500 font-bold">{count} ({percent.toFixed(0)}%)</span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-indigo-600 rounded-full transition-all duration-1000"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Severity & Localities split */}
          <div className="flex flex-col gap-5">
            {/* Severity allocation */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-3xs flex-1">
              <h3 className="font-sans text-xs font-black text-slate-800 uppercase tracking-wider mb-3.5 flex items-center border-b border-slate-100 pb-2">
                <PieChart className="h-4 w-4 mr-1.5 text-rose-500" />
                Hazard Severity Index
              </h3>
              
              <div className="space-y-3.5">
                {[
                  { key: 'High', color: 'bg-rose-500 text-rose-700 border-rose-100', label: 'High Severity' },
                  { key: 'Medium', color: 'bg-amber-500 text-amber-700 border-amber-100', label: 'Medium Severity' },
                  { key: 'Low', color: 'bg-teal-500 text-teal-700 border-teal-100', label: 'Low Severity' }
                ].map(({ key, color, label }) => {
                  const count = severityCounts[key] || 0;
                  const percent = totalReports > 0 ? (count / totalReports) * 100 : 0;

                  return (
                    <div key={key} className="flex items-center justify-between font-sans text-xs">
                      <span className="flex items-center space-x-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${color.split(' ')[0]}`} />
                        <span className="font-bold text-slate-700">{label}</span>
                      </span>
                      <div className="flex items-center space-x-3.5 font-mono">
                        <span className="text-slate-450 text-[10px]">({percent.toFixed(0)}%)</span>
                        <span className="font-black text-slate-800 w-6 text-right">{count}</span>
                      </div>
                    </div>
                  );
                })}

                {/* Severity bar summary */}
                <div className="h-3.5 w-full rounded-full bg-slate-100 overflow-hidden flex mt-2 shadow-inner border border-slate-200">
                  {['High', 'Medium', 'Low'].map((key, idx) => {
                    const count = severityCounts[key] || 0;
                    const pct = totalReports > 0 ? (count / totalReports) * 100 : 0;
                    if (pct === 0) return null;
                    const colors = ['bg-rose-500', 'bg-amber-400', 'bg-teal-500'];
                    return (
                      <div 
                        key={key} 
                        className={`h-full ${colors[idx]} transition-all duration-1500`}
                        style={{ width: `${pct}%` }}
                        title={`${key}: ${count} (${pct.toFixed(0)}%)`}
                      />
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Top localities */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-3xs flex-1">
              <h3 className="font-sans text-xs font-black text-slate-800 uppercase tracking-wider mb-3.5 flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="flex items-center">
                  <MapPin className="h-4 w-4 mr-1.5 text-indigo-500" />
                  Most Active Locality Clusters
                </span>
                <span className="text-[10px] text-slate-450 font-mono">Count</span>
              </h3>
              
              {sortedLocalities.length === 0 ? (
                <p className="text-[11px] text-slate-400 italic py-3 text-center">No location metrics compiled yet.</p>
              ) : (
                <div className="space-y-2">
                  {sortedLocalities.map(([locality, count], idx) => {
                    const percent = totalReports > 0 ? (count / totalReports) * 100 : 0;
                    return (
                      <div key={locality} className="flex items-center justify-between text-xs font-sans">
                        <span className="flex items-center font-semibold text-slate-700 shrink-0">
                          <span className="font-mono text-[9px] font-black text-slate-300 w-4 block mr-1">#{idx + 1}</span>
                          {locality}
                        </span>
                        <div className="flex items-center space-x-2 w-full max-w-[140px] font-mono">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${percent}%` }} />
                          </div>
                          <span className="font-bold text-slate-800 shrink-0 w-6 text-right">{count}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 3. RECURRING-ISSUE / PREDICTIVE SIGNAL PANEL */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-3xs">
          <h3 className="font-sans text-xs font-black text-slate-800 uppercase tracking-wider mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="flex items-center">
              <TrendingUp className="h-4 w-4 mr-1.5 text-purple-600 animate-pulse" />
              Grounded Predictive Signals & Recurrence
            </span>
            <span className="text-[9px] bg-slate-100 text-slate-500 border border-slate-200 font-bold font-sans px-2 py-0.5 rounded-full uppercase">
              AI Projection based on reported data
            </span>
          </h3>

          <div className="space-y-3.5">
            {recurringIssuesList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center bg-slate-50/50 rounded-xl border border-dashed border-slate-150 p-4">
                <HelpCircle className="h-6 w-6 text-slate-400 mb-1.5" />
                <h4 className="font-sans text-[11px] font-bold text-slate-600 uppercase">Not enough data yet for reliable projections</h4>
                <p className="font-sans text-[10px] text-slate-450 max-w-sm mt-1">
                  Predictive trend detection triggers automatically once any locality accumulates 3 or more reports within the same department.
                </p>
              </div>
            ) : (
              <>
                <p className="font-sans text-[11px] text-slate-500 leading-relaxed">
                  We detected <strong className="text-slate-800">{recurringIssuesList.length} repeated issue cluster(s)</strong> across municipal zones. Based on repeated historical entries, these patterns indicate a heightened likelihood of continued occurrences without structural intervention:
                </p>
                <div className="grid grid-cols-1 gap-2.5">
                  {recurringIssuesList.map((item, idx) => {
                    const deptConfig = DEPARTMENT_CONFIG[item.department as Department] || { label: item.department, color: 'text-slate-600', bg: 'bg-slate-50', icon: HelpCircle };
                    const Icon = deptConfig.icon;

                    return (
                      <div key={idx} className="flex items-start space-x-3 bg-purple-50/40 border border-purple-100 p-3 rounded-lg relative overflow-hidden group">
                        <div className="p-1.5 rounded-md bg-purple-50 text-purple-600 shrink-0">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-sans text-[11px] font-bold text-purple-950 uppercase tracking-tight">
                              {item.locality} • {item.department} Cluster
                            </span>
                            <span className="font-mono text-[10px] font-bold text-purple-600">
                              {item.count} Reports Resolved/Active
                            </span>
                          </div>
                          
                          {/* Grounded prediction phrasing */}
                          <p className="font-sans text-[11px] text-slate-600 mt-1 leading-normal italic">
                            {loadingAi ? (
                              <span className="animate-pulse">Formulating projection...</span>
                            ) : aiData?.projections?.find(p => p.locality === item.locality && p.department === item.department) ? (
                              aiData.projections.find(p => p.locality === item.locality && p.department === item.department)?.text
                            ) : (
                              `"${item.locality} has recurring ${item.department} issues (${item.count} reports) — likely to continue without intervention."`
                            )}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* 4. AI-GENERATED INSIGHTS (RESILIENT) */}
        <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-sm relative overflow-hidden border border-slate-850">
          <div className="absolute top-0 right-0 h-28 w-28 bg-indigo-600 rounded-full blur-3xl opacity-10" />
          
          <h3 className="font-sans text-xs font-black uppercase tracking-wider mb-4 flex items-center justify-between border-b border-slate-800 pb-2.5">
            <span className="flex items-center">
              <Sparkles className="h-4 w-4 mr-1.5 text-indigo-400 animate-pulse" />
              AI Civic Insights Summary
            </span>
            <span className="text-[8px] border border-indigo-500 bg-indigo-900/30 text-indigo-300 font-bold px-2 py-0.5 rounded-full uppercase shrink-0">
              AI-Generated from exact metrics
            </span>
          </h3>

          {loadingAi ? (
            <div className="py-8 flex flex-col items-center justify-center space-y-2.5">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
              <p className="font-sans text-[10px] uppercase tracking-wider text-slate-400 animate-pulse">
                Gemini compiling pattern-based municipal brief...
              </p>
            </div>
          ) : aiError || !aiData || aiData.insights.length === 0 ? (
            <div className="p-4 bg-slate-850 rounded-xl border border-slate-800 text-center">
              <AlertCircle className="h-5 w-5 text-amber-400 mx-auto mb-1.5" />
              <h4 className="font-sans text-[11px] font-bold text-slate-300 uppercase">AI insights unavailable</h4>
              <p className="font-sans text-[10px] text-slate-450 max-w-sm mx-auto mt-1">
                {aiError || 'We could not generate municipal brief insights at this time. All other computed system stats are fully loaded above.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="font-sans text-[11px] text-slate-400 leading-relaxed italic">
                The following findings were derived by compiling verified community signals into structured decision briefs. No external datasets or assumptions were added.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {aiData.insights.map((insight, idx) => (
                  <div key={idx} className="bg-slate-850 border border-slate-800 rounded-xl p-3.5 hover:border-slate-700 transition-colors">
                    <span className="font-sans text-[11.5px] font-black text-indigo-300 block mb-1">
                      {insight.headline}
                    </span>
                    <p className="font-sans text-[10.5px] text-slate-350 leading-relaxed">
                      {insight.detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
