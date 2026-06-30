import React, { useState, useRef, useId, useEffect } from 'react';
import { collection, doc, setDoc, updateDoc, serverTimestamp, increment, runTransaction, getDoc, getDocs, query, where, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Department, IssueSeverity, EstimatedImpact, DEPARTMENT_SUBCATEGORIES } from '../types';
import { User } from 'firebase/auth';
import { evaluateAndAwardBadges } from '../lib/badgeService';

function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000; // Radius of the earth in m
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in m
  return d;
}

async function getReportPrimaryImage(reportId: string, photoUrl: string | null): Promise<string | null> {
  // 1. Try fetching first image from subcollection 'reports/{reportId}/images'
  try {
    const imgSnap = await getDocs(query(collection(db, 'reports', reportId, 'images'), limit(1)));
    if (!imgSnap.empty) {
      const data = imgSnap.docs[0].data();
      if (data && data.data) {
        return data.data; // this is the base64 string
      }
    }
  } catch (err) {
    console.warn('Error reading subcollection image:', err);
  }

  // 2. Try fetching from legacy document 'reportImages/{reportId}'
  try {
    const legacySnap = await getDoc(doc(db, 'reportImages', reportId));
    if (legacySnap.exists()) {
      const data = legacySnap.data();
      if (data && data.imageData) {
        return data.imageData;
      }
    }
  } catch (err) {
    console.warn('Error reading legacy image doc:', err);
  }

  // 3. Fallback to photoUrl if it's not empty/placeholder
  if (photoUrl && photoUrl !== 'placeholder') {
    return photoUrl;
  }

  return null;
}

import { 
  X, 
  MapPin, 
  Plus, 
  Camera, 
  Video, 
  Image as ImageIcon, 
  Loader2, 
  Sparkles, 
  AlertTriangle, 
  CheckCircle,
  Info,
  FileText,
  MousePointerClick,
  RefreshCw
} from 'lucide-react';

import { UseId as useIdReact } from 'react';
import PinPickerMap from './PinPickerMap';
import { isHeicFile, convertHeicToJpeg } from '../lib/heicConverter';

interface ReportFormProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  onSuccess?: () => void;
  localities?: string[];
  onDetectedLocalities?: (locs: string[]) => void;
  onSelectReport?: (reportId: string) => void;
}

export default function ReportForm({ isOpen, onClose, user, onSuccess, localities: propsLocalities, onDetectedLocalities, onSelectReport }: ReportFormProps) {
  const formId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form Field States
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [department, setDepartment] = useState<Department>('Roads');
  const [subcategory, setSubcategory] = useState<string>('Pothole');
  const [severity, setSeverity] = useState<IssueSeverity>('Medium');
  const [locationText, setLocationText] = useState('');
  const [locality, setLocality] = useState('');
  const [selectedDropdownValue, setSelectedDropdownValue] = useState('');
  const [customLocalityText, setCustomLocalityText] = useState('');
  const [city, setCity] = useState('');

  // GPS and tracking States
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [locationEdited, setLocationEdited] = useState(false);
  const [hasGps, setHasGps] = useState(false);

  const handleCoordinatesChange = (newCoords: { lat: number; lng: number }) => {
    setCoords(newCoords);
    setHasGps(true);
    setLocationEdited(true);
  };

  const isValidLocality = (name: string) => {
    if (!name) return false;
    const trimmed = name.trim();
    if (trimmed.toLowerCase() === 'other') return false; // Filter 'Other' as we render it explicitly
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

  const handleLocalityDetected = (detectedLoc: string, detectedCity: string, detectedLocalities: string[]) => {
    if (detectedCity) {
      setCity(detectedCity);
    }
    
    const validLoc = detectedLoc && detectedLoc !== 'Other' && isValidLocality(detectedLoc) ? detectedLoc : null;
    if (validLoc) {
      setLocality(validLoc);
      setSelectedDropdownValue(validLoc);
    } else {
      setSelectedDropdownValue('Other');
      setLocality(customLocalityText || 'Other');
    }

    if (detectedLocalities && Array.isArray(detectedLocalities)) {
      const filtered = detectedLocalities.filter(l => l !== 'Other' && isValidLocality(l));
      setDetectedLocalities(filtered);
      if (onDetectedLocalities) {
        onDetectedLocalities(filtered);
      }
    }
  };

  // Media Attachment States
  const [compressedImages, setCompressedImages] = useState<string[]>([]);
  const [imageWarningMsg, setImageWarningMsg] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isConvertingImage, setIsConvertingImage] = useState(false);

  // Status/Loading States
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Duplicate Check States
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const [duplicateMatch, setDuplicateMatch] = useState<{
    id: string;
    title: string;
    description: string;
    distance: number;
    photoUrl?: string | null;
    reason: string;
    confidence: number;
  } | null>(null);
  const [userDismissedDuplicate, setUserDismissedDuplicate] = useState(false);

  const checkForDuplicates = async (
    currentCoords: { lat: number; lng: number } | null,
    currentDept: Department,
    currentTitle: string,
    currentDesc: string,
    currentImages: string[]
  ) => {
    if (!currentCoords || currentImages.length === 0) {
      return;
    }

    setIsCheckingDuplicates(true);
    setDuplicateMatch(null);

    try {
      const reportsCollection = collection(db, 'reports');
      const q = query(reportsCollection, where('department', '==', currentDept));
      const snap = await getDocs(q);

      const candidates: any[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.status !== 'Resolved' && data.lat != null && data.lng != null) {
          const dist = getDistanceMeters(currentCoords.lat, currentCoords.lng, data.lat, data.lng);
          if (dist <= 150) {
            candidates.push({
              id: docSnap.id,
              title: data.title || '',
              description: data.description || '',
              photoUrl: data.photoUrl || null,
              distance: dist,
              lat: data.lat,
              lng: data.lng,
            });
          }
        }
      });

      if (candidates.length === 0) {
        setIsCheckingDuplicates(false);
        return;
      }

      candidates.sort((a, b) => a.distance - b.distance);
      const topCandidates = candidates.slice(0, 2);

      const candidatesWithImages = await Promise.all(
        topCandidates.map(async (cand) => {
          const base64Img = await getReportPrimaryImage(cand.id, cand.photoUrl);
          return {
            id: cand.id,
            title: cand.title,
            description: cand.description,
            distance: cand.distance,
            image: base64Img,
          };
        })
      );

      const response = await fetch('/api/check-duplicate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          newReport: {
            title: currentTitle,
            description: currentDesc,
            image: currentImages[0],
            mimeType: 'image/jpeg',
          },
          candidates: candidatesWithImages,
        }),
      });

      if (!response.ok) {
        throw new Error('Server error checking duplicates');
      }

      const resData = await response.json();
      if (resData && resData.isDuplicate && resData.matchedReportId && resData.confidence >= 0.70) {
        const matchedCand = candidates.find(c => c.id === resData.matchedReportId);
        if (matchedCand) {
          const candImg = candidatesWithImages.find(c => c.id === resData.matchedReportId)?.image || matchedCand.photoUrl;
          setDuplicateMatch({
            id: matchedCand.id,
            title: matchedCand.title,
            description: matchedCand.description,
            distance: matchedCand.distance,
            photoUrl: candImg,
            reason: resData.reason,
            confidence: resData.confidence,
          });
        }
      }
    } catch (err) {
      console.warn('Error during duplicate check:', err);
    } finally {
      setIsCheckingDuplicates(false);
    }
  };

  const handleVerifyExistingReport = async () => {
    if (!duplicateMatch || !user) return;
    setLoading(true);
    setErrorMsg(null);

    const reportId = duplicateMatch.id;
    const reportRef = doc(db, 'reports', reportId);
    const verificationRef = doc(db, 'reports', reportId, 'verifications', user.uid);

    let creatorId = 'unknown_reporter';
    try {
      const repSnap = await getDoc(reportRef);
      if (repSnap.exists()) {
        creatorId = repSnap.data().createdBy || 'unknown_reporter';
      }
    } catch (e) {
      console.warn('Could not fetch existing report creator:', e);
    }

    const reporterUserRef = doc(db, 'users', creatorId);
    const verifierRef = doc(db, 'users', user.uid);
    const isSelfVerification = creatorId === user.uid;

    if (isSelfVerification) {
      setLoading(false);
      setInfoMsg("You've already reported this — here's your existing report.");
      setTimeout(() => {
        setInfoMsg(null);
        onClose();
        if (onSelectReport) {
          onSelectReport(reportId);
        }
      }, 3000);
      return;
    }

    const flagsColRef = collection(db, 'reports', reportId, 'flags');
    let flagsSnapshot: any = null;
    try {
      flagsSnapshot = await getDocs(flagsColRef);
    } catch (e) {
      console.warn('Failed to fetch flags before verification transaction:', e);
    }

    try {
      await runTransaction(db, async (transaction) => {
        const reportDoc = await transaction.get(reportRef);
        const verificationDoc = await transaction.get(verificationRef);
        const reporterSnap = await transaction.get(reporterUserRef);
        const verifierSnap = await transaction.get(verifierRef);

        if (!reportDoc.exists()) {
          throw new Error('Report does not exist!');
        }

        const reportData = reportDoc.data();
        const currentCount = reportData.verificationCount || 0;
        const currentFlags = reportData.flagCount || 0;
        const oldStatus = reportData.status || 'Reported';
        const exists = verificationDoc.exists();

        if (exists) {
          return;
        }

        transaction.set(verificationRef, {
          verifiedBy: user.uid,
          verifiedByName: user.displayName || 'Neighbor',
          verifiedAt: serverTimestamp(),
        });

        const nextCount = currentCount + 1;
        let nextFlags = currentFlags;
        let newStatus = oldStatus;

        if (nextCount >= 3) {
          newStatus = 'Verified';
        } else {
          if (oldStatus === 'Reported' || oldStatus === 'Verified' || oldStatus === 'Under Review') {
            if (nextFlags >= 3) {
              newStatus = 'Under Review';
            } else {
              newStatus = 'Reported';
            }
          } else {
            newStatus = oldStatus;
          }
        }

        if (newStatus === 'Verified') {
          nextFlags = 0;
          if (flagsSnapshot) {
            flagsSnapshot.forEach((fDoc: any) => {
              transaction.delete(fDoc.ref);
            });
          }
        }

        let reporterPointsChange = 0;
        let verifierPointsChange = 0;

        if (!isSelfVerification) {
          reporterPointsChange += 2;
          verifierPointsChange += 1;

          if (oldStatus !== 'Verified' && newStatus === 'Verified') {
            reporterPointsChange += 10;
          }
        }

        const updateData: any = {
          verificationCount: nextCount,
          status: newStatus,
          flagCount: nextFlags,
          underReview: newStatus === 'Under Review'
        };

        if (oldStatus !== 'Verified' && newStatus === 'Verified') {
          updateData.verifiedAt = serverTimestamp();
        }

        transaction.update(reportRef, updateData);

        if (reporterSnap.exists() && reporterPointsChange !== 0) {
          const currentRepPoints = reporterSnap.data().impactPoints || 0;
          const finalRepPoints = Math.max(0, currentRepPoints + reporterPointsChange);
          transaction.update(reporterUserRef, {
            impactPoints: finalRepPoints,
          });
        }

        if (verifierSnap.exists() && verifierPointsChange !== 0) {
          const currentVerPoints = verifierSnap.data().impactPoints || 0;
          const finalVerPoints = Math.max(0, currentVerPoints + verifierPointsChange);
          transaction.update(verifierRef, {
            impactPoints: finalVerPoints,
            verificationsGiven: increment(1),
          });
        }
      });

      try {
        const verifierRef = doc(db, 'users', user.uid);
        await updateDoc(verifierRef, {
          impactPoints: increment(5),
        });
      } catch (e) {
        console.warn('Failed to award bonus points:', e);
      }

      setTitle('');
      setDescription('');
      setDepartment('Roads');
      setSubcategory('Pothole');
      setSeverity('Medium');
      setLocality('');
      setSelectedDropdownValue('');
      setCustomLocalityText('');
      setLocationText('');
      setCompressedImages([]);
      setImageWarningMsg(null);
      setAiWarning(null);
      setAiFeedback(null);
      setAiTagged(false);
      
      setPriorityScore(undefined);
      setPriorityReason(undefined);
      setEstimatedImpact(undefined);
      setIsValidCivicIssue(undefined);
      setValidityReason(undefined);
      setConfidence(undefined);

      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
        if (onSelectReport) {
          onSelectReport(reportId);
        }
      }, 1000);

    } catch (err: any) {
      console.error('Failed to verify existing duplicate:', err);
      setErrorMsg(err.message || 'Verification of existing report failed.');
    } finally {
      setLoading(false);
    }
  };

  // AI Vision States
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [aiTagged, setAiTagged] = useState(false);
  const [aiWarning, setAiWarning] = useState<string | null>(null);
  const [aiFeedback, setAiFeedback] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [retryingMsg, setRetryingMsg] = useState(false);

  useEffect(() => {
    let timer: any;
    if (isAnalyzingImage) {
      setRetryingMsg(false);
      timer = setTimeout(() => {
        setRetryingMsg(true);
      }, 5500);
    } else {
      setRetryingMsg(false);
    }
    return () => clearTimeout(timer);
  }, [isAnalyzingImage]);

  // Save the full AI responses as states for submission
  const [priorityScore, setPriorityScore] = useState<number | undefined>(undefined);
  const [priorityReason, setPriorityReason] = useState<string | undefined>(undefined);
  const [estimatedImpact, setEstimatedImpact] = useState<EstimatedImpact | undefined>(undefined);
  const [isValidCivicIssue, setIsValidCivicIssue] = useState<boolean | undefined>(undefined);
  const [validityReason, setValidityReason] = useState<string | undefined>(undefined);
  const [confidence, setConfidence] = useState<number | undefined>(undefined);

  const [detectedLocalities, setDetectedLocalities] = useState<string[]>([]);

  useEffect(() => {
    if (aiTagged && coords && compressedImages.length > 0 && !isCheckingDuplicates && !duplicateMatch && !userDismissedDuplicate) {
      checkForDuplicates(coords, department, title, description, compressedImages);
    }
  }, [coords, aiTagged, department, compressedImages]);

  useEffect(() => {
    if (coords) {
      setDuplicateMatch(null);
      setUserDismissedDuplicate(false);
    }
  }, [coords]);

  const detectLocation = async () => {
    setIsDetecting(true);
    setErrorMsg(null);
    setCoords(null);
    setHasGps(false);
    setLocationEdited(false);
    setLocality('');
    setSelectedDropdownValue('');
    setCustomLocalityText('');
    setCity('');

    if (!navigator.geolocation) {
      setIsDetecting(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng });
        setHasGps(true);
        try {
          const res = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}`);
          if (res.ok) {
            const data = await res.json();
            handleLocalityDetected(data.locality, data.city, data.localities);
          }
        } catch (err) {
          console.warn('Reverse geocode failed:', err);
        }
        setIsDetecting(false);
      },
      (err) => {
        console.warn('Geolocation capture failed:', err);
        setIsDetecting(false);
      },
      { timeout: 7000, enableHighAccuracy: true }
    );
  };

  useEffect(() => {
    if (isOpen && user) {
      detectLocation();
    }
  }, [isOpen, user]);

  const severities: IssueSeverity[] = ['Low', 'Medium', 'High'];

  if (!isOpen || !user) return null;

  const defaultLocalities = ['Bavdhan', 'Kothrud', 'Aundh', 'Baner', 'Pashan', 'Wakad'];
  const localitiesSet = new Set<string>();
  if (propsLocalities && propsLocalities.length > 0) {
    propsLocalities.forEach(loc => {
      if (loc && loc !== 'All' && loc !== 'Other' && isValidLocality(loc)) {
        localitiesSet.add(loc);
      }
    });
  } else {
    defaultLocalities.forEach(loc => {
      if (loc && isValidLocality(loc)) {
        localitiesSet.add(loc);
      }
    });
  }
  const localities = Array.from(localitiesSet);

  // Handle taxonomy changes
  const handleDepartmentChange = (dept: Department) => {
    setDepartment(dept);
    const subcats = DEPARTMENT_SUBCATEGORIES[dept];
    if (subcats && subcats.length > 0) {
      setSubcategory(subcats[0]);
    }
    setAiTagged(false);
  };

  const handleSubcategoryChange = (subcat: string) => {
    setSubcategory(subcat);
    setAiTagged(false);
  };

  // Handle Drag & Drop events
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true);
    } else if (e.type === 'dragleave') {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  const compressImageFile = (file: File): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const maxSide = 1280;
          
          if (width > maxSide || height > maxSide) {
            if (width > height) {
              height = Math.round((height * maxSide) / width);
              width = maxSide;
            } else {
              width = Math.round((width * maxSide) / height);
              height = maxSide;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Could not initialize image canvas context'));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          
          // Export at 0.65 quality
          let dataUrl = canvas.toDataURL('image/jpeg', 0.65);
          
          // Size check: dataUrl.length is roughly 4/3 of actual byte size
          let estimatedBytes = (dataUrl.length * 3) / 4;
          
          if (estimatedBytes > 900 * 1024) {
            // Try quality 0.45
            dataUrl = canvas.toDataURL('image/jpeg', 0.45);
            estimatedBytes = (dataUrl.length * 3) / 4;
          }
          
          if (estimatedBytes > 900 * 1024) {
            reject(new Error('This image file size is too large. Please capture or pick a smaller photo.'));
          } else {
            resolve(dataUrl);
          }
        };
        img.onerror = () => reject(new Error('Failed to parse image from file.'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('Failed to read image file.'));
      reader.readAsDataURL(file);
    });
  };

  const triggerAiAnalysis = async (cleanBase64: string) => {
    setIsAnalyzingImage(true);
    setAiError(null);
    setAiFeedback(null);
    setAiWarning(null);
    try {
      const response = await fetch('/api/analyze-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: cleanBase64,
          mimeType: 'image/jpeg',
        }),
      });

      if (!response.ok) {
        let errMsg = 'Server error';
        try {
          const errData = await response.json();
          if (errData && errData.error) {
            errMsg = errData.error;
          }
        } catch (_) {}
        throw new Error(`${errMsg} (status: ${response.status})`);
      }

      const data = await response.json();

      if (data && typeof data === 'object') {
        const { 
          department: parsedDept, 
          subcategory: parsedSub, 
          severity: parsedSev, 
          title: parsedTitle, 
          description: parsedDesc,
          priorityScore: parsedScore,
          priorityReason: parsedReason,
          estimatedImpact: parsedImpact,
          isValidCivicIssue: parsedValid,
          validityReason: parsedValReason,
          confidence: parsedConfidence
        } = data;

        if (parsedTitle) setTitle(parsedTitle);
        if (parsedDesc) setDescription(parsedDesc);
        
        const validDeptList = Object.keys(DEPARTMENT_SUBCATEGORIES);
        if (parsedDept && validDeptList.includes(parsedDept)) {
          const deptTyped = parsedDept as Department;
          setDepartment(deptTyped);
          const subcats = DEPARTMENT_SUBCATEGORIES[deptTyped];
          if (parsedSub && subcats.includes(parsedSub)) {
            setSubcategory(parsedSub);
          } else if (subcats && subcats.length > 0) {
            setSubcategory(subcats[0]);
          }
          setAiTagged(true);
        }

        const validSeverities: IssueSeverity[] = ['Low', 'Medium', 'High'];
        if (parsedSev && validSeverities.includes(parsedSev as IssueSeverity)) {
          setSeverity(parsedSev as IssueSeverity);
        } else {
          setSeverity('Low');
        }

        if (parsedScore !== undefined && parsedScore !== null) {
          setPriorityScore(parsedScore);
        }
        if (parsedReason) {
          setPriorityReason(parsedReason);
        }
        if (parsedImpact) {
          setEstimatedImpact(parsedImpact);
        }
        if (parsedValid !== undefined && parsedValid !== null) {
          setIsValidCivicIssue(parsedValid);
        }
        if (parsedValReason) {
          setValidityReason(parsedValReason);
        }
        if (parsedConfidence !== undefined && parsedConfidence !== null) {
          setConfidence(parsedConfidence);
        }

        if (parsedValid === false) {
          setAiWarning(`Warning: The AI tags this preview as potentially invalid or outside civic scope: ${parsedValReason || 'Not clearly a civic issue'}`);
        } else {
          setAiFeedback('AI model analyzed photo successfully and autofilled fields.');
        }
      }
    } catch (err: any) {
      console.warn('AI analysis failed:', err);
      setAiError('AI analysis is busy right now — you can fill the form manually or retry');
      setAiFeedback(null);
      setAiWarning(null);
      setAiTagged(false);
    } finally {
      setIsAnalyzingImage(false);
    }
  };

  const handleRetryAi = () => {
    if (compressedImages.length > 0) {
      const firstImg = compressedImages[0];
      const cleanBase64 = firstImg.split(',')[1] || firstImg;
      triggerAiAnalysis(cleanBase64);
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    setImageWarningMsg(null);
    setAiWarning(null);
    setAiFeedback(null);
    setErrorMsg(null);

    const remainingSlots = 5 - compressedImages.length;
    if (remainingSlots <= 0) {
      setImageWarningMsg('You can upload a maximum of 5 photos.');
      return;
    }

    const filesToProcess = Array.from(files).slice(0, remainingSlots);
    setIsAnalyzingImage(true);

    try {
      const newCompressed: string[] = [];
      for (let i = 0; i < filesToProcess.length; i++) {
        let file = filesToProcess[i];
        if (file.type.startsWith('video/')) {
          setImageWarningMsg('Video uploads are coming soon — please attach a photo.');
          continue;
        }

        if (isHeicFile(file)) {
          setIsConvertingImage(true);
          try {
            file = await convertHeicToJpeg(file);
          } catch (convErr: any) {
            setIsConvertingImage(false);
            throw convErr;
          }
          setIsConvertingImage(false);
        }

        const compressedUrl = await compressImageFile(file);
        newCompressed.push(compressedUrl);
      }

      if (newCompressed.length > 0) {
        const isFirstImageOverall = compressedImages.length === 0;
        setCompressedImages((prev) => [...prev, ...newCompressed]);

        if (isFirstImageOverall) {
          const firstImg = newCompressed[0];
          const cleanBase64 = firstImg.split(',')[1] || firstImg;
          // triggerAiAnalysis handles its own loading state
          triggerAiAnalysis(cleanBase64);
        } else {
          setIsAnalyzingImage(false);
        }
      } else {
        setIsAnalyzingImage(false);
      }
    } catch (err: any) {
      console.warn('Compression or conversion failed for file:', err);
      setErrorMsg(err.message || 'Image compression failed.');
      setIsAnalyzingImage(false);
      setIsConvertingImage(false);
    }
  };

  const handleRemoveImage = (indexToRemove: number) => {
    setCompressedImages((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCheckingDuplicates) {
      return;
    }
    if (title.trim().length < 3) {
      setErrorMsg('Title must be at least 3 characters.');
      return;
    }
    if (description.trim().length < 5) {
      setErrorMsg('Description must be at least 5 characters.');
      return;
    }
    if (!locality || locality.trim().length === 0) {
      setErrorMsg('Please specify a neighborhood locality (e.g. Wakad, Aundh, Baner, Kothrud) to lodge your report.');
      return;
    }
    if (locationText.trim().length === 0) {
      setErrorMsg('Location landmark / description is required.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      // 2. Prepare report document structure
      const reportsCollection = collection(db, 'reports');
      const rDocRef = doc(reportsCollection);
      const reportId = rDocRef.id;

      // 3. Write multiple compressed images directly to reports/{reportId}/images/{autoId}
      const hasImgBool = compressedImages.length > 0;
      if (hasImgBool) {
        // Fallback for single legacy photo systems
        const legacyImageDocRef = doc(db, 'reportImages', reportId);
        try {
          await setDoc(legacyImageDocRef, {
            imageData: compressedImages[0]
          });
        } catch (imageErr: any) {
          console.error('Failed to write legacy photo doc:', imageErr);
        }

        // Write each photo to subcollection with an index order
        for (let i = 0; i < compressedImages.length; i++) {
          const base64Data = compressedImages[i];
          const subcollDocRef = doc(collection(db, 'reports', reportId, 'images'));
          await setDoc(subcollDocRef, {
            data: base64Data,
            order: i
          });
        }
      }

      // 4. Create database payload
      const reportData: any = {
        id: reportId,
        createdBy: user.uid,
        createdByName: user.displayName || 'Civic Champion',
        createdAt: serverTimestamp(),
        title: title.trim(),
        description: description.trim(),
        department,
        subcategory,
        severity,
        status: 'Reported',
        locationText: locationText.trim(),
        locality: locality.trim(),
        city: city.trim(),
        lat: coords ? coords.lat : null,
        lng: coords ? coords.lng : null,
        locationEdited: locationEdited,
        hasGps: hasGps,
        photoUrl: hasImgBool ? 'placeholder' : null,
        hasImage: hasImgBool,
        imageCount: compressedImages.length,
        verificationCount: 0,
        commentCount: 0,
        flagCount: 0,
        aiTagged: aiTagged
      };

      // Set optional AI fields if they exist
      if (priorityScore !== undefined) reportData.priorityScore = priorityScore;
      if (priorityReason !== undefined) reportData.priorityReason = priorityReason;
      if (estimatedImpact !== undefined) reportData.estimatedImpact = estimatedImpact;
      if (isValidCivicIssue !== undefined) reportData.isValidCivicIssue = isValidCivicIssue;
      if (validityReason !== undefined) reportData.validityReason = validityReason;
      if (confidence !== undefined) reportData.confidence = confidence;

      // 5. Save report atomically
      await setDoc(rDocRef, reportData);

      // 6. Award reporter points or increment user reportsCount
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        reportsCount: increment(1)
      }).catch(err => console.warn('User counter update deferred:', err));

      // Trigger badge evaluation (non-blocking)
      evaluateAndAwardBadges(user.uid).catch(() => {});

      // Reset form on success
      setTitle('');
      setDescription('');
      setDepartment('Roads');
      setSubcategory('Pothole');
      setSeverity('Medium');
      setLocality('');
      setSelectedDropdownValue('');
      setCustomLocalityText('');
      setLocationText('');
      setCompressedImages([]);
      setImageWarningMsg(null);
      setAiWarning(null);
      setAiFeedback(null);
      setAiTagged(false);
      
      setPriorityScore(undefined);
      setPriorityReason(undefined);
      setEstimatedImpact(undefined);
      setIsValidCivicIssue(undefined);
      setValidityReason(undefined);
      setConfidence(undefined);

      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
        if (onSuccess) onSuccess();
      }, 1000);

    } catch (err: any) {
      console.error('Failed to submit report:', err);
      setErrorMsg(err.message || 'Verification of Firestore rules or network failed. Please try again.');
      try {
        handleFirestoreError(err, OperationType.CREATE, 'reports');
      } catch (_) {}
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-650 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="flex items-center space-x-2.5 mb-5 border-b border-slate-50 pb-3">
          <div className="h-9 w-9 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-sans text-[15px] font-black text-slate-900 uppercase tracking-wide">
              Lodge Neighborhood Hazard
            </h3>
            <p className="font-sans text-[10px] text-slate-400 mt-0.5">
              Empower public safety with Intelligent Intake
            </p>
          </div>
        </div>

        {/* Form Body */}
        <form id={formId} onSubmit={handleSubmit} className="space-y-4">
          {/* If HEIC conversion is in progress */}
          {isConvertingImage && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 flex items-center space-x-3 text-indigo-850 animate-pulse">
              <Loader2 className="h-5 w-5 animate-spin text-indigo-600 shrink-0" />
              <div className="font-sans text-xs">
                <span className="font-bold">Converting image...</span>
                <p className="text-[10px] text-indigo-500 mt-0.5 font-medium leading-relaxed font-sans">
                  Converting iPhone HEIC photo to JPEG for processing...
                </p>
              </div>
            </div>
          )}

          {/* If AI analyzed or is analyzing, show an elegant badge */}
          {isAnalyzingImage && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 flex items-center space-x-3 text-indigo-850 animate-pulse">
              <Loader2 className="h-5 w-5 animate-spin text-indigo-600 shrink-0" />
              <div className="font-sans text-xs">
                <span className="font-bold">
                  {retryingMsg 
                    ? "Analyzing with AI… (retrying)" 
                    : "AI Intelligent Intake is diagnosing your photo..."}
                </span>
                <p className="text-[10px] text-indigo-500 mt-0.5 font-medium leading-relaxed font-sans">
                  {retryingMsg 
                    ? "Model is busy; automatically retrying transient server connection..." 
                    : "Categorizing issue, measuring gravity level, and sizing affected demographic"}
                </p>
              </div>
            </div>
          )}

          {aiError && (
            <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-3 flex items-start justify-between space-x-3 text-rose-900">
              <div className="flex items-start space-x-2.5">
                <AlertTriangle className="h-4.5 w-4.5 text-rose-600 shrink-0 mt-0.5" />
                <div className="font-sans text-xs">
                  <span className="font-bold">AI analysis is busy right now</span>
                  <p className="text-[10px] text-rose-600 mt-0.5 font-medium leading-normal font-sans">You can fill the form manually or click retry to attempt again.</p>
                </div>
              </div>
              {compressedImages.length > 0 && (
                <button
                  type="button"
                  onClick={handleRetryAi}
                  disabled={isAnalyzingImage}
                  className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-white border border-rose-200 text-rose-700 rounded-lg hover:bg-rose-50 transition-colors font-sans text-[10px] font-semibold shadow-xs shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className="h-3 w-3 shrink-0" />
                  <span>Retry AI</span>
                </button>
              )}
            </div>
          )}

          {aiFeedback && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/55 p-3 flex items-start space-x-2.5 text-indigo-900">
              <Sparkles className="h-4.5 w-4.5 text-indigo-600 shrink-0 mt-0.5" />
              <div className="font-sans text-[11px] leading-relaxed">
                <span className="font-bold">Intelligent Intake analysis complete:</span>
                <p className="text-slate-550 mt-0.5 font-medium">{aiFeedback}</p>
              </div>
            </div>
          )}

          {aiWarning && (
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-3.5 flex items-start space-x-2 text-amber-850">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-605" />
              <div className="font-sans text-[11px] leading-relaxed">
                <span className="font-bold text-amber-900">Visual Quality Note:</span>
                <p className="text-amber-700 mt-0.5 font-medium">{aiWarning}</p>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="rounded-xl border border-rose-100 bg-rose-50 p-3 flex items-start space-x-2 text-rose-850">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-600" />
              <div className="font-sans text-[11px] leading-normal">{errorMsg}</div>
            </div>
          )}

          {infoMsg && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 flex items-start space-x-2 text-indigo-850">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-indigo-600" />
              <div className="font-sans text-[11px] leading-normal">{infoMsg}</div>
            </div>
          )}

          {/* Title Field */}
          <div>
            <label className="block font-sans text-xs font-semibold text-gray-700">
              Issue Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Broken streetlamp or deep pothole"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setAiTagged(false);
              }}
              className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.8 font-sans text-xs text-gray-805 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/10 transition-colors"
            />
          </div>

          {/* Description Field */}
          <div>
            <label className="block font-sans text-xs font-semibold text-gray-700">
              Describe the Hazard <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={3}
              placeholder="Provide clean landmarks, size details, and hazard indicators..."
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setAiTagged(false);
              }}
              className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.8 font-sans text-xs text-gray-805 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/10 transition-colors resize-none"
            />
          </div>

          {/* Area, Department, Subcategory selectors */}
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label className="block font-sans text-xs font-semibold text-gray-700">
                Locality / Area <span className="text-red-500">*</span>
              </label>
              <div className="relative mt-1">
                <select
                  required
                  value={selectedDropdownValue}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedDropdownValue(val);
                    setLocationEdited(true);
                    if (val === 'Other') {
                      setLocality(customLocalityText);
                    } else {
                      setLocality(val);
                    }
                  }}
                  className="block w-full rounded-lg border border-gray-200 pl-8 pr-10 py-1.8 font-sans text-xs text-gray-800 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/10 transition-colors bg-white appearance-none cursor-pointer"
                >
                  <option value="" disabled>Select locality...</option>
                  {localities.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                  <option value="Other">Other (Type custom area)</option>
                </select>
                <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-indigo-500 pointer-events-none" />
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                  <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20">
                    <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                  </svg>
                </div>
              </div>
              {selectedDropdownValue === 'Other' && (
                <div className="relative mt-2">
                  <input
                    type="text"
                    required
                    placeholder="Type custom area..."
                    value={customLocalityText}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCustomLocalityText(val);
                      setLocality(val);
                      setLocationEdited(true);
                    }}
                    className="block w-full rounded-lg border border-gray-200 pl-8 pr-3 py-1.8 font-sans text-xs text-gray-800 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/10 transition-colors"
                  />
                  <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-indigo-500" />
                </div>
              )}
            </div>

            <div>
              <label className="block font-sans text-xs font-semibold text-gray-700">
                Department
              </label>
              <select
                value={department}
                onChange={(e) => handleDepartmentChange(e.target.value as Department)}
                className="mt-1 block w-full rounded-lg border border-gray-200 px-2.5 py-1.8 font-sans text-xs text-gray-800 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/10 cursor-pointer"
              >
                {Object.keys(DEPARTMENT_SUBCATEGORIES).map((dept) => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label className="block font-sans text-xs font-semibold text-gray-700">
                Subcategory
              </label>
              <select
                value={subcategory}
                onChange={(e) => handleSubcategoryChange(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-200 px-2.5 py-1.8 font-sans text-xs text-gray-800 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/10 cursor-pointer"
              >
                {(DEPARTMENT_SUBCATEGORIES[department] || []).map((subcat) => (
                  <option key={subcat} value={subcat}>{subcat}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-sans text-xs font-semibold text-gray-700">
                Severity Level
              </label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as IssueSeverity)}
                className="mt-1 block w-full rounded-lg border border-gray-200 px-2.5 py-1.8 font-sans text-xs text-gray-800 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/10 cursor-pointer"
              >
                {severities.map(sev => (
                  <option key={sev} value={sev}>{sev}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block font-sans text-xs font-semibold text-gray-700">
              Location landmark <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-1">
              <input
                type="text"
                required
                placeholder="e.g. Near Star Bazaar lane"
                value={locationText}
                onChange={(e) => {
                  setLocationText(e.target.value);
                  setLocationEdited(true);
                }}
                className="block w-full rounded-lg border border-gray-200 pl-8 pr-3 py-1.8 font-sans text-xs text-gray-800 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/10 transition-colors"
              />
              <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            </div>
          </div>

          {/* GPS Status & Re-detect Panel */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-2.5 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {isDetecting ? (
                <div className="flex items-center space-x-1.5 font-mono text-[10px] text-slate-500 font-bold uppercase tracking-wider animate-pulse">
                  <Loader2 className="h-3 w-3 animate-spin text-indigo-600" />
                  <span>Detecting GPS Location...</span>
                </div>
              ) : coords && hasGps && !locationEdited ? (
                <div className="flex items-center space-x-1.5 font-mono text-[10px] text-emerald-600 font-bold uppercase tracking-wider bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping shrink-0" />
                  <span>GPS LOCKED</span>
                </div>
              ) : (
                <div className="flex items-center space-x-1.5 font-mono text-[10px] text-slate-500 font-bold uppercase tracking-wider bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-sm">
                  <span>location entered manually</span>
                </div>
              )}
            </div>
            
            <button
              type="button"
              disabled={isDetecting}
              onClick={detectLocation}
              className="flex items-center space-x-1 px-2.5 py-1 text-[10px] font-sans font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50/60 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${isDetecting ? 'animate-spin' : ''}`} />
              <span>Re-detect GPS</span>
            </button>
          </div>

          {/* Draggable Map Pin Picker */}
          {coords && (
            <div className="space-y-1.5">
              <label className="block font-sans text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                Fine-tune Incident Spot (Drag Pin)
              </label>
              <PinPickerMap 
                lat={coords.lat} 
                lng={coords.lng} 
                onCoordinatesChange={handleCoordinatesChange}
                onLocalityDetected={handleLocalityDetected}
              />
            </div>
          )}

          {!coords && !isDetecting && (
            <div className="text-[10px] font-sans text-amber-700 bg-amber-50/50 border border-amber-100 rounded-lg p-2.5">
              💡 GPS unavailable. Please type your neighborhood locality manually (e.g. Wakad, Aundh, Baner, Kothrud) and Landmark details.
            </div>
          )}

          {/* Drag & Drop Media Attachments */}
          <div>
            <label className="block font-sans text-xs font-semibold text-gray-700 mb-1">
              Attach Road/Civic Photo <span className="text-slate-400 font-normal">(Camera capture supported)</span>
            </label>
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-xl border border-dashed p-4 text-center cursor-pointer transition-colors ${
                isDragActive 
                  ? 'border-indigo-500 bg-indigo-50/40' 
                  : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-350'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="flex flex-col items-center space-y-1.5 text-slate-550">
                {isConvertingImage ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin text-indigo-650" />
                    <p className="font-sans text-xs font-bold text-indigo-600 uppercase tracking-wider animate-pulse">
                      Converting image...
                    </p>
                    <p className="font-sans text-[10px] text-slate-400">
                      Converting iPhone HEIC format to standard JPEG format...
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex space-x-2.5 text-slate-450">
                      <ImageIcon className="h-5 w-5 text-indigo-500" />
                      <Camera className="h-5 w-5 text-emerald-500" />
                    </div>
                    <p className="font-sans text-xs font-medium text-slate-700">
                      Drag & Drop photos here, or <span className="text-indigo-600 underline">browse / select files</span>
                    </p>
                    <p className="font-sans text-[10px] text-slate-400">
                      Attach up to 5 photos. The first photo is used for AI intake.
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* Video warning note message */}
            {imageWarningMsg && (
              <div className="mt-2.5 rounded-xl border border-amber-100 bg-amber-50 p-3.5 flex items-start space-x-2 text-amber-850">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                <div className="font-sans text-[11px] leading-normal">{imageWarningMsg}</div>
              </div>
            )}

            {/* Compressed Multiple Images Thumbnails List */}
            {compressedImages.length > 0 && (
              <div className="mt-3.5 space-y-2">
                <p className="font-sans text-[10px] font-bold text-indigo-600 uppercase tracking-wider">
                  Images Attached ({compressedImages.length} of 5)
                </p>
                <div className="flex flex-wrap gap-2.5">
                  {compressedImages.map((imgSrc, idx) => (
                    <div key={idx} className="relative h-18 w-18 group rounded-lg overflow-hidden border border-slate-200 bg-black shadow-xs shrink-0 select-none">
                      <img src={imgSrc} alt={`Preview ${idx + 1}`} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveImage(idx);
                        }}
                        className="absolute top-1 right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-slate-900/75 text-white hover:bg-slate-950 transition-colors cursor-pointer"
                        title="Remove photo"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                      <span className="absolute bottom-0.5 left-0.5 text-[8px] bg-slate-900/80 text-white px-1 leading-normal rounded-sm uppercase tracking-wider font-bold">
                        {idx === 0 ? 'AI Intake' : `Doc ${idx + 1}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* AI-powered Duplicate Check Panel */}
          {isCheckingDuplicates && (
            <div className="flex items-center space-x-2.5 rounded-xl border border-indigo-100 bg-indigo-50/35 p-3.5 text-indigo-850 animate-pulse">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600 shrink-0" />
              <span className="font-sans text-[11px] font-bold uppercase tracking-wider text-indigo-700">Checking for existing reports...</span>
            </div>
          )}

          {duplicateMatch && !userDismissedDuplicate && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-3.5 shadow-xs">
              <div className="flex items-start space-x-3">
                <AlertTriangle className="h-4.5 w-4.5 text-amber-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-sans text-xs font-bold text-amber-900 leading-none">
                    This may already be reported
                  </h4>
                  <p className="font-sans text-[11px] text-slate-600 leading-normal">
                    AI detected a matching unresolved report: <span className="font-semibold text-slate-800">"{duplicateMatch.title}"</span> located <span className="font-semibold text-slate-800">{Math.round(duplicateMatch.distance)} meters away</span>.
                  </p>
                </div>
              </div>

              {/* Matched Issue Mini Card */}
              <div className="flex items-center space-x-3 bg-white border border-slate-100 p-2.5 rounded-xl">
                {duplicateMatch.photoUrl ? (
                  <div className="h-12 w-12 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                    <img 
                      src={duplicateMatch.photoUrl} 
                      alt="Matched issue preview" 
                      className="h-full w-full object-cover" 
                      referrerPolicy="no-referrer"
                    />
                  </div>
                ) : (
                  <div className="h-12 w-12 rounded-lg bg-slate-100 border border-slate-200 shrink-0 flex items-center justify-center">
                    <MapPin className="h-5 w-5 text-slate-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-sans text-xs font-bold text-slate-900 truncate">
                    {duplicateMatch.title}
                  </p>
                  <p className="font-sans text-[10px] text-slate-500 truncate leading-relaxed">
                    {duplicateMatch.description}
                  </p>
                  <p className="font-sans text-[9px] text-indigo-600 font-bold tracking-tight mt-0.5">
                    Match Confidence: {Math.round(duplicateMatch.confidence * 100)}%
                  </p>
                </div>
              </div>

              {/* Non-blocking Choices */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleVerifyExistingReport}
                  className="flex-1 flex items-center justify-center space-x-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 font-sans text-xs font-bold shadow-xs cursor-pointer transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  <span>Verify existing report instead</span>
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setUserDismissedDuplicate(true)}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 font-sans text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  Report anyway
                </button>
              </div>
            </div>
          )}

          {/* Submitting Status indicator */}
          {loading && (
            <div className="space-y-1 bg-slate-50/60 p-3 rounded-lg border border-slate-100">
              <div className="flex items-center text-[10px] text-slate-500">
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-indigo-600 shrink-0" />
                <span className="font-medium">Publishing report & updating live feed...</span>
              </div>
            </div>
          )}

          {/* Form Actions footer */}
          <div className="flex items-center justify-end space-x-2.5 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-lg border border-slate-200 px-4 py-2 font-sans text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || isCheckingDuplicates}
              className="flex items-center space-x-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 font-sans text-xs font-bold shadow-sm cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : isCheckingDuplicates ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin animate-spin" />
                  <span>Checking for existing reports...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Lodge Alert</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
