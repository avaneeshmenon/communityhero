import React, { useState, useEffect, useId } from 'react';
import { 
  doc, 
  writeBatch, 
  getDoc, 
  updateDoc, 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  serverTimestamp,
  increment,
  arrayUnion,
  getDocs,
  deleteDoc,
  Timestamp,
  runTransaction,
  setDoc
} from 'firebase/firestore';
import { 
  MapPin, 
  ThumbsUp, 
  Calendar, 
  Flame, 
  MessageSquare, 
  CheckCircle2, 
  Tv, 
  Play, 
  User as UserIcon, 
  ChevronRight, 
  CornerDownRight, 
  Send,
  Loader2,
  Sparkles,
  Trash2,
  AlertTriangle,
  Droplet,
  Lightbulb,
  HelpCircle,
  Construction,
  Shield,
  PawPrint,
  Leaf,
  Building2,
  Flag,
  Camera,
  Check,
  ShieldAlert
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { evaluateAndAwardBadges, sendNotification } from '../lib/badgeService';
import { Report, Comment, Reply, UserDoc, IssueStatus } from '../types';
import { User } from 'firebase/auth';
import { generateEscalationTrailStep } from '../lib/escalationTrailService';
import { isHeicFile, convertHeicToJpeg } from '../lib/heicConverter';

interface ReportCardProps {
  key?: string;
  report: Report;
  user: User | null;
  currentUserDoc: UserDoc | null;
  onSelect?: (id: string) => void;
  onDeleted?: () => void;
  onUserClick?: (uid: string) => void;
}

export default function ReportCard({ report, user, currentUserDoc, onSelect, onDeleted, onUserClick }: ReportCardProps) {
  const cardId = useId();
  
  const stage0Action = report.authorityActions?.find(a => a.stage === 0);
  const currentEscStage = report.authorityActions?.length ? Math.max(...report.authorityActions.map(act => act.stage)) : 0;

  // Interaction states
  const [hasVerified, setHasVerified] = useState(false);
  const [checkingVerification, setCheckingVerification] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [subcollectionVoteCount, setSubcollectionVoteCount] = useState<number | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Flag / Spam States
  const [hasFlagged, setHasFlagged] = useState(false);
  const [checkingFlag, setCheckingFlag] = useState(false);
  const [subcollectionFlagCount, setSubcollectionFlagCount] = useState<number | null>(null);
  const [flagging, setFlagging] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const [flagError, setFlagError] = useState<string | null>(null);

  // States for resolving issues & After image upload
  const [showResolveForm, setShowResolveForm] = useState(false);
  const [afterImageFile, setAfterImageFile] = useState<string | null>(null);
  const [compressingAfter, setCompressingAfter] = useState(false);
  const [isConvertingAfter, setIsConvertingAfter] = useState(false);

  // NEW: Multi-after photo states
  const [selectedAfterImages, setSelectedAfterImages] = useState<string[]>([]);
  const [isSubmittingAfter, setIsSubmittingAfter] = useState(false);
  const [afterUploadError, setAfterUploadError] = useState<string | null>(null);
  const [afterImages, setAfterImages] = useState<{ id: string; data: string; order: number }[]>([]);

  // Comments Thread states
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [replyText, setReplyText] = useState<{ [commentId: string]: string }>({});
  const [activeReplyBox, setActiveReplyBox] = useState<string | null>(null);

  // Lazy Loaded Image states
  const [lazyImage, setLazyImage] = useState<string | null>(null);
  const [lazyAfterImage, setLazyAfterImage] = useState<string | null>(null);
  const [loadingImage, setLoadingImage] = useState(false);

  // AI Complaint Agent states
  const [generatingComplaint, setGeneratingComplaint] = useState(false);
  const [complaintError, setComplaintError] = useState<string | null>(null);

  const handleGenerateComplaint = async () => {
    if (!user || !report) return;
    setGeneratingComplaint(true);
    setComplaintError(null);
    try {
      await generateEscalationTrailStep(report, 0, user.uid);
    } catch (err: any) {
      console.error("Manual complaint generation failed:", err);
      setComplaintError(err.message || "Failed to generate complaint");
    } finally {
      setGeneratingComplaint(false);
    }
  };

  // Fetch image data lazily from Firestore (subcollection with legacy fallback)
  useEffect(() => {
    if (!report.id) return;

    if (report.hasImage) {
      setLoadingImage(true);
      // Query the nested subcollection reports/{reportId}/images ordered by order
      const imagesColl = collection(db, 'reports', report.id, 'images');
      const q = query(imagesColl, orderBy('order', 'asc'));

      getDocs(q)
        .then((snapshot) => {
          if (!snapshot.empty) {
            // Take the first image (order 0)
            const firstImg = snapshot.docs[0].data();
            setLazyImage(firstImg.data || null);
          } else {
            // Fallback to legacy reportImages doc
            const docRef = doc(db, 'reportImages', report.id);
            getDoc(docRef)
              .then((snap) => {
                if (snap.exists()) {
                  setLazyImage(snap.data().imageData || null);
                } else {
                  setLazyImage(null);
                }
              })
              .catch(() => {
                setLazyImage(null);
              });
          }
        })
        .catch((err) => {
          console.warn('Failed querying subcollection images:', err);
          // Standard fallback
          const docRef = doc(db, 'reportImages', report.id);
          getDoc(docRef).then((snap) => {
            if (snap.exists()) {
              setLazyImage(snap.data().imageData || null);
            }
          });
        })
        .finally(() => {
          setLoadingImage(false);
        });
    } else if (report.photoUrl && report.photoUrl !== 'placeholder') {
      // Legacy data support
      setLazyImage(report.photoUrl);
    } else {
      setLazyImage(null);
    }

    // Query afterImages subcollection if status is Resolved
    if (report.status === 'Resolved') {
      const afterColl = collection(db, 'reports', report.id, 'afterImages');
      const qAfter = query(afterColl, orderBy('order', 'asc'));
      getDocs(qAfter)
        .then((snapshot) => {
          if (!snapshot.empty) {
            const loaded: { id: string; data: string; order: number }[] = [];
            snapshot.forEach((docSnap) => {
              const d = docSnap.data();
              loaded.push({
                id: docSnap.id,
                data: d.data || '',
                order: d.order || 0
              });
            });
            setAfterImages(loaded);
            setLazyAfterImage(loaded[0].data || null);
          } else {
            // Fallback to legacy reportImages doc for afterImageData
            const docRef = doc(db, 'reportImages', report.id);
            getDoc(docRef)
              .then((snap) => {
                if (snap.exists()) {
                  const data = snap.data();
                  setLazyAfterImage(data.afterImageData || null);
                  if (data.afterImageData) {
                    setAfterImages([{ id: 'legacy-after', data: data.afterImageData, order: 0 }]);
                  } else {
                    setAfterImages([]);
                  }
                } else {
                  setLazyAfterImage(null);
                  setAfterImages([]);
                }
              })
              .catch(() => {
                setLazyAfterImage(null);
                setAfterImages([]);
              });
          }
        })
        .catch((err) => {
          console.warn('Failed querying afterImages subcollection:', err);
          setLazyAfterImage(null);
          setAfterImages([]);
        });
    } else {
      setLazyAfterImage(null);
      setAfterImages([]);
    }
  }, [report.id, report.hasImage, report.photoUrl, report.status]);

  // Check if active user already clicked upvote/verify (Real-time Sync)
  useEffect(() => {
    if (!user || !report.id) {
      setHasVerified(false);
      setCheckingVerification(false);
      return;
    }
    setCheckingVerification(true);
    const vRef = doc(db, 'reports', report.id, 'verifications', user.uid);
    const unsubscribe = onSnapshot(
      vRef,
      (snapshot) => {
        setHasVerified(snapshot.exists());
        setCheckingVerification(false);
      },
      (err) => {
        console.error('Error listening to verification flag:', err);
        setCheckingVerification(false);
      }
    );
    return () => unsubscribe();
  }, [user, report.id]);

  // Real-time listener for subcollection count (ensures displayed count is 100% accurate)
  useEffect(() => {
    if (!report.id) return;
    const verificationsCol = collection(db, 'reports', report.id, 'verifications');
    const unsubscribe = onSnapshot(
      verificationsCol,
      (snapshot) => {
        setSubcollectionVoteCount(snapshot.size);
      },
      (err) => {
        console.error('Error listening to verifications count:', err);
      }
    );
    return () => unsubscribe();
  }, [report.id]);

  // Check if active user already flagged (Real-time Sync)
  useEffect(() => {
    if (!user || !report.id) {
      setHasFlagged(false);
      setCheckingFlag(false);
      return;
    }
    setCheckingFlag(true);
    const fRef = doc(db, 'reports', report.id, 'flags', user.uid);
    const unsubscribe = onSnapshot(
      fRef,
      (snapshot) => {
        setHasFlagged(snapshot.exists());
        setCheckingFlag(false);
      },
      (err) => {
        console.error('Error listening to flag status:', err);
        setCheckingFlag(false);
      }
    );
    return () => unsubscribe();
  }, [user, report.id]);

  // Real-time listener for flags subcollection count
  useEffect(() => {
    if (!report.id) return;
    const flagsCol = collection(db, 'reports', report.id, 'flags');
    const unsubscribe = onSnapshot(
      flagsCol,
      (snapshot) => {
        setSubcollectionFlagCount(snapshot.size);
      },
      (err) => {
        console.error('Error listening to flags count:', err);
      }
    );
    return () => unsubscribe();
  }, [report.id]);

  // Real-time listener for comments of this specific card
  useEffect(() => {
    if (!showComments || !report.id) return;
    setLoadingComments(true);
    const commentsCol = collection(db, 'reports', report.id, 'comments');
    const q = query(commentsCol, orderBy('createdAt', 'asc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Comment[] = [];
        snapshot.forEach((snap) => {
          list.push({
            id: snap.id,
            ...snap.data({ serverTimestamps: 'estimate' }),
          } as Comment);
        });
        setComments(list);
        setLoadingComments(false);
      },
      (err) => {
        console.error('Error listening to comments:', err);
        setLoadingComments(false);
      }
    );
    return () => unsubscribe();
  }, [showComments, report.id]);

  // Upvote/Verification Toggle Handler with gamified points redistribution, including symmetrical unvote reversion
  const handleVerify = async () => {
    if (!user || !report.id) {
      console.warn("handleVerify: Missing user or report ID");
      return;
    }
    if (verifying) return;

    setVerifying(true);
    console.log("[handleVerify] Starting verification transaction for report:", report.id, "user:", user.uid);

    const reportRef = doc(db, 'reports', report.id);
    const verificationRef = doc(db, 'reports', report.id, 'verifications', user.uid);
    const reporterId = report.createdBy || 'unknown_reporter';
    const reporterUserRef = doc(db, 'users', reporterId);
    const verifierRef = doc(db, 'users', user.uid);
    const isSelfVerification = report.createdBy === user.uid;
    let shouldAutoGenerateComplaint = false;
    let existedBefore = false;

    // Fetch flags subcollection snapshot to unflag if the post gets verified
    const flagsColRef = collection(db, 'reports', report.id, 'flags');
    let flagsSnapshot: any = null;
    try {
      flagsSnapshot = await getDocs(flagsColRef);
    } catch (e) {
      console.warn("Failed to fetch flags before verification transaction:", e);
    }

    try {
      await runTransaction(db, async (transaction) => {
        console.log("[handleVerify] Inside transaction callback. Fetching docs...");
        
        const reportDoc = await transaction.get(reportRef);
        const verificationDoc = await transaction.get(verificationRef);
        const reporterSnap = await transaction.get(reporterUserRef);
        const verifierSnap = await transaction.get(verifierRef);

        if (!reportDoc.exists()) {
          throw new Error("Report does not exist!");
        }

        const reportData = reportDoc.data();
        const currentCount = reportData.verificationCount || 0;
        const currentFlags = reportData.flagCount || 0;
        const oldStatus = reportData.status || 'Reported';
        const exists = verificationDoc.exists();
        existedBefore = exists;

        let nextCount = currentCount;
        let newStatus = oldStatus;
        let nextFlags = currentFlags;

        if (!exists) {
          console.log("[handleVerify] Voting ON. Creating verification doc...");
          transaction.set(verificationRef, {
            verifiedBy: user.uid,
            verifiedByName: user.displayName || 'Neighbor',
            verifiedAt: serverTimestamp(),
          });

          nextCount = currentCount + 1;
          if (nextCount >= 3) {
            shouldAutoGenerateComplaint = true;
          }
        } else {
          console.log("[handleVerify] Voting OFF. Deleting verification doc...");
          transaction.delete(verificationRef);

          nextCount = Math.max(0, currentCount - 1);
        }

        // Compute new status
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

        // Unflag verified posts: if they were flagged before, clear all flags
        if (newStatus === 'Verified') {
          nextFlags = 0;
          if (flagsSnapshot) {
            flagsSnapshot.forEach((fDoc: any) => {
              transaction.delete(fDoc.ref);
            });
          }
        }

        // Apply reporter & verifier point changes
        let reporterPointsChange = 0;
        let verifierPointsChange = 0;

        if (!isSelfVerification) {
          // Vote/unvote baseline adjustments
          if (!exists) {
            reporterPointsChange += 2;
            verifierPointsChange += 1;
          } else {
            reporterPointsChange -= 2;
            verifierPointsChange -= 1;
          }

          // Symmetrical point transitions based on status changes (excluding Under Review to avoid reducing points)
          if (oldStatus !== 'Verified' && newStatus === 'Verified') {
            reporterPointsChange += 10;
          }
          if (oldStatus === 'Verified' && newStatus !== 'Verified') {
            reporterPointsChange -= 10;
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
            verificationsGiven: increment(!exists ? 1 : -1),
          });
        }
      });

      console.log("[handleVerify] Transaction committed successfully!");

      try {
        if (!existedBefore) {
          if (reporterId && reporterId !== user.uid) {
            await sendNotification(
              reporterId,
              'verify',
              `${user.displayName || 'Someone'} verified your report: "${report.title || ''}"`,
              report.id
            );

            const wasVerified = (report.verificationCount || 0) < 3 && ((report.verificationCount || 0) + 1) >= 3;
            if (wasVerified) {
              await sendNotification(
                reporterId,
                'verify',
                `Your report "${report.title || ''}" has reached Verified status!`,
                report.id
              );
            }
          }
        }

        evaluateAndAwardBadges(user.uid).catch(() => {});
        if (reporterId && reporterId !== user.uid) {
          evaluateAndAwardBadges(reporterId).catch(() => {});
        }
      } catch (notifErr) {
        console.warn('Verification notification/badge award failed:', notifErr);
      }

      // Automatic complaint generation trigger when transitioning to Verified
      const hasStage0 = report.authorityActions?.some(a => a.stage === 0);
      if (shouldAutoGenerateComplaint && !hasStage0) {
        console.log("[handleVerify] Automatically generating complaint as report has reached Verified status!");
        setGeneratingComplaint(true);
        generateEscalationTrailStep(report, 0, user.uid)
          .catch((err) => {
            console.error("Auto-complaint generation failed:", err);
            setComplaintError(err.message || 'Auto-generation failed. You can retry manually.');
          })
          .finally(() => {
            setGeneratingComplaint(false);
          });
      }
    } catch (err: any) {
      console.error('[handleVerify] Transaction failed:', err);
      try {
        handleFirestoreError(err, OperationType.UPDATE, `reports/${report.id}/verifications`);
      } catch (_) {}
    } finally {
      setVerifying(false);
    }
  };

  // Flag/Unflag Toggle Handler with symmetric transitions and reporter points adjustments
  const handleToggleFlag = async (reason?: string) => {
    if (!user || !report.id) return;
    if (report.createdBy === user.uid) {
      setFlagError("You cannot flag your own report");
      return;
    }
    if (flagging) return;

    setFlagging(true);
    setFlagError(null);

    const reportRef = doc(db, 'reports', report.id);
    const flagRef = doc(db, 'reports', report.id, 'flags', user.uid);
    const reporterId = report.createdBy || 'unknown_reporter';
    const reporterUserRef = doc(db, 'users', reporterId);

    let isFlaggedNow = false;
    let isUnderReviewNow = false;
    let isRescuedNow = false;

    try {
      await runTransaction(db, async (transaction) => {
        const reportDoc = await transaction.get(reportRef);
        const flagDoc = await transaction.get(flagRef);
        const reporterSnap = await transaction.get(reporterUserRef);

        if (!reportDoc.exists()) {
          throw new Error("Report does not exist!");
        }

        const reportData = reportDoc.data();
        const currentFlags = reportData.flagCount || 0;
        const currentVerifications = reportData.verificationCount || 0;
        const oldStatus = reportData.status || 'Reported';
        const exists = flagDoc.exists();

        let nextFlags = currentFlags;
        let newStatus = oldStatus;

        if (!exists) {
          // Creating flag document
          transaction.set(flagRef, {
            flaggedBy: user.uid,
            flaggedByName: user.displayName || 'Neighbor',
            flaggedAt: serverTimestamp(),
            reason: reason || 'Not Specified'
          });
          nextFlags = currentFlags + 1;
          isFlaggedNow = true;
        } else {
          // Deleting flag document
          transaction.delete(flagRef);
          nextFlags = Math.max(0, currentFlags - 1);
        }

        // Compute new status
        if (oldStatus === 'Reported' || oldStatus === 'Under Review') {
          if (currentVerifications >= 3) {
            newStatus = 'Verified';
          } else if (nextFlags >= 3) {
            newStatus = 'Under Review';
            if (!exists) {
              isUnderReviewNow = true;
            }
          } else {
            newStatus = 'Reported';
            if (exists && oldStatus === 'Under Review') {
              isRescuedNow = true;
            }
          }
        }

        // Symmetrical point transitions based on status changes (excluding Under Review to avoid reducing points)
        let reporterPointsChange = 0;

        if (oldStatus !== 'Verified' && newStatus === 'Verified') {
          reporterPointsChange += 10;
        }
        if (oldStatus === 'Verified' && newStatus !== 'Verified') {
          reporterPointsChange -= 10;
        }

        const updateFields: any = {
          flagCount: nextFlags,
          status: newStatus,
          underReview: newStatus === 'Under Review'
        };

        if (oldStatus !== 'Verified' && newStatus === 'Verified') {
          updateFields.verifiedAt = serverTimestamp();
        }

        transaction.update(reportRef, updateFields);

        if (reporterSnap.exists() && reporterPointsChange !== 0) {
          const currentRepPoints = reporterSnap.data().impactPoints || 0;
          const finalRepPoints = Math.max(0, currentRepPoints + reporterPointsChange);
          transaction.update(reporterUserRef, {
            impactPoints: finalRepPoints,
          });
        }
      });
      console.log("[handleToggleFlag] Flag toggled successfully!");

      try {
        if (reporterId && reporterId !== user.uid) {
          if (isFlaggedNow) {
            await sendNotification(
              reporterId,
              'flag',
              `Your report "${report.title || ''}" was flagged by a user.`,
              report.id
            );
            if (isUnderReviewNow) {
              await sendNotification(
                reporterId,
                'review',
                `Your report "${report.title || ''}" is now Under Review due to flags.`,
                report.id
              );
            }
          } else if (isRescuedNow) {
            await sendNotification(
              reporterId,
              'rescue',
              `Your report "${report.title || ''}" has been rescued and returned to the active stream!`,
              report.id
            );
          }
        }

        evaluateAndAwardBadges(user.uid).catch(() => {});
        if (reporterId && reporterId !== user.uid) {
          evaluateAndAwardBadges(reporterId).catch(() => {});
        }
      } catch (notifErr) {
        console.warn('Flag notification/badge award failed:', notifErr);
      }
    } catch (err: any) {
      console.error("[handleToggleFlag] Error:", err);
      setFlagError(err.message || String(err));
    } finally {
      setFlagging(false);
    }
  };

  // State to control inline deletion confirmation
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Trigger confirmation display
  const handleDeleteTrigger = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowConfirmDelete(true);
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowConfirmDelete(false);
  };

  // State to control inline spam confirmation
  const [showConfirmSpam, setShowConfirmSpam] = useState(false);
  const [spamError, setSpamError] = useState<string | null>(null);

  const handleSpamTrigger = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowConfirmSpam(true);
  };

  const handleCancelSpam = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowConfirmSpam(false);
  };

  // Delete Report Handler - Owner Only - Deletes report, reportImages, verifications, and comments subcollections
  const executeDeleteReport = async (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    if (!user || report.createdBy !== user.uid) return;

    try {
      setDeleteError(null);
      // 1. Delete comments subcollection documents
      const commentsCol = collection(db, 'reports', report.id, 'comments');
      const commentsSnapshot = await getDocs(commentsCol);
      const batch1 = writeBatch(db);
      commentsSnapshot.forEach((cDoc) => {
        batch1.delete(cDoc.ref);
      });
      await batch1.commit();

      // 2. Delete verifications subcollection documents
      const verificationsCol = collection(db, 'reports', report.id, 'verifications');
      const verificationsSnapshot = await getDocs(verificationsCol);
      const batch2 = writeBatch(db);
      verificationsSnapshot.forEach((vDoc) => {
        batch2.delete(vDoc.ref);
      });
      await batch2.commit();

      // 3. Delete reportImages doc
      const imageDocRef = doc(db, 'reportImages', report.id);
      await deleteDoc(imageDocRef);

      // 4. Update owner's stats: decrement reportsCount
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        reportsCount: increment(-1)
      }).catch(err => console.warn('User stats update deferred:', err));

      // 5. Delete report doc itself
      const reportRef = doc(db, 'reports', report.id);
      await deleteDoc(reportRef);

      if (onDeleted) {
        onDeleted();
      }
    } catch (err) {
      console.error('Failed to delete report:', err);
      setDeleteError(err instanceof Error ? err.message : String(err));
    }
  };

  // Submit Comments Handler
  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !user || !report.id) return;

    const textToSubmit = newComment.trim();
    setNewComment('');

    try {
      const commentId = doc(collection(db, 'reports', report.id, 'comments')).id;
      const commentRef = doc(db, 'reports', report.id, 'comments', commentId);
      const reportRef = doc(db, 'reports', report.id);

      const batch = writeBatch(db);
      
      batch.set(commentRef, {
        id: commentId,
        reportId: report.id,
        authorId: user.uid,
        authorUid: user.uid,
        authorName: user.displayName || 'Civic Guard',
        authorPhotoUrl: user.photoURL || '',
        authorPhotoURL: user.photoURL || '',
        text: textToSubmit,
        createdAt: serverTimestamp(),
        parentId: null,
        replies: [],
      });

      batch.update(reportRef, {
        commentCount: increment(1),
      });

      await batch.commit();

      try {
        const commenterRef = doc(db, 'users', user.uid);
        await updateDoc(commenterRef, {
          commentsGivenCount: increment(1)
        });

        const reporterId = report.createdBy;
        if (reporterId && reporterId !== user.uid) {
          await sendNotification(
            reporterId,
            'comment',
            `${user.displayName || 'Someone'} commented on your report: "${report.title || ''}"`,
            report.id
          );
          evaluateAndAwardBadges(reporterId).catch(() => {});
        }

        evaluateAndAwardBadges(user.uid).catch(() => {});
      } catch (e) {
        console.warn('Comment notification/badge trigger failed:', e);
      }
    } catch (err) {
      console.error('Failed to post comment:', err);
    }
  };

  // Submit Nested Reply Handler (1 level nested maximum)
  const handleAddReply = async (commentId: string) => {
    const text = replyText[commentId]?.trim();
    if (!text || !user || !report.id) return;

    setReplyText((prev) => ({ ...prev, [commentId]: '' }));
    setActiveReplyBox(null);

    try {
      const commentRef = doc(db, 'reports', report.id, 'comments', commentId);
      const replyObj: Reply = {
        id: Math.random().toString(36).substring(2),
        authorId: user.uid,
        authorName: user.displayName || 'Authorized Helper',
        authorPhotoUrl: user.photoURL || '',
        text,
        createdAt: Timestamp.now(),
      };

      await updateDoc(commentRef, {
        replies: arrayUnion(replyObj),
      });

      try {
        const replierRef = doc(db, 'users', user.uid);
        await updateDoc(replierRef, {
          commentsGivenCount: increment(1)
        });

        const reporterId = report.createdBy;
        if (reporterId && reporterId !== user.uid) {
          await sendNotification(
            reporterId,
            'comment',
            `${user.displayName || 'Someone'} replied to a comment on your report: "${report.title || ''}"`,
            report.id
          );
          evaluateAndAwardBadges(reporterId).catch(() => {});
        }

        evaluateAndAwardBadges(user.uid).catch(() => {});
      } catch (e) {
        console.warn('Reply notification/badge trigger failed:', e);
      }
    } catch (err) {
      console.error('Failed to append nested reply:', err);
    }
  };

  // Manual After Image select and compression
  const handleAfterImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let file = e.target.files?.[0];
    if (!file) return;

    setCompressingAfter(true);
    setIsConvertingAfter(true);
    try {
      if (isHeicFile(file)) {
        file = await convertHeicToJpeg(file);
      }
    } catch (convErr: any) {
      setIsConvertingAfter(false);
      setCompressingAfter(false);
      setAfterUploadError(convErr.message || "Couldn't process this image, please try another photo or a screenshot");
      return;
    }
    setIsConvertingAfter(false);

    const reader = new FileReader();
    reader.onload = (event) => {
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
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
          setAfterImageFile(dataUrl);
        }
        setCompressingAfter(false);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Dedicated resolution confirm handler with after image attachment
  const handleResolveConfirm = async () => {
    if (!user || report.createdBy !== user.uid || updatingStatus) return;
    setUpdatingStatus(true);
    try {
      const reportRef = doc(db, 'reports', report.id);
      const reporterRef = doc(db, 'users', user.uid);

      await runTransaction(db, async (transaction) => {
        const reportSnap = await transaction.get(reportRef);
        if (!reportSnap.exists()) throw new Error("Report does not exist");
        
        const reporterSnap = await transaction.get(reporterRef);
        const currentPoints = reporterSnap.exists() ? (reporterSnap.data().impactPoints || 0) : 0;

        // +25 when resolved
        let pointsChange = 25;
        // +15 when after-photo uploaded
        if (afterImageFile) {
          pointsChange += 15;
        }

        const nextPoints = Math.max(0, currentPoints + pointsChange);

        transaction.update(reportRef, {
          status: 'Resolved',
        });

        transaction.update(reporterRef, {
          impactPoints: nextPoints,
        });

        if (afterImageFile) {
          const imageDocRef = doc(db, 'reportImages', report.id);
          transaction.set(imageDocRef, {
            afterImageData: afterImageFile
          }, { merge: true });
        }
      });

      setShowResolveForm(false);
      setLazyAfterImage(afterImageFile);

      try {
        await sendNotification(
          user.uid,
          'resolve',
          `Your report "${report.title || ''}" has been marked Resolved!`,
          report.id
        );
        evaluateAndAwardBadges(user.uid).catch(() => {});
      } catch (notifErr) {
        console.warn('Resolve notification/badge award failed:', notifErr);
      }
    } catch (err) {
      console.error('Error shifting lifecyle state:', err);
    } finally {
      setUpdatingStatus(false);
    }
  };

  // NEW: Client-side compression for multiple after photos
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

  const handleAfterImagesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    setAfterUploadError(null);
    const files = e.target.files;
    const remainingSlots = 5 - selectedAfterImages.length;
    if (remainingSlots <= 0) {
      setAfterUploadError('You can upload a maximum of 5 photos.');
      return;
    }

    const filesToProcess = Array.from(files).slice(0, remainingSlots) as File[];
    setCompressingAfter(true);

    try {
      const newCompressed: string[] = [];
      for (let i = 0; i < filesToProcess.length; i++) {
        let file = filesToProcess[i];
        
        if (isHeicFile(file)) {
          setIsConvertingAfter(true);
          try {
            file = await convertHeicToJpeg(file);
          } catch (convErr: any) {
            setIsConvertingAfter(false);
            throw convErr;
          }
          setIsConvertingAfter(false);
        } else {
          if (!file.type.startsWith('image/')) {
            setAfterUploadError('Please select image files only.');
            continue;
          }
        }

        const compressedUrl = await compressImageFile(file);
        newCompressed.push(compressedUrl);
      }
      setSelectedAfterImages((prev) => [...prev, ...newCompressed]);
    } catch (err: any) {
      console.warn('After image compression or conversion failed:', err);
      setAfterUploadError(err.message || 'Image compression failed.');
    } finally {
      setCompressingAfter(false);
      setIsConvertingAfter(false);
    }
  };

  const handleRemoveAfterImage = (idxToRemove: number) => {
    setSelectedAfterImages((prev) => prev.filter((_, idx) => idx !== idxToRemove));
  };

  const handleSubmitAfterPhotos = async () => {
    if (!user || selectedAfterImages.length === 0 || isSubmittingAfter) return;
    setIsSubmittingAfter(true);
    setAfterUploadError(null);

    try {
      const beforeImgToSubmit = lazyImage || report.photoUrl;
      if (!beforeImgToSubmit || beforeImgToSubmit === 'placeholder') {
        throw new Error('Before image could not be loaded for comparison. Please wait a moment and try again.');
      }

      // Call the server endpoint for resolution verification
      const response = await fetch('/api/verify-resolution', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          beforeImage: beforeImgToSubmit,
          afterImage: selectedAfterImages[0],
          beforeMimeType: 'image/jpeg',
          afterMimeType: 'image/jpeg'
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to analyze images.');
      }

      const verdict = await response.json(); // { resolved: boolean, confidence: number, reason: string }

      // Update Firestore
      const reportRef = doc(db, 'reports', report.id);
      const uploaderRef = doc(db, 'users', user.uid);

      await runTransaction(db, async (transaction) => {
        const reportSnap = await transaction.get(reportRef);
        if (!reportSnap.exists()) throw new Error('Report does not exist');

        const uploaderSnap = await transaction.get(uploaderRef);
        const currentPoints = uploaderSnap.exists() ? (uploaderSnap.data().impactPoints || 0) : 0;

        // "If resolved=true with reasonable confidence, mark the report "Resolved · AI Verified" with a confidence badge and award the uploader +15 Impact Points. Otherwise show "After photo submitted — fix not confirmed by AI" and award nothing."
        const isVerified = verdict.resolved === true && verdict.confidence >= 0.70;
        const pointsAwarded = isVerified ? 15 : 0;
        const nextPoints = currentPoints + pointsAwarded;

        const aiVerificationData = {
          resolved: verdict.resolved,
          confidence: verdict.confidence,
          reason: verdict.reason,
          submittedBy: user.uid,
          submittedByName: user.displayName || 'Civic Champion',
          submittedAt: Timestamp.now()
        };

        transaction.update(reportRef, {
          afterImageSubmitted: true,
          aiVerification: aiVerificationData,
          status: 'Resolved' // ensure status is Resolved
        });

        if (pointsAwarded > 0) {
          transaction.update(uploaderRef, {
            impactPoints: nextPoints
          });
        }
      });

      // Write after-photos to reports/{reportId}/afterImages subcollection
      for (let i = 0; i < selectedAfterImages.length; i++) {
        const base64Data = selectedAfterImages[i];
        const afterImageDocRef = doc(collection(db, 'reports', report.id, 'afterImages'));
        await setDoc(afterImageDocRef, {
          data: base64Data,
          order: i,
          createdAt: Timestamp.now()
        });
      }

      // Clear selection and refresh the local state
      setLazyAfterImage(selectedAfterImages[0]);
      setAfterImages(selectedAfterImages.map((data, i) => ({ id: `new-after-${i}`, data, order: i })));
      setSelectedAfterImages([]);

      try {
        const isVerified = verdict.resolved === true && verdict.confidence >= 0.70;
        await sendNotification(
          user.uid,
          'resolve',
          isVerified 
            ? `Your after-photo was verified by AI! Report "${report.title || ''}" is now Resolved.` 
            : `After-photo submitted for "${report.title || ''}", AI verification is pending.`,
          report.id
        );
        evaluateAndAwardBadges(user.uid).catch(() => {});
      } catch (notifErr) {
        console.warn('After image notification/badge award failed:', notifErr);
      }
    } catch (err: any) {
      console.error('Failed to submit resolution verification:', err);
      setAfterUploadError(err.message || 'An error occurred during submission.');
    } finally {
      setIsSubmittingAfter(false);
    }
  };

  // Manual Advance status progression button
  const handleAdvanceStatus = async () => {
    if (!user || report.createdBy !== user.uid || updatingStatus) return;

    // Reported -> Verified is community-driven only (requires 3 verifications)
    if (report.status === 'Reported') {
      console.warn("Reported status cannot be manually advanced.");
      return;
    }

    const statuses: IssueStatus[] = ['Verified', 'In Progress', 'Resolved'];
    const currentIndex = statuses.indexOf(report.status);
    if (currentIndex === -1 || currentIndex === statuses.length - 1) return;

    const nextStatus = statuses[currentIndex + 1];
    setUpdatingStatus(true);

    try {
      const reportRef = doc(db, 'reports', report.id);
      const reporterRef = doc(db, 'users', user.uid);

      await runTransaction(db, async (transaction) => {
        const reportSnap = await transaction.get(reportRef);
        if (!reportSnap.exists()) throw new Error("Report does not exist");

        const reporterSnap = await transaction.get(reporterRef);
        const currentPoints = reporterSnap.exists() ? (reporterSnap.data().impactPoints || 0) : 0;

        transaction.update(reportRef, {
          status: nextStatus,
        });

        if (nextStatus === 'Resolved') {
          // Resolved base points: +25
          const nextPoints = Math.max(0, currentPoints + 25);
          transaction.update(reporterRef, {
            impactPoints: nextPoints,
          });
        }
      });

      try {
        await sendNotification(
          user.uid,
          nextStatus === 'Resolved' ? 'resolve' : 'in_progress',
          `Your report "${report.title || ''}" status was updated to ${nextStatus}!`,
          report.id
        );
        evaluateAndAwardBadges(user.uid).catch(() => {});
      } catch (notifErr) {
        console.warn('Advance status notification/badge award failed:', notifErr);
      }
    } catch (err) {
      console.error('Error shifting lifecyle state:', err);
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Helpers
  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'Just now';
    const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isCreator = user && report.createdBy === user.uid;

  // Active styles for timeline
  const getTimelineStepStyle = (step: IssueStatus, index: number) => {
    const statuses: IssueStatus[] = ['Reported', 'Verified', 'In Progress', 'Resolved'];
    const currentIdx = statuses.indexOf(report.status);
    const active = currentIdx >= index;
    
    if (active) {
      if (report.status === 'Resolved') return 'bg-emerald-500 border-emerald-600 text-white';
      if (report.status === 'In Progress') return 'bg-indigo-500 border-indigo-600 text-white';
      return 'bg-amber-500 border-amber-600 text-white';
    }
    return 'bg-slate-50 border-slate-200 text-slate-400';
  };

  // Media render checks
  const isVideo = (url: string) => {
    return url?.includes('.mp4') || url?.includes('video%2F');
  };

  const isUnderReview = report.status === 'Under Review' || report.underReview;

  return (
    <article 
      id={cardId} 
      className={`overflow-hidden rounded-2xl border transition-all duration-300 ${
        isUnderReview 
          ? 'border-amber-300 bg-amber-50/20 shadow-xs hover:shadow-md' 
          : 'border-slate-100 bg-white shadow-xs hover:shadow-md'
      }`}
    >
      {isUnderReview && (
        <div className="bg-amber-500/10 border-b border-amber-200/60 px-4 py-3 flex items-start space-x-2.5">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-left">
            <span className="font-sans text-xs font-black uppercase tracking-wider text-amber-800 block">
              ⚠ Under Community Review
            </span>
            <p className="font-sans text-[11px] font-medium text-amber-700 leading-normal mt-0.5">
              This post is under community review because it received multiple flags. If it's a genuine issue, community verifications will restore it.
            </p>
          </div>
        </div>
      )}
      
      {/* Three Zones Post-Structure layout */}
      <div className="flex">
        
        {/* ======================================= */}
        {/* ZONE A: INTEGRATED VERTICAL VOTE RAIL   */}
        {/* ======================================= */}
        <div className="w-[48px] bg-slate-50/70 border-r border-slate-50 flex flex-col items-center py-4 shrink-0 justify-start space-y-2">
          {user ? (
            <button
              onClick={handleVerify}
              disabled={verifying || !!isCreator}
              title={isCreator ? "You cannot verify your own report" : report.status === 'Resolved' ? (hasVerified ? "Remove your resolution verification" : "Verify this resolution") : (hasVerified ? "Remove your verification" : "Verify/upvote this report")}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all active:scale-90 ${
                hasVerified
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-50 cursor-pointer shadow-xs'
                  : isCreator
                  ? 'bg-slate-100/85 text-slate-300 cursor-not-allowed'
                  : 'bg-white text-slate-400 hover:text-indigo-600 border border-slate-200 hover:border-indigo-300 shadow-3xs cursor-pointer'
              }`}
            >
              {verifying ? (
                <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
              ) : (
                <ThumbsUp className={`h-4.5 w-4.5 ${hasVerified ? 'fill-emerald-700 text-emerald-700' : ''}`} />
              )}
            </button>
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
              <ThumbsUp className="h-4 w-4" />
            </div>
          )}
          <span className="font-mono text-xs font-black text-slate-700">
            {subcollectionVoteCount !== null ? subcollectionVoteCount : (report.verificationCount || 0)}
          </span>
          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest text-center">
            votes
          </span>

          {report.aiTagged && (
            <span title="Civic Intelligence Auto-Tagged" className="inline-block pt-4 select-none animate-pulse">
              <Sparkles className="h-4 w-4 text-indigo-500" />
            </span>
          )}
        </div>

        {/* ======================================= */}
        {/* ZONE B & C PANEL: MEDIA THUMBNAIL + BODY*/}
        {/* ======================================= */}
        <div className="flex-1 p-5 flex flex-col">
          
          <div className="flex items-start gap-4">
            
            {/* ZONE B - MEDIA THUMBNAIL ELEMENT */}
            <div 
              onClick={() => onSelect?.(report.id)}
              className="w-[78px] h-[78px] rounded-xl overflow-hidden bg-indigo-50/50 border border-indigo-100 shrink-0 flex items-center justify-center relative cursor-pointer hover:opacity-90 transition-opacity"
            >
              {loadingImage ? (
                <div className="flex items-center justify-center">
                  <Loader2 className="h-4.5 w-4.5 animate-spin text-indigo-400" />
                </div>
              ) : lazyImage ? (
                <>
                  <img 
                    src={lazyImage} 
                    alt="Hazard media thumbnail" 
                    className="h-full w-full object-cover img_no_referrer" 
                    referrerPolicy="no-referrer"
                  />
                  {report.imageCount && report.imageCount > 1 && (
                    <span className="absolute bottom-1 right-1 bg-slate-900/80 text-white font-mono text-[9px] px-1 py-0.5 rounded leading-none font-bold scale-90 sm:scale-100 select-none">
                      {report.imageCount} photos
                    </span>
                  )}
                </>
              ) : (
                <div className="text-center p-1 flex flex-col items-center">
                  <div className="h-7 w-7 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
                    <LocationIcon department={report.department || ''} />
                  </div>
                  <span className="text-[8px] font-bold text-indigo-500/85 mt-1 uppercase tracking-wider block truncate max-w-[70px]">
                    {report.department || 'General'}
                  </span>
                </div>
              )}
            </div>

            {/* ZONE C - POST BODY INFO */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-1.5 text-slate-400">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button 
                    onClick={() => onUserClick?.(report.createdBy)}
                    className="font-sans text-[10px] font-bold text-slate-600 hover:text-indigo-600 cursor-pointer transition-colors text-left capitalize"
                  >
                    {report.createdByName} 
                    {isCreator && <span className="text-indigo-600 ml-1 font-medium">(You)</span>}
                  </button>
                  <span className="text-slate-250">•</span>
                  <span className="font-sans text-[10px] sm:text-[11px] text-slate-500">
                    {report.locality || 'Bavdhan'} area
                  </span>
                  <span className="text-slate-250">•</span>
                  <span className="font-sans text-[10px] text-slate-450">
                    {formatDate(report.createdAt)}
                  </span>
                </div>
                {isCreator && showConfirmDelete && (
                  <div className="flex items-center space-x-1.5 bg-rose-50/90 px-2 py-0.8 rounded-lg border border-rose-100 shadow-3xs select-none">
                    <span className="text-[10px] font-black text-rose-700 uppercase tracking-wide">Delete?</span>
                    <button
                      onClick={executeDeleteReport}
                      className="text-[9.5px] font-extrabold text-white bg-rose-600 hover:bg-rose-700 px-2 py-0.5 rounded-md uppercase tracking-wider cursor-pointer shadow-2xs transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={handleCancelDelete}
                      className="text-[9.5px] font-bold text-slate-500 hover:text-slate-700 bg-white hover:bg-slate-55 px-2 py-0.5 rounded-md border border-slate-200 cursor-pointer shadow-3xs transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {isCreator && !showConfirmDelete && (
                  <button
                    onClick={handleDeleteTrigger}
                    title="Delete this report"
                    className="p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                {!isCreator && user && (
                  <div className="flex items-center space-x-1.5 animate-fade-in">
                    {showConfirmSpam ? (
                      <div className="flex items-center space-x-1.5 bg-rose-50/95 px-2 py-0.8 rounded-lg border border-rose-100 shadow-3xs select-none">
                        <select
                          value={flagReason}
                          onChange={(e) => setFlagReason(e.target.value)}
                          className="text-[10px] font-semibold text-rose-700 bg-white border border-rose-200 rounded px-1.5 py-0.5 outline-none focus:border-rose-400"
                        >
                          <option value="">Reason (Optional)</option>
                          <option value="Spam">Spam</option>
                          <option value="Duplicate">Duplicate</option>
                          <option value="Not a real issue">Not a real issue</option>
                          <option value="Already resolved">Already resolved</option>
                        </select>
                        <button
                          onClick={() => {
                            handleToggleFlag(flagReason);
                            setShowConfirmSpam(false);
                          }}
                          disabled={flagging}
                          className="text-[9.5px] font-extrabold text-white bg-rose-600 hover:bg-rose-700 px-2 py-0.5 rounded-md uppercase tracking-wider cursor-pointer shadow-2xs transition-colors"
                        >
                          {flagging ? '...' : 'Flag'}
                        </button>
                        <button
                          onClick={handleCancelSpam}
                          className="text-[9.5px] font-bold text-slate-500 hover:text-slate-700 bg-white hover:bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200 cursor-pointer shadow-3xs transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={hasFlagged ? () => handleToggleFlag() : handleSpamTrigger}
                        title={hasFlagged ? "Remove your community flag" : "Flag this report"}
                        className={`p-1.5 rounded-md transition-colors cursor-pointer shrink-0 flex items-center space-x-1 ${
                          hasFlagged
                            ? 'bg-rose-50 text-rose-600 hover:bg-rose-100'
                            : 'text-slate-400 hover:text-rose-500 hover:bg-rose-50'
                        }`}
                      >
                        <Flag className={`h-3.5 w-3.5 ${hasFlagged ? 'fill-rose-500 text-rose-500' : ''}`} />
                        {subcollectionFlagCount !== null && subcollectionFlagCount > 0 && (
                          <span className="text-[10px] font-bold">{subcollectionFlagCount}</span>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {flagError && (
                <div className="mt-1.5 text-[10px] font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1 select-none flex items-center space-x-1.5">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  <span>Failed to flag: {flagError}</span>
                </div>
              )}

              {deleteError && (
                <div className="mt-1.5 text-[10px] font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1 select-none flex items-center space-x-1.5">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  <span>Failed to delete: {deleteError}</span>
                </div>
              )}

              {currentEscStage > 0 && (
                <div className="mt-2.5 flex items-center">
                  <span className={`inline-flex items-center space-x-1 px-2.5 py-0.8 rounded-full text-[9.5px] font-black uppercase tracking-wider border select-none ${
                    currentEscStage === 3
                      ? 'bg-rose-50 border-rose-200 text-rose-700 animate-pulse'
                      : currentEscStage === 2
                      ? 'bg-orange-50 border-orange-200 text-orange-700'
                      : 'bg-amber-50 border-amber-200 text-amber-700'
                  }`}>
                    <ShieldAlert className="h-3 w-3 shrink-0" />
                    <span>Level {currentEscStage} Escalated</span>
                  </span>
                </div>
              )}

              <h4 
                onClick={() => onSelect?.(report.id)}
                className="mt-1 font-sans text-sm font-extrabold text-slate-900 leading-snug cursor-pointer hover:text-indigo-600 transition-colors"
              >
                {report.title}
              </h4>
              
              <p 
                onClick={() => onSelect?.(report.id)}
                className="mt-1.5 font-sans text-xs text-slate-650 leading-relaxed max-w-2xl break-words cursor-pointer hover:text-slate-800 transition-colors"
              >
                {report.description}
              </p>

              {/* Landmark info & GPS status badge */}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center space-x-1 font-sans text-[10.5px] font-medium text-slate-500 bg-slate-100/50 px-2.5 py-0.8 rounded-full border border-slate-200/50">
                  <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                  <span className="truncate max-w-[170px] sm:max-w-[280px]">{report.locationText}</span>
                </div>
                {report.lat && report.lng && report.hasGps && !report.locationEdited ? (
                  <span className="inline-flex items-center text-[9px] font-mono font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 border border-emerald-110 px-1.5 py-0.5 rounded-sm">
                    GPS LOCKED
                  </span>
                ) : (
                  <span className="inline-flex items-center text-[9px] font-mono font-bold uppercase tracking-wider text-slate-550 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded-sm">
                    location entered manually
                  </span>
                )}
              </div>

              {/* Integrated Badges Row */}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {/* Under Review Chip */}
                {report.status === 'Under Review' && (
                  <span className="inline-flex items-center space-x-1.5 text-[10.5px] font-extrabold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-0.6 rounded-full select-none animate-pulse">
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                    <span className="uppercase tracking-wider">Under community review</span>
                  </span>
                )}

                {/* Department badge wrapper */}
                <span className="inline-flex items-center text-[10.5px] font-extrabold text-indigo-700 bg-indigo-50/50 px-2.5 py-0.6 rounded-full border border-indigo-100/50 select-none">
                  <LocationIcon department={report.department || ''} />
                  <span className="ml-1.5 uppercase tracking-wide">{report.department || 'General'}</span>
                </span>
                
                {/* Subcategory */}
                {report.subcategory && (
                  <span className="inline-flex items-center text-[10px] font-medium text-slate-500 bg-slate-50 border border-slate-200/50 px-2 py-0.5 rounded-md">
                    {report.subcategory}
                  </span>
                )}

                {/* AI Auto-Tagged sparkles banner indicator */}
                {report.aiTagged && (
                  <span title="AI Intelligent Tagging Verified" className="inline-flex items-center space-x-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-110 px-2 py-0.5 rounded-full animate-pulse select-none">
                    <Sparkles className="h-3 w-3 fill-indigo-600 shrink-0" />
                    <span>Auto-Tagged</span>
                  </span>
                )}

                {/* Urgency pill colorized value */}
                {report.priorityScore !== undefined && (
                  <span 
                    title="AI's read of how dangerous/urgent this looks in the photo (0-100)."
                    className={`relative group inline-flex items-center space-x-1.5 text-[10px] font-extrabold px-2 py-0.5 rounded-full select-none cursor-help ${
                      report.priorityScore >= 70 
                        ? 'bg-rose-50 border border-rose-200 text-rose-700' 
                        : report.priorityScore >= 40 
                        ? 'bg-amber-50 border border-amber-200 text-amber-700' 
                        : 'bg-indigo-50 border border-indigo-150 text-indigo-700'
                    }`}
                  >
                    <Sparkles className="h-3 w-3 text-current shrink-0" />
                    <span>Urgency {report.priorityScore}/100</span>
                    <span className="text-[9px] opacity-70 font-mono">?</span>

                    {/* Interactive Tooltip (Downwards to avoid overflow clipping) */}
                    <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block w-48 p-2 bg-slate-900 text-white text-[10px] font-normal rounded-lg shadow-xl z-50 leading-normal text-center">
                      AI's read of how dangerous/urgent this looks in the photo (0-100).
                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-slate-900"></span>
                    </span>
                  </span>
                )}

                {/* Confidence pill */}
                {report.confidence !== undefined && (
                  <span 
                    title="How sure the AI is about its category classification."
                    className={`relative group inline-flex items-center space-x-1.5 text-[10px] font-extrabold px-2 py-0.5 rounded-full select-none cursor-help ${
                      report.confidence >= 85
                        ? 'bg-emerald-50 border border-emerald-100 text-emerald-700'
                        : report.confidence >= 60
                        ? 'bg-indigo-50 border border-indigo-100 text-indigo-700'
                        : 'bg-slate-50 border border-slate-200 text-slate-500'
                    }`}
                  >
                    <Sparkles className="h-3 w-3 text-current shrink-0" />
                    <span>Confidence {report.confidence}%</span>
                    <span className="text-[9px] opacity-70 font-mono">?</span>

                    {/* Interactive Tooltip (Downwards to avoid overflow clipping) */}
                    <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block w-48 p-2 bg-slate-900 text-white text-[10px] font-normal rounded-lg shadow-xl z-50 leading-normal text-center">
                      How sure the AI is about its category classification.
                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-slate-900"></span>
                    </span>
                  </span>
                )}

                {/* Validity alert block */}
                {report.isValidCivicIssue === false && (
                  <span title={report.validityReason || 'Potential non-civic content'} className="inline-flex items-center space-x-1 text-[10px] font-extrabold text-amber-805 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full animate-pulse select-none">
                    <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" />
                    <span>Unverified Image Warning</span>
                  </span>
                )}

                {/* AI Complaint routing badge */}
                {stage0Action && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      window.location.hash = 'complaint';
                      onSelect?.(report.id);
                    }}
                    className="inline-flex items-center space-x-1.5 text-[10px] font-extrabold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 hover:scale-[1.02] active:scale-[0.98] transition-all border border-emerald-200 px-2.5 py-0.5 rounded-full select-none shadow-3xs cursor-pointer text-left font-sans"
                  >
                    <ShieldAlert className="h-3 w-3 text-emerald-600 shrink-0" />
                    <span>Complaint #{stage0Action.referenceId} Routed: {stage0Action.authorityName} ({stage0Action.dispatchStatus})</span>
                  </button>
                )}
              </div>

              {/* Advanced estimate and AI metadata analytics display panel */}
              {report.estimatedImpact && report.estimatedImpact.risks && report.estimatedImpact.risks.length > 0 && (
                <div className="mt-3 bg-indigo-50/25 border border-indigo-100/30 p-2.5 rounded-xl font-sans text-xs text-slate-650">
                  <div className="flex items-center space-x-1 text-[10px] font-bold text-indigo-600 uppercase tracking-widest">
                    <Sparkles className="h-3.5 w-3.5 text-indigo-505" />
                    <span>AI Risk Assessment</span>
                  </div>
                  <div className="mt-1.5 leading-relaxed text-[11px] font-sans">
                    <span className="font-extrabold text-slate-800">Potential Risks:</span>{' '}
                    <span className="text-slate-550 font-medium">
                      {report.estimatedImpact.risks.join(', ')}
                    </span>
                  </div>
                  {report.priorityReason && (
                    <p className="mt-1 text-[10.5px] text-slate-500 italic leading-snug">
                      "{report.priorityReason}"
                    </p>
                  )}
                </div>
              )}

              {/* BEFORE / AFTER PHOTO GRID (When Resolved) */}
              {report.status === 'Resolved' && (lazyImage || lazyAfterImage) && (
                <div className="mt-3.5 grid grid-cols-2 gap-3.5 bg-slate-50 border border-slate-150 p-3 rounded-xl shadow-3xs">
                  <div className="relative">
                    <span className="absolute top-1.5 left-1.5 bg-slate-900/75 backdrop-blur-xs text-[8px] font-extrabold uppercase text-white px-2 py-0.5 rounded-sm select-none tracking-widest z-10">
                      BEFORE (Hazard)
                    </span>
                    {lazyImage ? (
                      <img 
                        src={lazyImage} 
                        alt="Before hazard resolution" 
                        className="w-full h-24 sm:h-28 object-cover rounded-lg border border-slate-200 shadow-3xs" 
                      />
                    ) : (
                      <div className="flex items-center justify-center h-24 sm:h-28 bg-white border border-slate-200 rounded-lg text-slate-450 italic text-[10px]">
                        No original proof
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <span className="absolute top-1.5 left-1.5 bg-emerald-650 text-[8px] font-extrabold uppercase text-white px-2 py-0.5 rounded-sm select-none tracking-widest z-10 shadow-3xs">
                      AFTER (Resolved)
                    </span>
                    {lazyAfterImage ? (
                      <img 
                        src={lazyAfterImage} 
                        alt="After hazard resolution" 
                        className="w-full h-24 sm:h-28 object-cover rounded-lg border border-slate-200 shadow-3xs" 
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-lg h-24 sm:h-28 bg-white text-center p-2">
                        <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">RESOLVING PHOTO</span>
                        <span className="text-[8px] text-slate-450 mt-0.5 leading-normal">Not attached yet</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* ======================================= */}
          {/* TIMELINE PROGRESS PIPELINE STEPPER      */}
          {/* ======================================= */}
          <div className="mt-5 bg-slate-50/50 p-4 rounded-xl border border-slate-100">
            <div className="flex items-center justify-between max-w-lg mx-auto relative px-4 sm:px-6">
              
              {/* Stepper active backgrounds line */}
              <div className="absolute top-3 left-6 right-6 h-0.5 bg-slate-200 -translate-y-1/2 z-0" />
              <div 
                className="absolute top-3 left-6 right-6 h-0.5 -translate-y-1/2 z-0 overflow-hidden"
              >
                <div 
                  className="h-full bg-indigo-500 transition-all duration-300" 
                  style={{ 
                    width: `${
                      report.status === 'Reported' ? '0%' :
                      report.status === 'Verified' ? '33.33%' :
                      report.status === 'In Progress' ? '66.66%' : '100%'
                    }` 
                  }}
                />
              </div>

              {/* Render step bubbles */}
              {['Reported', 'Verified', 'In Progress', 'Resolved'].map((step, idx) => (
                <div key={step} className="flex flex-col items-center relative z-10 w-14 sm:w-18 text-center">
                  <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all duration-300 ${getTimelineStepStyle(step as IssueStatus, idx)}`}>
                    {idx + 1}
                  </div>
                  <span className="font-sans text-[9px] font-bold text-slate-600 mt-1.5 capitalize tracking-tight whitespace-nowrap block">
                    {step}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ======================================= */}
          {/* THE FOOTER ROW: ACTIONS & INITIATIONS   */}
          {/* ======================================= */}
          <div className="mt-4 pt-3.5 border-t border-slate-50 flex flex-wrap items-center justify-between gap-3 font-sans">
            
            <div className="flex items-center space-x-2">
              {/* Comments toggle element */}
              <button
                onClick={() => setShowComments(!showComments)}
                className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold select-none cursor-pointer border transition-colors ${
                  showComments 
                    ? 'bg-slate-900 border-slate-900 text-white' 
                    : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-600'
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Comments ({report.commentCount || 0})</span>
              </button>

              {/* Map Coordinates button if locked */}
              {report.lat && report.lng && (
                <a 
                  href={`/map?reportId=${report.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    window.history.pushState({}, '', `/map?reportId=${report.id}`);
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }}
                  className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <MapPin className="h-3.5 w-3.5 text-indigo-500" />
                  <span>Interactive Map</span>
                </a>
              )}

              {/* Generate Official Complaint action button */}
              {(report.status === 'Verified' || (report.verificationCount || 0) >= 3) && !stage0Action && user && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleGenerateComplaint();
                  }}
                  disabled={generatingComplaint}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-indigo-200 bg-indigo-50 text-xs font-bold text-indigo-700 hover:bg-indigo-100 cursor-pointer active:scale-95 transition-transform disabled:opacity-50"
                >
                  {generatingComplaint ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 text-indigo-500 fill-indigo-100" />
                  )}
                  <span>{generatingComplaint ? 'Generating...' : 'Generate Official Complaint'}</span>
                </button>
              )}

              {complaintError && (
                <div className="inline-flex items-center space-x-1.5 text-[11px] font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                  <span>Couldn't generate complaint</span>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleGenerateComplaint();
                    }}
                    className="underline text-indigo-600 hover:text-indigo-800 font-bold ml-1 cursor-pointer"
                  >
                    retry
                  </button>
                </div>
              )}
            </div>

            {/* Advance Status button with Resolution/After Image uploading support */}
            {isCreator && report.status !== 'Resolved' && (
              <div className="flex flex-col items-end space-y-1">
                {report.status === 'Reported' ? (
                  <div className="flex flex-col items-end">
                    <button
                      disabled
                      title="Needs 3 community verifications to advance"
                      className="inline-flex items-center space-x-1 rounded-xl bg-slate-100 text-slate-400 px-3.5 py-1.5 text-xs font-bold border border-slate-200 cursor-not-allowed select-none"
                    >
                      <span>Progress Stage</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-[10px] text-slate-400 font-bold mt-1 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                      Needs 3 community verifications to advance
                    </span>
                  </div>
                ) : (
                  <button
                    onClick={handleAdvanceStatus}
                    disabled={updatingStatus}
                    className="inline-flex items-center space-x-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 text-xs font-bold shadow-xs cursor-pointer active:scale-95 transition-transform"
                  >
                    {updatingStatus ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <span>Progress Stage</span>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* NEW: Upload After Photo Flow for Resolved Reports (ANY signed-in user) */}
          {report.status === 'Resolved' && !report.afterImageSubmitted && user && (
            <div className="mt-4 bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 text-left space-y-3 shadow-3xs antialiased">
              <div>
                <div className="flex items-center space-x-2 text-indigo-900 font-extrabold text-xs uppercase tracking-wider">
                  <Camera className="h-4 w-4 text-indigo-500" />
                  <span>Upload "After" Photos to Verify Fix</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1 leading-normal">
                  This issue has been marked as <strong className="text-slate-700">Resolved</strong>. Help our community confirm the fix by uploading one or more "After" photos. Our AI will verify the resolution, and you will receive <strong className="text-indigo-700">+15 Impact Points</strong>!
                </p>
              </div>

              <div className="space-y-2">
                <label className="block">
                  <span className="text-[10px] text-slate-500 font-extrabold uppercase block mb-1">Select "After" Photos (1 to 5):</span>
                  <input 
                    type="file" 
                    accept="image/*" 
                    multiple
                    onChange={handleAfterImagesChange}
                    disabled={isSubmittingAfter}
                    className="block w-full text-xs text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-[11px] file:font-black file:bg-indigo-100 file:text-indigo-700 hover:file:bg-indigo-200 cursor-pointer disabled:opacity-50"
                  />
                </label>

                {isConvertingAfter && (
                  <div className="flex items-center space-x-1.5 text-[10px] text-indigo-600 font-extrabold uppercase tracking-wider animate-pulse">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Converting image format...</span>
                  </div>
                )}

                {compressingAfter && (
                  <div className="flex items-center space-x-1.5 text-[10px] text-indigo-600 font-extrabold uppercase tracking-wider animate-pulse">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Compressing image proofs...</span>
                  </div>
                )}

                {afterUploadError && (
                  <div className="text-xs text-rose-600 font-bold bg-rose-50 border border-rose-100 rounded-lg p-2 flex items-center space-x-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-500 flex-shrink-0" />
                    <span>{afterUploadError}</span>
                  </div>
                )}

                {/* Selected images preview list */}
                {selectedAfterImages.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <span className="text-[10px] text-slate-450 font-black uppercase tracking-wider block">Selected Images ({selectedAfterImages.length} of 5):</span>
                    <div className="flex items-center space-x-2 overflow-x-auto pb-1">
                      {selectedAfterImages.map((imgSrc, idx) => (
                        <div key={idx} className="relative flex-shrink-0">
                          <img 
                            src={imgSrc} 
                            alt={`Selected after ${idx + 1}`} 
                            className="w-16 h-16 object-cover rounded-md border border-slate-200 shadow-3xs" 
                          />
                          <button 
                            type="button"
                            onClick={() => handleRemoveAfterImage(idx)}
                            disabled={isSubmittingAfter}
                            className="absolute -top-1.5 -right-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded-full h-4 w-4 flex items-center justify-center text-[8px] font-bold shadow-3xs cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedAfterImages.length > 0 && (
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={handleSubmitAfterPhotos}
                      disabled={isSubmittingAfter || compressingAfter}
                      className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-black flex items-center space-x-1.5 shadow-sm active:scale-95 transition-transform cursor-pointer"
                    >
                      {isSubmittingAfter ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>AI Comparing Photos...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5 text-amber-300 animate-pulse" />
                          <span>Verify Resolution with AI (+15 PTS)</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AI Verification Verdict Banner */}
          {report.afterImageSubmitted && report.aiVerification && (
            <div className={`mt-3 p-3.5 rounded-xl border ${
              report.aiVerification.resolved && report.aiVerification.confidence >= 0.70
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-slate-50 border-slate-200 text-slate-800'
            } shadow-3xs antialiased text-left`}>
              <div className="flex items-start space-x-2.5 text-xs">
                {report.aiVerification.resolved && report.aiVerification.confidence >= 0.70 ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <div className="flex items-center flex-wrap gap-1.5">
                    <span className={`font-black uppercase text-[10px] tracking-wider px-2 py-0.5 rounded-md ${
                      report.aiVerification.resolved && report.aiVerification.confidence >= 0.70
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-200 text-slate-700'
                    }`}>
                      {report.aiVerification.resolved && report.aiVerification.confidence >= 0.70
                        ? 'Resolved · AI Verified'
                        : 'After photo submitted — fix not confirmed by AI'}
                    </span>
                    {report.aiVerification.resolved && report.aiVerification.confidence >= 0.70 && (
                      <span className="bg-indigo-100 text-indigo-800 font-extrabold uppercase text-[9px] tracking-wider px-2 py-0.5 rounded-md">
                        {Math.round(report.aiVerification.confidence * 100)}% Confidence
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 italic font-medium leading-normal mt-1">
                    "{report.aiVerification.reason}"
                  </p>
                  <div className="text-[10px] text-slate-400 font-semibold pt-1">
                    Submitted by <strong className="text-slate-600">{report.aiVerification.submittedByName}</strong> on {formatDate(report.aiVerification.submittedAt)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ======================================= */}
          {/* COMMENT FEED & NESTED REPLY SECTIONS    */}
          {/* ======================================= */}
          {showComments && (
            <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col space-y-3.5 antialiased">
              
              {/* Comment line builder */}
              <div className="flex items-center space-x-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">
                <MessageSquare className="h-3.5 w-3.5 text-indigo-500" />
                <span>Issue Discussion</span>
              </div>

              {/* Existing Comments listing */}
              {loadingComments ? (
                <div className="flex items-center justify-center py-4 space-x-2">
                  <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                  <span className="font-sans text-xs text-slate-400">Loading civic threads...</span>
                </div>
              ) : comments.length === 0 ? (
                <p className="text-center py-4 font-sans text-xs text-slate-450 italic">
                  No commentary posted yet. Introduce coordinates or verify status info below!
                </p>
              ) : (
                <div className="space-y-3 pl-1 sm:pl-3">
                  {comments.map((comment) => (
                    <div key={comment.id} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3.5">
                      
                      {/* Comment author header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <button 
                            onClick={() => onUserClick?.(comment.authorUid || comment.authorId)}
                            className="h-6 w-6 rounded-full bg-slate-200 overflow-hidden shrink-0 flex items-center justify-center text-slate-600 font-bold text-[10px] hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                          >
                            {comment.authorPhotoUrl ? (
                              <img src={comment.authorPhotoUrl} alt="author avatar" className="h-full w-full object-cover img_no_referrer" referrerPolicy="no-referrer" />
                            ) : (
                              <span className="uppercase">{comment.authorName[0]}</span>
                            )}
                          </button>
                          <div className="text-left">
                            <button 
                              onClick={() => onUserClick?.(comment.authorUid || comment.authorId)}
                              className="font-sans text-[11px] font-bold text-slate-800 hover:text-indigo-600 cursor-pointer transition-colors text-left"
                            >
                              {comment.authorName}
                            </button>
                            <span className="ml-1.5 font-mono text-[9px] font-semibold text-amber-700 bg-amber-50 px-1 py-0.2 rounded-sm uppercase">
                              Impact <LiveUserImpact userId={comment.authorUid || comment.authorId} fallbackValue={comment.authorImpactPoints} />
                            </span>
                          </div>
                        </div>
                        <span className="font-sans text-[10px] text-slate-400">
                          {formatDate(comment.createdAt)}
                        </span>
                      </div>

                      {/* Comment text body */}
                      <p className="mt-1.5 font-sans text-xs text-slate-700 whitespace-pre-wrap pl-1">
                        {comment.text}
                      </p>

                      {/* Replies nested (one level deep list) */}
                      {comment.replies && comment.replies.length > 0 && (
                        <div className="mt-3.5 space-y-2.5 pl-4 border-l-2 border-indigo-100">
                          {comment.replies.map((reply) => (
                            <div key={reply.id} className="flex items-start space-x-2">
                              <CornerDownRight className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                              <div className="flex-1 bg-white p-2.5 rounded-lg border border-slate-100 shadow-3xs">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-1.5">
                                    <button 
                                      onClick={() => onUserClick?.(reply.authorId)}
                                      className="h-4 w-4 rounded-full bg-slate-200 overflow-hidden shrink-0 flex items-center justify-center text-slate-600 font-bold text-[7px] hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                                    >
                                      {reply.authorPhotoUrl ? (
                                        <img src={reply.authorPhotoUrl} alt="reply avatar" className="h-full w-full object-cover img_no_referrer" referrerPolicy="no-referrer" />
                                      ) : (
                                        <span className="uppercase">{reply.authorName[0]}</span>
                                      )}
                                    </button>
                                    <button 
                                      onClick={() => onUserClick?.(reply.authorId)}
                                      className="font-sans text-[10px] font-bold text-slate-800 hover:text-indigo-600 cursor-pointer transition-colors text-left"
                                    >
                                      {reply.authorName}
                                    </button>
                                    <span className="font-mono text-[8px] font-bold text-amber-750 bg-amber-50 px-1 py-0.2 rounded-sm">
                                      Impact <LiveUserImpact userId={reply.authorId} fallbackValue={reply.authorImpactPoints} />
                                    </span>
                                  </div>
                                </div>
                                <p className="mt-1 font-sans text-xs text-slate-650">
                                  {reply.text}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Reply field and button toggle */}
                      <div className="mt-2 text-right">
                        {activeReplyBox === comment.id ? (
                          <div className="mt-2.5 flex items-center space-x-2 bg-white p-1 rounded-lg border border-slate-200">
                            <input
                              type="text"
                              value={replyText[comment.id] || ''}
                              onChange={(e) => setReplyText({ ...replyText, [comment.id]: e.target.value })}
                              placeholder={`Reply to ${comment.authorName}...`}
                              className="flex-1 border-0 outline-hidden font-sans text-xs text-slate-800 pl-2 focus:ring-0 placeholder-slate-400"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleAddReply(comment.id);
                              }}
                            />
                            <button
                              onClick={() => handleAddReply(comment.id)}
                              className="rounded-md bg-indigo-600 text-white p-1.5 hover:bg-indigo-700 shadow-3xs flex items-center justify-center cursor-pointer"
                            >
                              <Send className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => setActiveReplyBox(null)}
                              className="text-[10px] text-slate-400 hover:text-slate-600 font-semibold px-1"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setActiveReplyBox(comment.id)}
                            className="inline-flex items-center border border-slate-100 bg-white hover:bg-slate-50 text-slate-500 font-sans text-[10px] font-bold px-2.5 py-1 rounded-md"
                          >
                            Reply to Thread
                          </button>
                        )}
                      </div>

                    </div>
                  ))}
                </div>
              )}

              {/* Comment Form Composer */}
              {user ? (
                <form onSubmit={handleAddComment} className="flex space-x-1.5 mt-2 bg-slate-50 border border-slate-200 p-2 rounded-xl">
                  <input
                    type="text"
                    required
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Enter professional advice, updates or coordinate validation rules..."
                    className="flex-1 bg-white border border-slate-200 outline-hidden rounded-lg pl-3 pr-2 py-1.5 font-sans text-xs text-slate-800 focus:border-indigo-500"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-xs font-bold px-4 cursor-pointer"
                  >
                    Post Comment
                  </button>
                </form>
              ) : (
                <div className="bg-slate-50 rounded-xl p-3 text-center border font-sans text-[11px] text-slate-400">
                  Please sign in with Google to post questions or valid progress remarks.
                </div>
              )}

            </div>
          )}

        </div>

      </div>

    </article>
  );
}

// Simple Helper to return contextual icons for each department
function LocationIcon({ department }: { department: string }) {
  switch (department) {
    case 'Roads':
      return <Construction className="h-4 w-4 text-amber-650" />;
    case 'Water':
      return <Droplet className="h-4 w-4 text-sky-500" />;
    case 'Electricity':
      return <Lightbulb className="h-4 w-4 text-amber-500 animate-pulse" />;
    case 'Waste':
      return <Trash2 className="h-4 w-4 text-rose-500" />;
    case 'Safety':
      return <Shield className="h-4 w-4 text-indigo-600" />;
    case 'Animals':
      return <PawPrint className="h-4 w-4 text-amber-700" />;
    case 'Environment':
      return <Leaf className="h-4 w-4 text-emerald-550" />;
    case 'Public Facilities':
      return <Building2 className="h-4 w-4 text-slate-600" />;
    default:
      return <HelpCircle className="h-4 w-4 text-slate-500" />;
  }
}

// LiveUserImpact fetches and renders user impact points dynamically in real-time
export function LiveUserImpact({ userId, fallbackValue }: { userId: string; fallbackValue?: number }) {
  const [points, setPoints] = useState<number | null>(null);

  useEffect(() => {
    if (!userId) return;
    const userRef = doc(db, 'users', userId);
    const unsubscribe = onSnapshot(
      userRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setPoints(snapshot.data().impactPoints ?? 0);
        } else if (fallbackValue !== undefined) {
          setPoints(fallbackValue);
        } else {
          setPoints(0);
        }
      },
      (err) => {
        console.error('Error listening to live user impact:', err);
      }
    );
    return () => unsubscribe();
  }, [userId, fallbackValue]);

  return <>{points !== null ? points : (fallbackValue ?? 0)}</>;
}
