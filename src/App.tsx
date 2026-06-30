import React, { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, query, orderBy, limit, onSnapshot, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, signInWithGoogle, handleFirestoreError, OperationType } from './lib/firebase';
import { Report, IssueSeverity, UserDoc, getUserLevel } from './types';
import { checkShouldEscalate, generateEscalationTrailStep } from './lib/escalationTrailService';
import Header from './components/Header';
import ReportForm from './components/ReportForm';
import ReportCard from './components/ReportCard';
import ReportDetailModal from './components/ReportDetailModal';
import UserProfile from './components/UserProfile';
import InteractiveMap from './components/InteractiveMap';
import CivicIntelligenceDashboard from './components/CivicIntelligenceDashboard';
import { 
  ShieldAlert, 
  MapPin, 
  Layers, 
  CheckCircle2, 
  AlertTriangle, 
  Users, 
  HelpCircle,
  LogIn,
  Search,
  SlidersHorizontal,
  Flame,
  Check,
  Compass,
  Tag,
  Award,
  ChevronRight,
  TrendingUp,
  Droplet,
  Lightbulb,
  Trash2,
  Lock,
  Sparkles,
  Construction,
  Shield,
  PawPrint,
  Leaf,
  Building2,
  Plus,
  X,
  TrendingDown,
  Info,
  Camera,
  FileText,
  ChevronUp,
  RefreshCw
} from 'lucide-react';

// Safe timestamp to milliseconds helper to avoid raw type crashes
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

const getDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const escalatingReportKeys = useRef<Set<string>>(new Set());
  const [currentUserDoc, setCurrentUserDoc] = useState<UserDoc | null>(null);
  
  const [reports, setReports] = useState<Report[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [topContributors, setTopContributors] = useState<UserDoc[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Redesign Filter States
  const [selectedLocality, setSelectedLocality] = useState<string>('All');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedSeverity, setSelectedSeverity] = useState<IssueSeverity | 'All'>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortTab, setSortTab] = useState<'Hot' | 'New' | 'Urgent' | 'Under Review'>('Hot');
  const [userDetectedLocalities, setUserDetectedLocalities] = useState<string[]>([]);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Modal Control
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedProfileUid, setSelectedProfileUid] = useState<string | null>(null);
  const [isExplainerOpen, setIsExplainerOpen] = useState(false);
  
  const [isMapViewActive, setIsMapViewActive] = useState(false);
  const [highlightedMapReportId, setHighlightedMapReportId] = useState<string | null>(null);

  // Dedicated view: 'feed' | 'dashboard'
  const [currentView, setCurrentView] = useState<'feed' | 'dashboard'>(() => {
    if (window.location.pathname === '/dashboard' || window.location.hash === '#/dashboard' || window.location.hash === '#dashboard') {
      return 'dashboard';
    }
    return 'feed';
  });

  useEffect(() => {
    const handlePopState = () => {
      if (window.location.pathname === '/dashboard' || window.location.hash === '#/dashboard' || window.location.hash === '#dashboard') {
        setCurrentView('dashboard');
      } else {
        setCurrentView('feed');
      }
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handlePopState);
    };
  }, []);

  const handleSetView = (view: 'feed' | 'dashboard') => {
    setCurrentView(view);
    if (view === 'dashboard') {
      window.history.pushState(null, '', '#/dashboard');
    } else {
      window.history.pushState(null, '', '#/');
    }
  };

  // 1. Listen for auth changes and register users automatically
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoadingUser(false);
      if (currentUser) {
        import('./lib/badgeService').then(({ evaluateAndAwardBadges }) => {
          evaluateAndAwardBadges(currentUser.uid).catch((err) => {
            console.warn('[App] Failed to evaluate badges on login:', err);
          });
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // Ensure category and locality filters default to 'All' on load/reload once user is signed in
  useEffect(() => {
    if (user) {
      setSelectedCategory('All');
      setSelectedLocality('All');
    }
  }, [user]);

  // Geolocation detection effect on load
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          setUserCoords({ lat, lng });
          try {
            const res = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}`);
            if (res.ok) {
              const data = await res.json();
              if (data.localities && Array.isArray(data.localities)) {
                setUserDetectedLocalities(data.localities);
                if (data.localities.length > 0) {
                  setSelectedLocality(data.localities[0]);
                }
              } else if (data.locality) {
                const fullLoc = data.locality;
                setUserDetectedLocalities([fullLoc]);
                setSelectedLocality(fullLoc);
              }
            }
          } catch (err) {
            console.warn('Error fetching user location reverse-geocode on load:', err);
          }
        },
        (err) => {
          console.warn('Browser geolocation prompt declined or failed on load:', err);
        },
        { timeout: 5000 }
      );
    }
  }, []);

  // Sync URL query params and pathnames with selectedReportId and selectedProfileUid state to enable shareable issue/profile links
  useEffect(() => {
    const parseUrlRoute = () => {
      // 0. Check pathname for /map
      if (window.location.pathname === '/map') {
        setIsMapViewActive(true);
        setSelectedProfileUid(null);
        setSelectedReportId(null);
        
        const params = new URLSearchParams(window.location.search);
        const repId = params.get('reportId');
        if (repId) {
          setHighlightedMapReportId(repId);
        } else {
          setHighlightedMapReportId(null);
        }
        return;
      }

      setIsMapViewActive(false);
      setHighlightedMapReportId(null);

      // 1. Check pathname for /user/{uid}
      const userMatch = window.location.pathname.match(/^\/user\/([a-zA-Z0-9_\-]+)$/);
      if (userMatch) {
        setSelectedProfileUid(userMatch[1]);
        setSelectedReportId(null);
        return;
      }

      // 2. Check pathname for /report/{id}
      const match = window.location.pathname.match(/^\/report\/([a-zA-Z0-9_\-]+)$/);
      if (match) {
        setSelectedReportId(match[1]);
        setSelectedProfileUid(null);
        return;
      }

      // 3. Fall back to search param ?reportId=id
      const params = new URLSearchParams(window.location.search);
      const rId = params.get('reportId');
      if (rId) {
        setSelectedReportId(rId);
        setSelectedProfileUid(null);
        return;
      }

      const pUid = params.get('userUid');
      if (pUid) {
        setSelectedProfileUid(pUid);
        setSelectedReportId(null);
        return;
      }

      // 4. Otherwise, clear everything
      setSelectedReportId(null);
      setSelectedProfileUid(null);
    };

    // Parse on startup
    parseUrlRoute();

    const handlePopState = () => {
      parseUrlRoute();
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleSelectReport = (id: string) => {
    setSelectedReportId(id);
    const hash = window.location.hash;
    window.history.pushState({}, '', `/report/${id}${hash}`);
  };

  const handleCloseReportDetail = () => {
    setSelectedReportId(null);
    window.history.pushState({}, '', selectedProfileUid ? `/user/${selectedProfileUid}` : '/');
  };

  const handleSelectProfile = (uid: string) => {
    setSelectedProfileUid(uid);
    setSelectedReportId(null);
    window.history.pushState({}, '', `/user/${uid}`);
  };

  const handleCloseProfile = () => {
    setSelectedProfileUid(null);
    window.history.pushState({}, '', '/');
  };

  // 2. Sync user profile changes (Impact Points, etc.) in Real-time from Firestore
  useEffect(() => {
    if (!user) {
      setCurrentUserDoc(null);
      return;
    }
    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
        setCurrentUserDoc(snapshot.data() as UserDoc);
      } else {
        // Register new user on first-sign-in automatically
        const initProfile = {
          uid: user.uid,
          displayName: user.displayName || 'Civic Participant',
          photoURL: user.photoURL || '',
          email: user.email || '',
          impactPoints: 0,
          reportsCount: 0,
          verificationsGiven: 0,
          joinedAt: serverTimestamp()
        };
        setDoc(userRef, initProfile).then(() => {
          setCurrentUserDoc(initProfile as unknown as UserDoc);
        }).catch((err) => {
          console.error('Failed to auto register user profile doc:', err);
        });
      }
    });

    return () => unsubscribe();
  }, [user]);

  // 3. Keep leaderboard Sync live
  useEffect(() => {
    if (!user) {
      setTopContributors([]);
      return;
    }
    const qUsers = query(collection(db, 'users'), orderBy('impactPoints', 'desc'), limit(5));
    const unsubscribe = onSnapshot(qUsers, (snap) => {
      const list: UserDoc[] = [];
      snap.forEach((d) => {
        list.push({
          uid: d.id,
          ...d.data()
        } as UserDoc);
      });
      setTopContributors(list);
    });

    return () => unsubscribe();
  }, [user]);

  // 4. Query global report stream in real-time
  useEffect(() => {
    if (!user) {
      setReports([]);
      return;
    }

    setLoadingReports(true);
    setErrorMsg(null);

    const q = query(collection(db, 'reports'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const reportsList: Report[] = [];
        snapshot.forEach((docSnap) => {
          reportsList.push({
            id: docSnap.id,
            ...docSnap.data(),
          } as Report);
        });
        setReports(reportsList);
        setLoadingReports(false);
      },
      (error) => {
        console.error('Snapshot stream error:', error);
        setErrorMsg('Ensure rules are deployed and internet connection is accurate.');
        setLoadingReports(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // Background Automatic Escalation Engine (checks reports periodically)
  useEffect(() => {
    if (reports.length === 0) return;

    const interval = setInterval(async () => {
      for (const report of reports) {
        const checkResult = checkShouldEscalate(report);
        if (checkResult.shouldEscalate) {
          const guardKey = `${report.id}_${checkResult.nextLevel}`;
          if (escalatingReportKeys.current.has(guardKey)) {
            continue;
          }

          escalatingReportKeys.current.add(guardKey);
          console.log(`[Auto Escalation] Triggering escalation for "${report.title}" to Stage ${checkResult.nextLevel}`);
          try {
            await generateEscalationTrailStep(report, checkResult.nextLevel, user?.uid || 'auto-system');
            console.log(`[Auto Escalation] Successfully escalated "${report.title}" to Stage ${checkResult.nextLevel}`);
          } catch (err) {
            console.error(`[Auto Escalation] Failed to escalate "${report.title}":`, err);
          }
        }
      }
    }, 15000); // Check every 15 seconds

    return () => clearInterval(interval);
  }, [reports, user]);

  // Quick Client-side filter pipeline
  const filteredReports = reports.filter((report) => {
    // If we are on the 'Under Review' tab, only show under review posts
    if (sortTab === 'Under Review') {
      const isUnderReview = report.status === 'Under Review' || report.underReview;
      if (!isUnderReview) {
        return false;
      }
    }

    const matchLocality = selectedLocality === 'All' || selectedLocality === 'All areas' || selectedLocality === 'All Areas' || (report.locality && report.locality.toLowerCase() === selectedLocality.toLowerCase());
    const matchCat = selectedCategory === 'All' || report.department === selectedCategory;
    const matchSev = selectedSeverity === 'All' || report.severity === selectedSeverity;
    
    const term = searchQuery.toLowerCase().trim();
    const matchSearch = 
      term === '' || 
      report.title.toLowerCase().includes(term) || 
      report.description.toLowerCase().includes(term) || 
      report.locationText.toLowerCase().includes(term);

    // NEW tab filter: only show reports created in the last 48 hours (2 days)
    if (sortTab === 'New') {
      const timeMs = safeTimestampMs(report.createdAt);
      const hoursAgo = (Date.now() - timeMs) / (1000 * 60 * 60);
      if (hoursAgo > 48) {
        return false;
      }
    }

    return matchLocality && matchCat && matchSev && matchSearch;
  });

  // Client-side gamified sorting tab algorithm
  const sortedReports = [...filteredReports].sort((a, b) => {
    // Demote flagged posts in all tabs except 'Under Review'
    if (sortTab !== 'Under Review') {
      const isUnderReviewA = a.status === 'Under Review' || a.underReview;
      const isUnderReviewB = b.status === 'Under Review' || b.underReview;
      if (isUnderReviewA !== isUnderReviewB) {
        return isUnderReviewA ? 1 : -1;
      }

      // Bubble up highly escalated reports in all tabs except Under Review
      const escA = a.authorityActions?.length ? Math.max(...a.authorityActions.map(act => act.stage)) : 0;
      const escB = b.authorityActions?.length ? Math.max(...b.authorityActions.map(act => act.stage)) : 0;
      if (escA !== escB) {
        return escB - escA; // Higher escalation stages go first
      }
    } else {
      // In Under Review tab, sort by flagCount descending, then by date descending
      const flagsA = a.flagCount || 0;
      const flagsB = b.flagCount || 0;
      if (flagsA !== flagsB) return flagsB - flagsA;

      const timeA = safeTimestampMs(a.createdAt);
      const timeB = safeTimestampMs(b.createdAt);
      return timeB - timeA;
    }

    if (sortTab === 'New') {
      const timeA = safeTimestampMs(a.createdAt);
      const timeB = safeTimestampMs(b.createdAt);
      return timeB - timeA;
    }
    if (sortTab === 'Urgent') {
      const severityWeight = (s: string) => s === 'High' ? 3 : s === 'Medium' ? 2 : 1;
      const scoreA = severityWeight(a.severity);
      const scoreB = severityWeight(b.severity);
      if (scoreA !== scoreB) return scoreB - scoreA;
      
      const countA = a.verificationCount || 0;
      const countB = b.verificationCount || 0;
      if (countA !== countB) return countB - countA;

      return (b.priorityScore || 0) - (a.priorityScore || 0);
    }
    
    // Default Tab Hot Scoring Algorithm: Weight verificationCount down by post age (hours) so old posts fade
    const hotScore = (r: Report) => {
      const timeMs = safeTimestampMs(r.createdAt);
      const hoursAgo = Math.max(1, (Date.now() - timeMs) / (1000 * 60 * 60));
      let baseScore = (r.verificationCount || 0) / Math.pow(hoursAgo + 2, 1.2);
      
      // Additional boost for escalated reports
      const rEsc = r.authorityActions?.length ? Math.max(...r.authorityActions.map(act => act.stage)) : 0;
      if (rEsc > 0) {
        baseScore += rEsc * 5;
      }
      return baseScore;
    };
    return hotScore(b) - hotScore(a);
  });

  // Get all unique localities from reports
  const uniqueReportLocalities: string[] = Array.from(
    new Set<string>(
      reports
        .map((r) => r.locality)
        .filter((loc): loc is string => typeof loc === 'string' && loc.trim().length > 0)
    )
  );

  const COLORS = [
    'bg-indigo-500',
    'bg-amber-500',
    'bg-rose-500',
    'bg-teal-500',
    'bg-purple-500',
    'bg-emerald-500',
    'bg-sky-500',
    'bg-pink-500',
  ];

  const isValidLocality = (name: string) => {
    if (!name) return false;
    const trimmed = name.trim();
    if (trimmed.toLowerCase() === 'other') return false; // Filter "Other" as we explicitly append it at the end
    if (trimmed.length < 3 || trimmed.length > 40) return false;
    const lower = trimmed.toLowerCase();
    const badKeywords = [
      'river', 'basin', 'valley', 'district', 'subdivision', 'state', 'country', 
      'province', 'republic', 'continent', 'division', 'region', 'zone', 
      'county', 'municipality', 'governorate', 'prefecture', 'department',
      'taluka', 'tehsil', 'taluk', 'mandal', 'subdistrict', 'sub-district', 
      'municipal', 'corporation', 'administrative', 'union territory', 
      'cantonment', 'national park', 'lake', 'bay', 'ocean', 'sea', 'india', 
      'maharashtra', 'kerala', 'pune', 'bengaluru', 'mumbai', 'delhi', 'chennai', 
      'kolkata', 'karnataka', 'tamil nadu', 'gujarat', 'rajasthan', 'punjab', 
      'goa', 'bihar', 'assam', 'haryana', 'himachal', 'jharkhand', 'manipur', 
      'meghalaya', 'mizoram', 'nagaland', 'odisha', 'sikkim', 'tripura', 
      'uttarakhand', 'telangana', 'andhra', 'ladakh', 'jammu', 'kashmir', 'lakshadweep',
      'puducherry', 'chandigarh', 'dadra', 'nagar haveli', 'daman', 'diu', 'western zonal'
    ];
    if (badKeywords.some(kw => lower.includes(kw) || kw.includes(lower))) return false;
    if (/\d/.test(lower)) return false; // reject if has digits
    return true;
  };

  // Determine user's primary geolocated locality
  const userLocality = userDetectedLocalities && userDetectedLocalities.length > 0
    ? userDetectedLocalities.find(loc => isValidLocality(loc))
    : null;

  // Known coordinates for standard default local areas in Pune
  const DEFAULT_LOCALITY_COORDS: { [key: string]: { lat: number; lng: number } } = {
    'bavdhan': { lat: 18.5080, lng: 73.7845 },
    'kothrud': { lat: 18.5074, lng: 73.8077 },
    'pashan': { lat: 18.5372, lng: 73.7934 },
    'baner': { lat: 18.5590, lng: 73.7787 },
    'aundh': { lat: 18.5580, lng: 73.8075 },
    'wakad': { lat: 18.5987, lng: 73.7689 }
  };

  // Helper to find a location's representative coordinates
  const getLocalityCoords = (loc: string): { lat: number; lng: number } | null => {
    const lower = loc.toLowerCase();
    if (DEFAULT_LOCALITY_COORDS[lower]) {
      return DEFAULT_LOCALITY_COORDS[lower];
    }
    // Find first report with coordinates
    const rep = reports.find(
      (r) => r.locality && r.locality.toLowerCase() === lower && typeof r.lat === 'number' && typeof r.lng === 'number'
    );
    if (rep && rep.lat !== null && rep.lng !== null) {
      return { lat: rep.lat, lng: rep.lng };
    }
    return null;
  };

  const fallbackDefaults = ['Bavdhan', 'Kothrud', 'Aundh', 'Baner', 'Pashan', 'Wakad'];
  const nearLocalitiesList: string[] = [];
  const mergedLowerSet = new Set<string>();

  // 1. If we have user geolocated/detected localities, prioritize them!
  if (userDetectedLocalities && userDetectedLocalities.length > 0) {
    userDetectedLocalities.forEach(loc => {
      if (isValidLocality(loc)) {
        const lower = loc.toLowerCase().trim();
        if (!mergedLowerSet.has(lower)) {
          nearLocalitiesList.push(loc);
          mergedLowerSet.add(lower);
        }
      }
    });
  }

  // 2. Also include any report localities that are strictly within 15 km of the user's current GPS location
  if (userCoords) {
    uniqueReportLocalities.forEach(loc => {
      if (isValidLocality(loc)) {
        const lower = loc.toLowerCase().trim();
        if (!mergedLowerSet.has(lower)) {
          const coords = getLocalityCoords(loc);
          if (coords) {
            const dist = getDistanceKm(userCoords.lat, userCoords.lng, coords.lat, coords.lng);
            if (dist <= 15) {
              nearLocalitiesList.push(loc);
              mergedLowerSet.add(lower);
            }
          }
        }
      }
    });
  } else {
    // If no coordinates yet (denied or loading), include unique report localities & Pune defaults
    const candidateLocalities = Array.from(new Set([
      ...uniqueReportLocalities,
      ...fallbackDefaults
    ]));
    candidateLocalities.forEach(loc => {
      if (isValidLocality(loc)) {
        const lower = loc.toLowerCase().trim();
        if (!mergedLowerSet.has(lower)) {
          nearLocalitiesList.push(loc);
          mergedLowerSet.add(lower);
        }
      }
    });
  }

  // 3. Fallback: If still absolutely empty, load Pune defaults
  if (nearLocalitiesList.length === 0) {
    fallbackDefaults.forEach(loc => {
      if (isValidLocality(loc)) {
        const lower = loc.toLowerCase().trim();
        if (!mergedLowerSet.has(lower)) {
          nearLocalitiesList.push(loc);
          mergedLowerSet.add(lower);
        }
      }
    });
  }

  // Cap at 8 entries to keep UI clean and consistent
  const nearLocalities = nearLocalitiesList.slice(0, 8);

  // Filter nearLocalities to ensure no "Other" is in there (we will append it cleanly at the end)
  const filteredNearLocalities = nearLocalities.filter(l => l.toLowerCase() !== 'other');

  // Compute sidebarLocalities with colors
  const sidebarLocalities: { name: string; color: string }[] = [{ name: 'All', color: 'bg-slate-300' }];
  let colorIdx = 0;
  filteredNearLocalities.forEach((loc) => {
    sidebarLocalities.push({
      name: loc,
      color: COLORS[colorIdx++ % COLORS.length]
    });
  });

  // Always append "Other" exactly once at the end
  sidebarLocalities.push({
    name: 'Other',
    color: 'bg-slate-400'
  });

  // Metrical numbers inside right dashboard
  const totalReported = reports.length;
  const inProgressIssues = reports.filter(r => r.status === 'In Progress').length;
  const resolvedIssues = reports.filter(r => r.status === 'Resolved').length;
  const verifiedIssues = reports.reduce((acc, r) => acc + (r.verificationCount || 0), 0);

  // Trending widgets (Top 3 most verified occurrences) - EXCLUDING RESOLVED REPORTS
  const trendingIssues = reports
    .filter(r => r.status !== 'Resolved')
    .sort((a, b) => (b.verificationCount || 0) - (a.verificationCount || 0))
    .slice(0, 3);

  const triggerGoogleLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (err) {
      console.error('Google Sign-in failed:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/60 font-sans text-slate-800 antialiased selection:bg-indigo-100 selection:text-indigo-900 transition-colors">
      
      {/* Sticky High-contrast Top Bar (46px) */}
      <Header 
        user={user} 
        loading={loadingUser} 
        currentUserDoc={currentUserDoc}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        sortTab={sortTab}
        setSortTab={setSortTab}
        onPlusReportClick={() => setIsComposerOpen(true)}
        reports={reports}
        onUserClick={handleSelectProfile}
        onImpactPillClick={() => setIsExplainerOpen(true)}
        currentView={currentView}
        onViewChange={handleSetView}
        onSelectReport={handleSelectReport}
      />

      {/* Main Responsive Grid Layout Container */}
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        
        {loadingUser ? (
          <div className="flex h-[70vh] flex-col items-center justify-center space-y-3">
            <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent"></div>
            <p className="font-sans text-[11px] font-bold text-slate-400 uppercase tracking-widest animate-pulse">
              Authenticating credentials...
            </p>
          </div>
        ) : !user ? (
          
          /* Designed Landing Greeting page for guest users */
          <div className="mx-auto max-w-5xl py-12 md:py-20 animate-fade-in">
            {/* HERO SECTION */}
            <div className="text-center">
              <div className="flex justify-center">
                <span className="inline-flex items-center space-x-1.5 rounded-full bg-indigo-50 px-3.5 py-1 text-[11px] font-bold text-indigo-850 border border-indigo-100/80 shadow-3xs">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-600 animate-pulse" />
                  <span>AI-Assisted Civic Transparency & Action</span>
                </span>
              </div>

              <h1 className="mt-6 font-sans text-3xl font-black tracking-tight text-slate-900 sm:text-5xl md:text-6xl leading-tight">
                Bridge the Gap. <br />
                Be the <span className="text-indigo-600">Community Hero.</span>
              </h1>

              <p className="mx-auto mt-6 max-w-2xl font-sans text-xs sm:text-sm md:text-base leading-relaxed text-slate-600 font-medium">
                Report local issues with a photo, let AI handle the rest. Community Hero uses AI to categorize, 
                verify, and escalate civic problems — drafting formal complaints and tracking them up 
                the authority chain until they're resolved.
              </p>

              <div className="mt-8 flex flex-col items-center justify-center space-y-3">
                <button
                  onClick={triggerGoogleLogin}
                  className="inline-flex items-center space-x-2.5 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white px-7 py-3.5 font-sans text-xs sm:text-sm font-bold shadow-md hover:shadow-lg hover:translate-y-[-1px] active:translate-y-0 transition-all cursor-pointer"
                >
                  <LogIn className="h-4 w-4" />
                  <span>Sign In with Google</span>
                </button>
                <p className="text-[10px] font-semibold text-slate-400 tracking-wider uppercase">
                  Built on Google AI Studio, Gemini & Firebase
                </p>
              </div>
            </div>

            {/* HOW IT WORKS PIPELINE */}
            <div className="mt-24">
              <div className="text-center mb-12">
                <h2 className="font-sans text-xs font-black tracking-widest text-indigo-600 uppercase">
                  End-to-End Loop
                </h2>
                <p className="mt-2 font-sans text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                  How Community Hero Works
                </p>
              </div>

              <div className="grid gap-6 md:grid-cols-5 relative">
                {/* Step 1 */}
                <div className="relative flex flex-col bg-white border border-slate-100 rounded-2xl p-5 shadow-3xs hover:shadow-2xs transition-all hover:translate-y-[-2px]">
                  <div className="absolute top-4 right-4 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 font-sans text-xs font-black text-indigo-700">
                    1
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <Camera className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 font-sans text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Snap & Report
                  </h3>
                  <p className="mt-2 font-sans text-[11px] text-slate-500 leading-normal">
                    Take a photo; Gemini Vision auto-detects the issue type, severity, and writes the report for you.
                  </p>
                </div>

                {/* Step 2 */}
                <div className="relative flex flex-col bg-white border border-slate-100 rounded-2xl p-5 shadow-3xs hover:shadow-2xs transition-all hover:translate-y-[-2px]">
                  <div className="absolute top-4 right-4 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 font-sans text-xs font-black text-indigo-700">
                    2
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                    <Users className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 font-sans text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Community Verifies
                  </h3>
                  <p className="mt-2 font-sans text-[11px] text-slate-500 leading-normal">
                    Neighbours upvote to verify. At 3 verifications, an issue is confirmed and promoted automatically.
                  </p>
                </div>

                {/* Step 3 */}
                <div className="relative flex flex-col bg-white border border-slate-100 rounded-2xl p-5 shadow-3xs hover:shadow-2xs transition-all hover:translate-y-[-2px]">
                  <div className="absolute top-4 right-4 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 font-sans text-xs font-black text-indigo-700">
                    3
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                    <FileText className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 font-sans text-xs font-bold text-slate-900 uppercase tracking-wider">
                    AI Files Complaint
                  </h3>
                  <p className="mt-2 font-sans text-[11px] text-slate-500 leading-normal">
                    On verification, an AI agent drafts a formal complaint and routes it to the correct municipal department.
                  </p>
                </div>

                {/* Step 4 */}
                <div className="relative flex flex-col bg-white border border-slate-100 rounded-2xl p-5 shadow-3xs hover:shadow-2xs transition-all hover:translate-y-[-2px]">
                  <div className="absolute top-4 right-4 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 font-sans text-xs font-black text-indigo-700">
                    4
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
                    <ChevronUp className="h-5 w-5 animate-pulse" />
                  </div>
                  <h3 className="mt-5 font-sans text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Escalation Ladder
                  </h3>
                  <p className="mt-2 font-sans text-[11px] text-slate-500 leading-normal">
                    If unresolved, the system escalates up authority chain: Local Authority → Ward Office → Municipal Commissioner.
                  </p>
                </div>

                {/* Step 5 */}
                <div className="relative flex flex-col bg-white border border-slate-100 rounded-2xl p-5 shadow-3xs hover:shadow-2xs transition-all hover:translate-y-[-2px]">
                  <div className="absolute top-4 right-4 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 font-sans text-xs font-black text-indigo-700">
                    5
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 font-sans text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Track to Resolution
                  </h3>
                  <p className="mt-2 font-sans text-[11px] text-slate-500 leading-normal">
                    Transparent status tracking with AI-verified before/after photo proof of the resolution.
                  </p>
                </div>
              </div>
            </div>

            {/* FEATURE HIGHLIGHTS */}
            <div className="mt-24 border-t border-slate-105 pt-20">
              <div className="text-center mb-12">
                <h2 className="font-sans text-xs font-black tracking-widest text-indigo-600 uppercase">
                  Platform Powerhouses
                </h2>
                <p className="mt-2 font-sans text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                  Civic-Tech Feature Highlights
                </p>
              </div>

              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {/* Feature 1 */}
                <div className="bg-white border border-slate-100 rounded-xl p-5 text-left shadow-3xs hover:shadow-2xs transition-all hover:translate-y-[-1px]">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-650">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <h4 className="mt-3 font-sans text-xs font-bold text-slate-900 uppercase tracking-wide">
                    AI Intelligent Intake
                  </h4>
                  <p className="mt-1 font-sans text-[10.5px] text-slate-500 leading-normal font-medium">
                    Gemini Vision processes photos to auto-detect category, hazard severity, and prioritizes urgency.
                  </p>
                </div>

                {/* Feature 2 */}
                <div className="bg-white border border-slate-100 rounded-xl p-5 text-left shadow-3xs hover:shadow-2xs transition-all hover:translate-y-[-1px]">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-655">
                    <FileText className="h-4 w-4" />
                  </div>
                  <h4 className="mt-3 font-sans text-xs font-bold text-slate-900 uppercase tracking-wide">
                    AI Complaint Drafting
                  </h4>
                  <p className="mt-1 font-sans text-[10.5px] text-slate-500 leading-normal font-medium">
                    Generates official drafted letters tailored with relevant laws and department routing guidelines.
                  </p>
                </div>

                {/* Feature 3 */}
                <div className="bg-white border border-slate-100 rounded-xl p-5 text-left shadow-3xs hover:shadow-2xs transition-all hover:translate-y-[-1px]">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-650">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                  <h4 className="mt-3 font-sans text-xs font-bold text-slate-900 uppercase tracking-wide">
                    Automated Escalation
                  </h4>
                  <p className="mt-1 font-sans text-[10.5px] text-slate-500 leading-normal font-medium">
                    Engine escalates complaints up a 3-tier system with chronological authority records if issues persist.
                  </p>
                </div>

                {/* Feature 4 */}
                <div className="bg-white border border-slate-100 rounded-xl p-5 text-left shadow-3xs hover:shadow-2xs transition-all hover:translate-y-[-1px]">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                    <ShieldAlert className="h-4 w-4" />
                  </div>
                  <h4 className="mt-3 font-sans text-xs font-bold text-slate-900 uppercase tracking-wide">
                    Duplicate Detection
                  </h4>
                  <p className="mt-1 font-sans text-[10.5px] text-slate-500 leading-normal font-medium">
                    Intelligently checks and merges overlapping proximity submissions to avoid duplicate departmental logs.
                  </p>
                </div>

                {/* Feature 5 */}
                <div className="bg-white border border-slate-100 rounded-xl p-5 text-left shadow-3xs hover:shadow-2xs transition-all hover:translate-y-[-1px]">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-650">
                    <MapPin className="h-4 w-4" />
                  </div>
                  <h4 className="mt-3 font-sans text-xs font-bold text-slate-900 uppercase tracking-wide">
                    Interactive Issue Map
                  </h4>
                  <p className="mt-1 font-sans text-[10.5px] text-slate-500 leading-normal font-medium">
                    Plot and track categorized alerts on a dynamic geographic map with custom high-contrast pins.
                  </p>
                </div>

                {/* Feature 6 */}
                <div className="bg-white border border-slate-100 rounded-xl p-5 text-left shadow-3xs hover:shadow-2xs transition-all hover:translate-y-[-1px]">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-650">
                    <Award className="h-4 w-4" />
                  </div>
                  <h4 className="mt-3 font-sans text-xs font-bold text-slate-900 uppercase tracking-wide">
                    Civic Impact Points
                  </h4>
                  <p className="mt-1 font-sans text-[10.5px] text-slate-500 leading-normal font-medium">
                    Earn impact and reputation scores for upvoting, verifying, and reporting resolved neighborhood fixes.
                  </p>
                </div>

                {/* Feature 7 */}
                <div className="bg-white border border-slate-100 rounded-xl p-5 text-left shadow-3xs hover:shadow-2xs transition-all hover:translate-y-[-1px]">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-650">
                    <Flame className="h-4 w-4" />
                  </div>
                  <h4 className="mt-3 font-sans text-xs font-bold text-slate-900 uppercase tracking-wide">
                    Achievements Engine
                  </h4>
                  <p className="mt-1 font-sans text-[10.5px] text-slate-500 leading-normal font-medium">
                    Unlock exclusive badges (e.g. Watchdog, Civic Leader, Validator) as your local participation grows.
                  </p>
                </div>

                {/* Feature 8 */}
                <div className="bg-white border border-slate-100 rounded-xl p-5 text-left shadow-3xs hover:shadow-2xs transition-all hover:translate-y-[-1px]">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-650">
                    <Layers className="h-4 w-4" />
                  </div>
                  <h4 className="mt-3 font-sans text-xs font-bold text-slate-900 uppercase tracking-wide">
                    Civic Intelligence
                  </h4>
                  <p className="mt-1 font-sans text-[10.5px] text-slate-500 leading-normal font-medium">
                    A comprehensive local analytics dashboard showcasing resolution rate, active wards, and hazard patterns.
                  </p>
                </div>
              </div>
            </div>
          </div>

        ) : selectedProfileUid ? (
          
          /* User Profile View mode */
          <UserProfile
            uid={selectedProfileUid}
            currentUser={user}
            onClose={handleCloseProfile}
            onSelectReport={handleSelectReport}
            allReports={reports}
          />

        ) : (
          
          /* Active full screen Three-Column Layout as requested */
          <div className="grid grid-cols-1 lg:grid-cols-[148px_1fr_180px] gap-4.5 items-start">
            
            {/* ======================================================= */}
            {/* COLUMN 1: LEFT SIDEBAR CONTROLS (148px custom)          */}
            {/* ======================================================= */}
            <aside id="left-filters-panel" className="flex flex-col gap-4">
              
              {/* Localities card */}
              <div className="rounded-xl border border-slate-150 bg-white p-3 shadow-3xs">
                <h4 className="font-sans text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center">
                  <Compass className="h-3 w-3 mr-1 text-slate-400" />
                  Localities
                </h4>
                <div className="flex flex-col gap-1 font-sans text-xs">
                  {sidebarLocalities.map((loc) => (
                    <button
                      key={loc.name}
                      onClick={() => setSelectedLocality(loc.name)}
                      className={`flex items-center space-x-1.5 px-2 py-1.2 rounded-lg text-left transition-colors duration-200 cursor-pointer ${
                        selectedLocality === loc.name
                          ? 'bg-indigo-50/70 text-indigo-700 font-bold'
                          : 'text-slate-550 hover:bg-slate-50 hover:text-slate-800'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${loc.color}`} />
                      <span className="truncate">{loc.name === 'All' ? 'All Areas' : loc.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Category card with precise icons */}
              <div className="rounded-xl border border-slate-150 bg-white p-3 shadow-3xs">
                <h4 className="font-sans text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center">
                  <Tag className="h-3 w-3 mr-1 text-slate-400" />
                  Categories
                </h4>
                <div className="flex flex-col gap-1 font-sans text-xs">
                  {[
                    { label: 'All', value: 'All', icon: Layers },
                    { label: 'Roads', value: 'Roads', icon: Construction },
                    { label: 'Water', value: 'Water', icon: Droplet },
                    { label: 'Power', value: 'Electricity', icon: Lightbulb },
                    { label: 'Waste', value: 'Waste', icon: Trash2 },
                    { label: 'Safety', value: 'Safety', icon: Shield },
                    { label: 'Animals', value: 'Animals', icon: PawPrint },
                    { label: 'Env', value: 'Environment', icon: Leaf },
                    { label: 'Facilities', value: 'Public Facilities', icon: Building2 }
                  ].map((catItem) => {
                    const IconComp = catItem.icon;
                    return (
                      <button
                        key={catItem.value}
                        onClick={() => setSelectedCategory(catItem.value)}
                        className={`flex items-center space-x-1.5 px-2 py-1.2 rounded-lg text-left transition-colors duration-200 cursor-pointer ${
                          selectedCategory === catItem.value
                            ? 'bg-indigo-50/75 text-indigo-700 font-bold'
                            : 'text-slate-555 hover:bg-slate-50'
                        }`}
                      >
                        <IconComp className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="truncate text-[11px] font-medium">{catItem.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Severity card */}
              <div className="rounded-xl border border-slate-150 bg-white p-3 shadow-3xs">
                <h4 className="font-sans text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center">
                  <AlertTriangle className="h-3 w-3 mr-1 text-slate-400" />
                  Severity
                </h4>
                <div className="flex flex-col gap-1 font-sans text-xs">
                  {[
                    { label: 'All', value: 'All', color: 'bg-slate-300' },
                    { label: 'High', value: 'High', color: 'bg-rose-500' },
                    { label: 'Medium', value: 'Medium', color: 'bg-amber-500' },
                    { label: 'Low', value: 'Low', color: 'bg-teal-500' }
                  ].map((sevItem) => (
                    <button
                      key={sevItem.value}
                      onClick={() => setSelectedSeverity(sevItem.value as any)}
                      className={`flex items-center space-x-2 px-2 py-1.2 rounded-lg text-left transition-colors duration-200 cursor-pointer ${
                        selectedSeverity === sevItem.value
                          ? 'bg-indigo-50/70 text-indigo-700 font-bold'
                          : 'text-slate-550 hover:bg-slate-50'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${sevItem.color}`} />
                      <span className="truncate">{sevItem.label}</span>
                    </button>
                  ))}
                </div>
              </div>

            </aside>

            {/* ======================================================= */}
            {/* COLUMN 2: CENTER LIVE STREAM FEED (Flexible width)       */}
            {/* ======================================================= */}
            <section id="center-hazards-stream" className="space-y-4">
              
              {currentView === 'dashboard' ? (
                <CivicIntelligenceDashboard 
                  reports={reports} 
                  onBack={() => handleSetView('feed')} 
                />
              ) : isMapViewActive ? (
                <InteractiveMap
                  reports={reports}
                  selectedLocality={selectedLocality}
                  selectedCategory={selectedCategory}
                  selectedSeverity={selectedSeverity}
                  searchQuery={searchQuery}
                  userCoords={userCoords}
                  onSelectReport={handleSelectReport}
                  onClose={() => {
                    window.history.pushState({}, '', '/');
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }}
                />
              ) : (
                <>
                  {/* Prominent "+ Report" button atop center feed */}
                  <button
                    onClick={() => setIsComposerOpen(true)}
                    className="w-full flex items-center justify-between p-4.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md hover:shadow-lg transform hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 cursor-pointer group"
                  >
                    <div className="flex items-center space-x-3.5 text-left">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white group-hover:scale-110 transition-transform duration-200 shrink-0">
                        <Plus className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="font-sans text-xs font-black uppercase tracking-wider">Report a Local Hazard</h3>
                        <p className="font-sans text-[11px] text-indigo-150 mt-0.5 leading-tight">
                          Instantly file potholes, electrical issues, rescue animals, or safety alerts.
                        </p>
                      </div>
                    </div>
                    <span className="hidden sm:inline-flex h-7 px-3 items-center justify-center rounded-lg bg-white/10 text-[9.5px] font-black uppercase tracking-widest text-indigo-50 shrink-0 select-none">
                      FILE REPORT
                    </span>
                  </button>

                  {/* Center stream indicator banner */}
                  <div className="flex items-center justify-between bg-white border border-slate-150 px-4 py-2.5 rounded-xl shadow-3xs">
                    <div className="flex items-center space-x-2">
                      <h2 className="font-sans text-xs font-black text-slate-850 uppercase tracking-wider">
                        Community feed ({sortedReports.length})
                      </h2>
                    </div>
                    
                    <div className="flex items-center space-x-2.5">
                      <button
                        onClick={() => {
                          window.history.pushState({}, '', '/map');
                          window.dispatchEvent(new PopStateEvent('popstate'));
                        }}
                        className="inline-flex items-center space-x-1 px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-[10.5px] font-bold cursor-pointer transition-colors border border-indigo-100 shadow-3xs"
                      >
                        <MapPin className="h-3 w-3" />
                        <span>Map View</span>
                      </button>
                      <span className="inline-flex items-center space-x-1.5 font-mono text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-110 px-2 py-0.5 rounded-full">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping inline-block" />
                        <span>LIVE SYNC ACTIVE</span>
                      </span>
                    </div>
                  </div>

                  {/* Feed Stream list or fallback */}
                  {loadingReports && reports.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-14">
                      <div className="h-7 w-7 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"></div>
                      <p className="mt-3 font-sans text-xs text-slate-400">Syncing neighborhood data...</p>
                    </div>
                  ) : errorMsg ? (
                    <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-red-800">
                      <div className="flex space-x-2">
                        <AlertTriangle className="h-4.5 w-4.5 text-red-500 shrink-0" />
                        <div>
                          <h4 className="font-sans text-xs font-bold">Failed to connect to database channel</h4>
                          <p className="mt-0.5 font-sans text-[11px] text-red-700">{errorMsg}</p>
                        </div>
                      </div>
                    </div>
                  ) : sortedReports.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-14 text-center p-6 shadow-3xs">
                      <HelpCircle className="h-8 w-8 text-slate-350" />
                      <h3 className="mt-3.5 font-sans text-xs font-bold text-slate-900 uppercase">
                        No active reports listed
                      </h3>
                      <p className="mt-1.5 max-w-sm font-sans text-[11px] text-slate-450 leading-relaxed">
                        Choose different sidebar dots or lodge a new community alert with "+ Report" in the top bar!
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {sortedReports.map((report) => (
                        <ReportCard 
                          key={report.id} 
                          report={report} 
                          user={user} 
                          currentUserDoc={currentUserDoc} 
                          onSelect={handleSelectReport}
                          onDeleted={handleCloseReportDetail}
                          onUserClick={handleSelectProfile}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}

            </section>

            {/* ======================================================= */}
            {/* COLUMN 3: RIGHT SIDEBAR STATS BENTO (180px custom)       */}
            {/* ======================================================= */}
            <aside id="right-bento-panel" className="flex flex-col gap-4">
              
              {/* Impact Dashboard 2x2 grid */}
              <div className="rounded-xl border border-slate-150 bg-white p-3 shadow-3xs">
                <h4 className="font-sans text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center">
                  <Award className="h-3 w-3 mr-1 text-slate-400" />
                  Impact Dashboard
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-2 text-center">
                    <span className="block font-mono text-sm font-black text-slate-800">{totalReported}</span>
                    <span className="block text-[8px] text-slate-400 font-bold uppercase tracking-tight mt-0.5">Total</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-2 text-center">
                    <span className="block font-mono text-sm font-black text-indigo-600">{inProgressIssues}</span>
                    <span className="block text-[8px] text-slate-400 font-bold uppercase tracking-tight mt-0.5">Active</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-2 text-center">
                    <span className="block font-mono text-sm font-black text-emerald-600">{resolvedIssues}</span>
                    <span className="block text-[8px] text-slate-400 font-bold uppercase tracking-tight mt-0.5">Solved</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-2 text-center">
                    <span className="block font-mono text-sm font-black text-purple-600">{verifiedIssues}</span>
                    <span className="block text-[8px] text-slate-400 font-bold uppercase tracking-tight mt-0.5">Votes</span>
                  </div>
                </div>
              </div>

              {/* Top Contributors Ranked List */}
              <div className="rounded-xl border border-slate-150 bg-white p-3 shadow-3xs">
                <h4 className="font-sans text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2.5 flex items-center">
                  <Users className="h-3 w-3 mr-1 text-slate-400" />
                  Top Contributors
                </h4>
                {topContributors.length === 0 ? (
                  <p className="text-[10px] text-slate-400 italic font-sans py-1">Scanning leaderboard...</p>
                ) : (
                  <div className="space-y-2.5">
                    {topContributors.map((contrib, idx) => (
                      <div key={contrib.uid} className="flex items-center justify-between gap-1.5">
                        <button
                          onClick={() => handleSelectProfile(contrib.uid)}
                          className="flex items-center space-x-1.5 min-w-0 text-left hover:text-indigo-600 cursor-pointer group transition-colors animate-fade-in"
                        >
                          <span className="font-mono text-xxs font-black text-slate-300 w-3 text-center shrink-0">
                            #{idx + 1}
                          </span>
                          {contrib.photoURL ? (
                            <img 
                              src={contrib.photoURL} 
                              alt={contrib.displayName} 
                              className="h-5.5 w-5.5 rounded-full object-cover shrink-0 img_no_referrer group-hover:scale-105 transition-transform" 
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="h-5.5 w-5.5 bg-indigo-50 text-indigo-700 font-bold text-[9px] rounded-full flex items-center justify-center shrink-0 uppercase group-hover:scale-105 transition-transform">
                              {contrib.displayName ? contrib.displayName[0] : 'U'}
                            </div>
                          )}
                          <div className="flex flex-col min-w-0">
                            <span className="font-sans text-[10.5px] font-bold text-slate-800 truncate group-hover:text-indigo-600 transition-colors leading-tight">
                              {contrib.displayName}
                            </span>
                            <span className="text-[8px] text-slate-400 font-extrabold uppercase tracking-wider leading-none mt-0.5">
                              {getUserLevel(contrib.impactPoints || 0).name}
                            </span>
                          </div>
                        </button>
                        <span className="font-mono text-[9px] font-extrabold text-amber-700 bg-amber-50 border border-amber-100/50 px-1 py-0.2 rounded-sm shrink-0">
                          {contrib.impactPoints || 0}p
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Trending Near You velocity list */}
              <div className="rounded-xl border border-slate-150 bg-white p-3 shadow-3xs">
                <h4 className="font-sans text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center">
                  <TrendingUp className="h-3 w-3 mr-1 text-slate-400 animate-bounce" />
                  Trending Near You
                </h4>
                {trendingIssues.filter(i => i.verificationCount > 0).length === 0 ? (
                  <div className="text-center py-2">
                    <p className="text-[10px] text-slate-400 italic">No upvotes verified yet.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {trendingIssues.filter(i => i.verificationCount > 0).map((issue) => {
                      const percent = Math.min(100, (issue.verificationCount || 0) * 20); // max scale 5 verifications
                      return (
                        <div 
                          key={issue.id} 
                          className="space-y-1 cursor-pointer hover:bg-slate-50 p-1.5 -mx-1.5 rounded-lg transition-all"
                          onClick={() => handleSelectReport(issue.id)}
                          role="button"
                          title="View report details"
                        >
                          <div className="flex items-center justify-between text-[10px] gap-1">
                            <span className="font-sans font-bold text-slate-750 truncate max-w-[100px]">
                              {issue.title}
                            </span>
                            <span className="font-mono font-bold text-indigo-600 shrink-0 capitalize">
                              +{issue.verificationCount} votes
                            </span>
                          </div>
                          <div className="h-1.2 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            </aside>

          </div>
        )}

      </main>

      {/* Styled Report Composer Modal Form */}
      <ReportForm 
        isOpen={isComposerOpen} 
        onClose={() => setIsComposerOpen(false)} 
        user={user} 
        onSuccess={() => setIsComposerOpen(false)}
        localities={nearLocalities}
        onDetectedLocalities={(locs) => {
          setUserDetectedLocalities((prev) => {
            const merged = Array.from(new Set([...prev, ...locs]));
            return merged;
          });
        }}
        onSelectReport={(reportId) => {
          setSelectedReportId(reportId);
        }}
      />

      {/* Shareable detailed inquiry post overlay modal */}
      {selectedReportId && (
        <ReportDetailModal
          reportId={selectedReportId}
          onClose={handleCloseReportDetail}
          user={user}
          currentUserDoc={currentUserDoc}
          onDeleted={handleCloseReportDetail}
          loadingUser={loadingUser}
          onUserClick={handleSelectProfile}
        />
      )}

      {/* Floating Action Button for Mobile */}
      {user && (
        <div className="fixed bottom-6 right-6 z-40 sm:hidden">
          <button
            onClick={() => setIsComposerOpen(true)}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl hover:scale-110 active:scale-95 transform hover:-translate-y-1 transition-all duration-200 cursor-pointer"
            title="Report a Local Hazard"
          >
            <Plus className="h-6 w-6" />
          </button>
        </div>
      )}

      {/* Impact Points Explainer Modal */}
      {isExplainerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs select-none">
          <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-slate-150 bg-white shadow-2xl animate-fade-in flex flex-col max-h-[90vh]">
            
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 shrink-0 bg-slate-50/50">
              <div className="flex items-center space-x-2">
                <Award className="h-5 w-5 text-indigo-600 animate-pulse" />
                <h3 className="font-sans text-sm font-black text-slate-900 uppercase tracking-wider">
                  Civic Impact Explainer
                </h3>
              </div>
              <button
                onClick={() => setIsExplainerOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content Scrollable */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              
              {/* Point Status and Badge Card */}
              {(() => {
                const points = currentUserDoc?.impactPoints || 0;
                const lvl = getUserLevel(points);
                const nextLvlPoints = lvl.maxPoints === Infinity ? null : lvl.maxPoints + 1;
                const nextLvl = nextLvlPoints ? getUserLevel(nextLvlPoints) : null;
                const percent = lvl.maxPoints === Infinity 
                  ? 100 
                  : Math.round(((points - lvl.minPoints) / (lvl.maxPoints - lvl.minPoints + 1)) * 100);

                return (
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/35 p-4.5 text-center shadow-3xs space-y-3.5">
                    <div className="space-y-1">
                      <span className="text-[10px] text-indigo-600 font-extrabold uppercase tracking-widest block">
                        Your Current Score
                      </span>
                      <span className="font-mono text-4xl font-black text-indigo-950 block">
                        {points} <span className="text-sm font-bold text-indigo-500">pts</span>
                      </span>
                    </div>

                    <div className="flex items-center justify-center space-x-2">
                      <span className={`inline-flex items-center text-[10.5px] font-extrabold uppercase tracking-wider border px-3 py-1 rounded-full ${lvl.style}`}>
                        <Award className={`h-3.5 w-3.5 mr-1.5 ${lvl.iconStyle}`} />
                        {lvl.name}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-1.5 text-left">
                      <div className="flex justify-between text-[10.5px] font-bold text-slate-600">
                        <span>Level Progress</span>
                        <span>
                          {lvl.maxPoints === Infinity 
                            ? "Ultimate Tier" 
                            : `${points} / ${lvl.maxPoints} pts`}
                        </span>
                      </div>
                      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
                        <div 
                          className="h-full bg-indigo-600 rounded-full transition-all duration-500"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      {nextLvl && (
                        <p className="text-[9.5px] text-slate-450 italic font-medium">
                          Collect <span className="font-semibold text-slate-600">{nextLvlPoints - points} more pts</span> to advance to <span className="font-bold text-indigo-600 uppercase">{nextLvl.name}</span>
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Score Rules Matrix Grid */}
              <div className="space-y-3">
                <h4 className="font-sans text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center">
                  <TrendingUp className="h-3.5 w-3.5 mr-1.5 text-emerald-500" />
                  Earning Points
                </h4>
                <div className="grid grid-cols-1 gap-2">
                  <div className="flex items-start justify-between p-2.5 rounded-lg border border-slate-100 bg-emerald-50/20 text-xs">
                    <div className="space-y-0.5 pr-2">
                      <p className="font-extrabold text-slate-800">Citizen Verification Award</p>
                      <p className="text-[10px] text-slate-500">Earned when another citizen verifies one of your filed reports.</p>
                    </div>
                    <span className="font-mono text-[11px] font-black text-emerald-700 bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 rounded-sm shrink-0">
                      +2 pts
                    </span>
                  </div>

                  <div className="flex items-start justify-between p-2.5 rounded-lg border border-slate-100 bg-emerald-50/20 text-xs">
                    <div className="space-y-0.5 pr-2">
                      <p className="font-extrabold text-slate-800">Giving Verification Votes</p>
                      <p className="text-[10px] text-slate-500">Earned when you verify someone else's community hazard report.</p>
                    </div>
                    <span className="font-mono text-[11px] font-black text-emerald-700 bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 rounded-sm shrink-0">
                      +1 pt
                    </span>
                  </div>

                  <div className="flex items-start justify-between p-2.5 rounded-lg border border-slate-100 bg-emerald-50/20 text-xs">
                    <div className="space-y-0.5 pr-2">
                      <p className="font-extrabold text-slate-800">Report Verified (3+ Votes)</p>
                      <p className="text-[10px] text-slate-500">Bonus awarded when your report accumulates 3 external verification votes.</p>
                    </div>
                    <span className="font-mono text-[11px] font-black text-emerald-700 bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 rounded-sm shrink-0">
                      +10 pts
                    </span>
                  </div>

                  <div className="flex items-start justify-between p-2.5 rounded-lg border border-slate-100 bg-emerald-50/20 text-xs">
                    <div className="space-y-0.5 pr-2">
                      <p className="font-extrabold text-slate-800">Issue Resolved</p>
                      <p className="text-[10px] text-slate-500">Awarded to you as creator when your reported local issue is marked as Resolved.</p>
                    </div>
                    <span className="font-mono text-[11px] font-black text-emerald-700 bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 rounded-sm shrink-0">
                      +25 pts
                    </span>
                  </div>

                  <div className="flex items-start justify-between p-2.5 rounded-lg border border-slate-100 bg-emerald-50/20 text-xs">
                    <div className="space-y-0.5 pr-2">
                      <p className="font-extrabold text-slate-800">After-Photo Proof Upload</p>
                      <p className="text-[10px] text-slate-500">Bonus awarded for attaching visual "after-photo" proof of resolution.</p>
                    </div>
                    <span className="font-mono text-[11px] font-black text-emerald-700 bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 rounded-sm shrink-0">
                      +15 pts
                    </span>
                  </div>
                </div>
              </div>

              {/* Deductions & Penalties */}
              <div className="space-y-3">
                <h4 className="font-sans text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center">
                  <TrendingDown className="h-3.5 w-3.5 mr-1.5 text-rose-500" />
                  Deductions & Penalties
                </h4>
                <div className="grid grid-cols-1 gap-2">
                  <div className="flex items-start justify-between p-2.5 rounded-lg border border-slate-100 bg-rose-50/10 text-xs">
                    <div className="space-y-0.5 pr-2">
                      <p className="font-extrabold text-slate-800">Verification Withdrawn</p>
                      <p className="text-[10px] text-slate-500">Points are reversed when someone withdraws their verification of your report.</p>
                    </div>
                    <span className="font-mono text-[11px] font-black text-rose-700 bg-rose-50 border border-rose-100 px-1.5 py-0.5 rounded-sm shrink-0">
                      -2 pts
                    </span>
                  </div>

                  <div className="flex items-start justify-between p-2.5 rounded-lg border border-slate-100 bg-rose-50/10 text-xs">
                    <div className="space-y-0.5 pr-2">
                      <p className="font-extrabold text-slate-800">Withdrawing Verification</p>
                      <p className="text-[10px] text-slate-500">Points are reversed when you retract a verification vote you gave previously.</p>
                    </div>
                    <span className="font-mono text-[11px] font-black text-rose-700 bg-rose-50 border border-rose-100 px-1.5 py-0.5 rounded-sm shrink-0">
                      -1 pt
                    </span>
                  </div>
                </div>
              </div>

              {/* Threshold Guidelines */}
              <div className="rounded-xl border border-slate-150 p-4 space-y-2.5 bg-slate-50/40">
                <h4 className="font-sans text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center">
                  <Award className="h-3.5 w-3.5 mr-1.5 text-slate-500" />
                  Impact Levels Threshold
                </h4>
                <div className="grid grid-cols-5 gap-1.5 text-center text-xs">
                  <div className="p-1 rounded-lg border border-slate-100 bg-white shadow-3xs flex flex-col items-center">
                    <span className="font-extrabold text-slate-700 text-[10px]">Citizen</span>
                    <span className="font-mono text-[9px] text-slate-400 mt-1">0-99p</span>
                  </div>
                  <div className="p-1 rounded-lg border border-indigo-100 bg-indigo-50/10 shadow-3xs flex flex-col items-center">
                    <span className="font-extrabold text-indigo-700 text-[10px]">Volunteer</span>
                    <span className="font-mono text-[9px] text-slate-400 mt-1">100-249p</span>
                  </div>
                  <div className="p-1 rounded-lg border border-purple-100 bg-purple-50/10 shadow-3xs flex flex-col items-center">
                    <span className="font-extrabold text-purple-700 text-[10px]">Guardian</span>
                    <span className="font-mono text-[9px] text-slate-400 mt-1">250-449p</span>
                  </div>
                  <div className="p-1 rounded-lg border border-pink-100 bg-pink-50/10 shadow-3xs flex flex-col items-center">
                    <span className="font-extrabold text-pink-700 text-[10px]">Champion</span>
                    <span className="font-mono text-[9px] text-slate-400 mt-1">450-799p</span>
                  </div>
                  <div className="p-1 rounded-lg border border-amber-100 bg-amber-50/10 shadow-3xs flex flex-col items-center">
                    <span className="font-extrabold text-amber-700 text-[10px]">Hero</span>
                    <span className="font-mono text-[9px] text-slate-400 mt-1">800p+</span>
                  </div>
                </div>
              </div>

              {/* Clamping & Self clauses */}
              <div className="rounded-xl bg-amber-50/45 border border-amber-100/50 p-3.5 text-[10.5px] text-amber-900 leading-relaxed space-y-1.5">
                <p className="font-bold flex items-center">
                  <Info className="h-3.5 w-3.5 mr-1.5 text-amber-600 shrink-0" />
                  Key Enforcement Clauses
                </p>
                <ul className="list-disc pl-4 space-y-1">
                  <li><strong>Zero Points Floor:</strong> Your civic impact score is naturally floor-clamped; it will never drop below 0 points.</li>
                  <li><strong>Self-Verification Immunity:</strong> You are strictly forbidden from awarding yourself points; verifying your own report gains no score advantages.</li>
                </ul>
              </div>

            </div>

            {/* Footer Close button */}
            <div className="border-t border-slate-100 px-5 py-3.5 shrink-0 bg-slate-50 flex justify-end">
              <button
                onClick={() => setIsExplainerOpen(false)}
                className="rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-sans text-xs font-bold px-4 py-2 cursor-pointer shadow-xs transition-colors"
              >
                Close Explainer
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
