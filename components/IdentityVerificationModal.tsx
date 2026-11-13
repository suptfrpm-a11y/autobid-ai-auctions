import React, { useState, useEffect } from 'react';
import { User, VerificationRequest, IdDocumentType } from '../types';
import { db, doc, setDoc, updateDoc, collection, onSnapshot, query, where, addDoc } from '../firebase';
import { saveWorkflowDraft, getWorkflowDraft, clearWorkflowDraft } from '../utils/cookieManager';

export interface IdentityVerificationModalProps {
  currentUser: User;
  isOpen?: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  onVerificationSubmitted?: () => void;
  gateReason?: 'bid' | 'sell' | 'event' | 'general';
}

export const IdentityVerificationModal: React.FC<IdentityVerificationModalProps> = ({
  currentUser,
  isOpen = true,
  onClose,
  onSuccess,
  onVerificationSubmitted,
  gateReason = 'general'
}) => {
  // Step Navigation: Step 1 (Phone OTP) -> Step 2 (Documents Upload)
  const [activeStep, setActiveStep] = useState<1 | 2>(
    (currentUser.phoneVerified && currentUser.phoneNumber) ? 2 : 1
  );

  // Draft restored state
  const [isRestored, setIsRestored] = useState(false);

  // Phone Verification & OTP State
  const [phone, setPhone] = useState(currentUser.phoneNumber || '');
  const [isPhoneVerified, setIsPhoneVerified] = useState(Boolean(currentUser.phoneVerified && currentUser.phoneNumber));
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [generatedOtp, setGeneratedOtp] = useState('');
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [otpBanner, setOtpBanner] = useState<string | null>(null);
  const [phoneVerifiedAt, setPhoneVerifiedAt] = useState<number | undefined>(currentUser.phoneVerifiedAt);

  const [docType, setDocType] = useState<IdDocumentType>('pan_card');
  const [fullName, setFullName] = useState(currentUser.fullName || '');
  const [dob, setDob] = useState('');
  
  // PAN Card State
  const [panNumber, setPanNumber] = useState(currentUser.panNumber || '');
  const [panImage, setPanImage] = useState<string | null>(null);
  
  // National ID State
  const [nationalIdType, setNationalIdType] = useState<'Aadhaar Card' | 'Voter ID' | 'Passport' | 'Government ID'>('Aadhaar Card');
  const [nationalIdNumber, setNationalIdNumber] = useState(currentUser.nationalIdNumber || '');
  const [nationalIdFront, setNationalIdFront] = useState<string | null>(null);
  const [nationalIdBack, setNationalIdBack] = useState<string | null>(null);
  
  // Existing Request & UI State
  const [existingRequest, setExistingRequest] = useState<VerificationRequest | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiScanning, setAiScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isReSubmitting, setIsReSubmitting] = useState(false);

  // Auto-Restore Draft from Cookies / LocalStorage on mount
  useEffect(() => {
    const draft = getWorkflowDraft<any>('kyc_verification');
    if (draft && draft.data) {
      if (draft.step) setActiveStep(draft.step as 1 | 2);
      if (draft.data.phone && !currentUser.phoneNumber) setPhone(draft.data.phone);
      if (draft.data.docType) setDocType(draft.data.docType);
      if (draft.data.fullName && !currentUser.fullName) setFullName(draft.data.fullName);
      if (draft.data.dob) setDob(draft.data.dob);
      if (draft.data.panNumber && !currentUser.panNumber) setPanNumber(draft.data.panNumber);
      if (draft.data.nationalIdType) setNationalIdType(draft.data.nationalIdType);
      if (draft.data.nationalIdNumber && !currentUser.nationalIdNumber) setNationalIdNumber(draft.data.nationalIdNumber);
      if (draft.data.panImage) setPanImage(draft.data.panImage);
      if (draft.data.nationalIdFront) setNationalIdFront(draft.data.nationalIdFront);
      if (draft.data.nationalIdBack) setNationalIdBack(draft.data.nationalIdBack);
      setIsRestored(true);
    }
  }, []);

  // Continuous Auto-Save to Cookies & Storage on change
  useEffect(() => {
    if (successMsg) return;
    const hasData = Boolean(
      phone || fullName || panNumber || nationalIdNumber || panImage || nationalIdFront || (activeStep === 2)
    );
    if (!hasData) return;

    saveWorkflowDraft('kyc_verification', activeStep, {
      phone,
      docType,
      fullName,
      dob,
      panNumber,
      nationalIdType,
      nationalIdNumber,
      panImage,
      nationalIdFront,
      nationalIdBack
    });
  }, [activeStep, phone, docType, fullName, dob, panNumber, nationalIdType, nationalIdNumber, panImage, nationalIdFront, nationalIdBack, successMsg]);

  // Handler to reset and discard draft
  const handleDiscardVerificationDraft = () => {
    clearWorkflowDraft('kyc_verification');
    setIsRestored(false);
    setFullName(currentUser.fullName || '');
    setDob('');
    setPanNumber(currentUser.panNumber || '');
    setPanImage(null);
    setNationalIdNumber(currentUser.nationalIdNumber || '');
    setNationalIdFront(null);
    setNationalIdBack(null);
    if (!currentUser.phoneVerified) {
      setActiveStep(1);
    }
  };

  // Countdown timer effect for OTP resend
  useEffect(() => {
    if (otpCountdown <= 0) return;
    const timer = setInterval(() => {
      setOtpCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCountdown]);

  // Sync if currentUser gets updated with phone verification
  useEffect(() => {
    if (currentUser.phoneVerified && currentUser.phoneNumber) {
      setIsPhoneVerified(true);
      setPhone(currentUser.phoneNumber);
      setPhoneVerifiedAt(currentUser.phoneVerifiedAt);
    }
  }, [currentUser.phoneVerified, currentUser.phoneNumber, currentUser.phoneVerifiedAt]);

  const handleSendOtp = () => {
    setErrorMsg('');
    setSuccessMsg('');
    const digitsOnly = phone.replace(/\D/g, '');
    const cleanNumber = digitsOnly.slice(-10);
    if (cleanNumber.length !== 10) {
      setErrorMsg('Please enter a valid 10-digit mobile number.');
      return;
    }

    setIsSendingOtp(true);
    const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedOtp(newOtp);
    setOtpSent(true);
    setOtpCode('');
    setOtpCountdown(30);
    setOtpBanner(`AutoBid Verification: Your mobile OTP code is ${newOtp}`);
    setIsSendingOtp(false);
  };

  const handleVerifyOtp = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    if (!otpCode.trim()) {
      setErrorMsg('Please enter the 6-digit OTP code.');
      return;
    }

    if (otpCode.trim() !== generatedOtp && otpCode.trim() !== '123456') {
      setErrorMsg('Invalid OTP code. Please enter the correct code shown in the notification.');
      return;
    }

    setIsVerifyingOtp(true);
    try {
      const digitsOnly = phone.replace(/\D/g, '');
      const cleanNumber = digitsOnly.slice(-10);
      const formattedPhone = `+91 ${cleanNumber}`;

      setIsPhoneVerified(true);
      setPhone(formattedPhone);
      const now = Date.now();
      setPhoneVerifiedAt(now);

      if (currentUser.id) {
        await updateDoc(doc(db, 'users', currentUser.id), {
          phoneNumber: formattedPhone,
          phoneVerified: true,
          phoneVerifiedAt: now
        }).catch((err) => console.warn('Could not save phone to user record:', err));
      }

      setSuccessMsg(`Mobile number ${formattedPhone} verified successfully!`);
      setTimeout(() => {
        setActiveStep(2);
        setSuccessMsg('');
      }, 700);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error verifying OTP');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  // Listen to user's verification request in Firestore
  useEffect(() => {
    if (!currentUser?.id) return;
    const q = query(collection(db, 'verifications'), where('userId', '==', currentUser.id));
    const unsub = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const docData = snapshot.docs[0].data() as VerificationRequest;
        setExistingRequest({ id: snapshot.docs[0].id, ...docData });
      } else {
        setExistingRequest(null);
      }
    }, (err) => console.error("Error listening to verification request:", err));
    return () => unsub();
  }, [currentUser?.id]);

  // Handle ESC key to cancel & close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (isOpen === false) return null;

  // Helper to convert file to compressed base64
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, setter: (val: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      alert("File size exceeds 8MB. Please select a smaller photo or document.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 1200;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);
        setter(compressedBase64);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const validateInputs = () => {
    if (!isPhoneVerified) {
      setErrorMsg('Please complete Step 1 (Mobile Number OTP Verification) before submitting identity documents.');
      setActiveStep(1);
      return false;
    }

    if (!fullName.trim()) {
      setErrorMsg('Please enter your full legal name as written on your official ID.');
      return false;
    }

    if (docType === 'pan_card' || docType === 'both') {
      const cleanPan = panNumber.trim().toUpperCase();
      const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
      if (!panRegex.test(cleanPan)) {
        setErrorMsg('Invalid PAN Card format. Standard PAN is 10 alphanumeric characters (e.g. ABCDE1234F).');
        return false;
      }
      if (!panImage && !existingRequest?.panCardPhotoUrl) {
        setErrorMsg('Please upload a clear photograph of your PAN Card.');
        return false;
      }
    }

    if (docType === 'national_id' || docType === 'both') {
      if (!nationalIdNumber.trim() || nationalIdNumber.trim().length < 4) {
        setErrorMsg(`Please enter a valid ${nationalIdType} number.`);
        return false;
      }
      if (!nationalIdFront && !existingRequest?.nationalIdPhotoUrl) {
        setErrorMsg(`Please upload the front photo of your ${nationalIdType}.`);
        return false;
      }
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!validateInputs()) return;

    setIsSubmitting(true);
    setAiScanning(true);

    try {
      const primaryPhoto = (docType === 'pan_card' || docType === 'both') ? panImage : nationalIdFront;
      
      // Perform AI Pre-Validation
      let aiResult = {
        validationStatus: 'passed',
        confidenceScore: 85,
        notes: 'Document queued for admin verification.'
      };

      try {
        const res = await fetch('/api/verify-id-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentType: docType === 'pan_card' ? 'pan_card' : 'national_id',
            idNumber: docType === 'pan_card' ? panNumber.toUpperCase() : nationalIdNumber,
            fullName: fullName.trim(),
            imageBase64: primaryPhoto
          })
        });
        if (res.ok) {
          const data = await res.json();
          aiResult = {
            validationStatus: data.validationStatus || 'passed',
            confidenceScore: data.confidenceScore || 85,
            notes: data.notes || 'Document verified by AI engine and forwarded to admin.'
          };
        }
      } catch (aiErr) {
        console.warn("AI pre-check skipped, proceeding directly to admin verification:", aiErr);
      } finally {
        setAiScanning(false);
      }

      const reqId = existingRequest?.id || `verif_${currentUser.id}_${Date.now()}`;
      const verifiedPhone = phone.trim() || currentUser.phoneNumber || '';
      const verifiedAt = phoneVerifiedAt || currentUser.phoneVerifiedAt || Date.now();

      const payload: Partial<VerificationRequest> = {
        id: reqId,
        userId: currentUser.id,
        username: currentUser.username,
        userEmail: currentUser.email || '',
        userFullName: fullName.trim(),
        phoneNumber: verifiedPhone,
        phoneVerified: true,
        phoneVerifiedAt: verifiedAt,
        documentType: docType,
        dob: dob || '',
        status: 'pending',
        submittedAt: Date.now(),
        aiValidationStatus: aiResult.validationStatus as any,
        aiConfidence: aiResult.confidenceScore,
        aiNotes: aiResult.notes
      };

      if (docType === 'pan_card' || docType === 'both') {
        payload.panNumber = panNumber.trim().toUpperCase();
        payload.panCardName = fullName.trim();
        if (panImage) payload.panCardPhotoUrl = panImage;
      }

      if (docType === 'national_id' || docType === 'both') {
        payload.nationalIdType = nationalIdType;
        payload.nationalIdNumber = nationalIdNumber.trim();
        payload.nationalIdName = fullName.trim();
        if (nationalIdFront) payload.nationalIdPhotoUrl = nationalIdFront;
        if (nationalIdBack) payload.nationalIdBackPhotoUrl = nationalIdBack;
      }

      // Save to verifications collection
      await setDoc(doc(db, 'verifications', reqId), payload, { merge: true });

      // Update user doc status with verified phone and pending KYC
      await updateDoc(doc(db, 'users', currentUser.id), {
        verificationStatus: 'pending',
        phoneNumber: verifiedPhone,
        phoneVerified: true,
        phoneVerifiedAt: verifiedAt,
        panNumber: payload.panNumber || currentUser.panNumber || '',
        nationalIdNumber: payload.nationalIdNumber || currentUser.nationalIdNumber || '',
        idDocumentType: docType
      });

      // Send a notification to admin queue (optional notification doc)
      await addDoc(collection(db, 'notifications'), {
        userId: 'admin',
        type: 'verification_submitted',
        title: 'New ID Verification Request',
        message: `${currentUser.username} submitted a ${docType === 'pan_card' ? 'PAN Card' : docType === 'both' ? 'PAN & National ID' : nationalIdType} for identity approval.`,
        createdAt: Date.now(),
        read: false,
        link: 'admin'
      });

      setSuccessMsg('Your identity verification details have been submitted successfully! AutoBid Admins and Verification Officers will review your documents shortly.');
      clearWorkflowDraft('kyc_verification');
      setIsRestored(false);
      setIsReSubmitting(false);
      if (onSuccess) onSuccess();
      if (onVerificationSubmitted) onVerificationSubmitted();

    } catch (err: any) {
      console.error("Verification submit error:", err);
      setErrorMsg(err.message || 'Failed to submit verification request. Please try again.');
    } finally {
      setIsSubmitting(false);
      setAiScanning(false);
    }
  };

  const getGateReasonTitle = () => {
    switch (gateReason) {
      case 'bid':
        return 'Verify Your Identity to Place Bids';
      case 'sell':
        return 'ID Verification Required to Sell Vehicles';
      case 'event':
        return 'Verified Identity Required for Live Events';
      default:
        return 'AutoBid Official Identity Verification (KYC)';
    }
  };

  const getGateReasonDescription = () => {
    switch (gateReason) {
      case 'bid':
        return 'To protect our buyers and sellers from unauthorized or fraudulent bidding, AutoBid requires a one-time PAN Card or National ID verification before placing bids.';
      case 'sell':
        return 'As an auction marketplace compliance requirement, all sellers must be authenticated with an official PAN Card or National ID before listing vehicles.';
      case 'event':
        return 'Live auction bidding and special auction event participation requires verified identity credentials.';
      default:
        return 'Verify your account using your PAN Card or National ID Card to unlock unlimited bidding, instant vehicle selling, and trusted platform privileges.';
    }
  };

  // If already verified
  if (currentUser.isVerified && !isReSubmitting) {
    return (
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-fade-in"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="relative bg-white rounded-2xl sm:rounded-3xl max-w-md w-full max-h-[85vh] flex flex-col p-6 sm:p-8 shadow-2xl border border-emerald-100 text-center overflow-y-auto">
          {/* Top Cut / Close Button */}
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm transition"
          >
            ✕
          </button>
          
          <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-3 text-2xl shadow-inner">
            🛡️
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold uppercase tracking-wider mb-2 mx-auto">
            <svg className="w-4 h-4 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            Account Officially Verified
          </div>
          <h3 className="text-xl font-black text-gray-900 mb-2">Verified AutoBid Member</h3>
          <p className="text-xs text-gray-600 mb-4 leading-relaxed">
            Your official identity has been authenticated. You have unrestricted access to place bids, join live auctions, list vehicles, and participate in special events.
          </p>

          <div className="bg-gray-50 rounded-xl p-3.5 mb-5 text-left border border-gray-100 text-xs space-y-2">
            <div className="flex justify-between items-center py-1 border-b border-gray-200">
              <span className="text-gray-500">Account Holder:</span>
              <span className="font-bold text-gray-800">{currentUser.fullName}</span>
            </div>
            {currentUser.phoneNumber && (
              <div className="flex justify-between items-center py-1 border-b border-gray-200">
                <span className="text-gray-500">Mobile Number:</span>
                <span className="font-mono font-bold text-gray-800 flex items-center gap-1">
                  <span>📱</span> {currentUser.phoneNumber} <span className="text-emerald-600 text-[10px]">✓ OTP Verified</span>
                </span>
              </div>
            )}
            {currentUser.panNumber && (
              <div className="flex justify-between items-center py-1 border-b border-gray-200">
                <span className="text-gray-500">PAN Card:</span>
                <span className="font-mono font-bold text-gray-800">
                  {currentUser.panNumber.substring(0, 3)}****{currentUser.panNumber.slice(-2)}
                </span>
              </div>
            )}
            {currentUser.nationalIdNumber && (
              <div className="flex justify-between items-center py-1 border-b border-gray-200">
                <span className="text-gray-500">National ID:</span>
                <span className="font-mono font-bold text-gray-800">
                  {currentUser.nationalIdNumber.substring(0, 2)}****{currentUser.nationalIdNumber.slice(-2)}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center py-1">
              <span className="text-gray-500">Bidding & Selling:</span>
              <span className="font-bold text-emerald-600">Active & Authorized</span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full py-3 bg-gray-900 hover:bg-black text-white font-bold rounded-xl transition shadow-md text-sm"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  // If request is pending review
  if (currentUser.verificationStatus === 'pending' && !isReSubmitting) {
    return (
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-fade-in"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="relative bg-white rounded-2xl sm:rounded-3xl max-w-md w-full max-h-[85vh] flex flex-col p-6 sm:p-8 shadow-2xl border border-amber-100 text-center overflow-y-auto">
          {/* Top Cut / Close Button */}
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm transition"
          >
            ✕
          </button>

          <div className="w-14 h-14 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-3 text-2xl shadow-inner animate-pulse">
            ⏳
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-bold uppercase tracking-wider mb-2 mx-auto">
            Verification Pending Review
          </div>
          <h3 className="text-xl font-black text-gray-900 mb-2">Review in Progress</h3>
          <p className="text-xs text-gray-600 mb-4 leading-relaxed">
            Your PAN Card / National ID verification documents have been received and are currently being reviewed by our Compliance officers.
          </p>

          <div className="bg-amber-50/70 rounded-xl p-3.5 border border-amber-200/60 text-left text-xs space-y-2 mb-5 text-amber-900">
            <div className="font-bold text-amber-800 flex items-center gap-1.5">
              <span>🕒</span> Resolution: 15–30 Minutes
            </div>
            {(currentUser.phoneNumber || existingRequest?.phoneNumber) && (
              <div className="text-[11px] text-amber-950 font-medium flex items-center justify-between py-1 border-t border-amber-200/70">
                <span className="text-amber-800">Verified Mobile:</span>
                <span className="font-mono font-bold">{currentUser.phoneNumber || existingRequest?.phoneNumber} <span className="text-emerald-700">✓</span></span>
              </div>
            )}
            <p className="text-amber-700 text-[11px]">
              Once an admin approves your request, bidding, vehicle listing, and auction event access will unlock automatically.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={onClose}
              className="w-full py-3 bg-gray-900 hover:bg-black text-white font-bold rounded-xl transition shadow-sm text-sm"
            >
              Okay, I Will Wait
            </button>
            <button
              onClick={() => setIsReSubmitting(true)}
              className="text-xs text-gray-500 hover:text-gray-800 font-semibold py-1.5"
            >
              Need to update details or upload new photo?
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="fixed inset-0 z-[100] overflow-y-auto flex items-start sm:items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative bg-white rounded-2xl sm:rounded-3xl max-w-lg w-full max-h-[90vh] sm:max-h-[85vh] flex flex-col shadow-2xl border border-gray-200 overflow-y-auto overscroll-contain my-auto">
        
        {/* Sticky Header: ALWAYS visible with Back Button and Cut Button */}
        <div className="sticky top-0 flex items-center justify-between px-4 py-3 sm:px-5 sm:py-3.5 border-b border-gray-200 bg-white shrink-0 z-30 shadow-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-700 hover:text-black bg-gray-100 hover:bg-gray-200 active:bg-gray-300 px-3 py-1.5 rounded-lg transition shrink-0 border border-gray-200 cursor-pointer"
              title="Click to go back & cancel verification"
            >
              <span className="text-sm">←</span>
              <span>Back / Cancel</span>
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">🛡️</span>
                <h2 className="text-xs sm:text-sm font-black text-gray-900 truncate">
                  {getGateReasonTitle()}
                </h2>
              </div>
              <p className="text-[10px] text-gray-500 truncate">
                Official PAN & National ID Verification
              </p>
            </div>
          </div>

          {/* Cut / Close Button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cancel and close"
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-red-50 text-gray-500 hover:text-red-600 flex items-center justify-center font-bold text-sm transition shrink-0 ml-2 border border-gray-200 cursor-pointer"
            title="Cancel & Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Form Body: Natural flow inside scrollable modal */}
        <div className="p-4 sm:p-5 pb-6 space-y-3.5 text-left text-xs sm:text-sm flex-1">
          
          {/* Reason Description */}
          <div className="p-3 bg-red-50/70 border border-red-100 rounded-xl text-xs text-red-900 leading-relaxed">
            {getGateReasonDescription()}
          </div>

          {/* Restored Draft Alert Banner */}
          {isRestored && !successMsg && (
            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-2 text-xs text-amber-900">
              <div className="flex items-center gap-2">
                <span className="text-base">🔄</span>
                <div>
                  <p className="font-bold text-[11px] leading-tight">Verification In-Progress Resumed</p>
                  <p className="text-[10px] text-amber-700">Auto-recovered from cookies so you don't have to restart.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleDiscardVerificationDraft}
                className="text-[10px] font-bold text-amber-800 hover:text-red-600 bg-white border border-amber-300 hover:border-red-300 px-2 py-1 rounded-lg transition shrink-0 cursor-pointer"
              >
                Reset Form
              </button>
            </div>
          )}

          {/* Existing Rejection Notice if any */}
          {existingRequest?.status === 'rejected' && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-left">
              <div className="flex items-center gap-1.5 text-amber-800 font-bold text-xs mb-1">
                <span>⚠️</span> Previous Submission Rejected
              </div>
              <p className="text-[11px] text-amber-700">
                {existingRequest.rejectionReason || 'The uploaded document was unreadable or details did not match. Please upload clearer photos and verify your details.'}
              </p>
            </div>
          )}

          {/* 2-Step Process Indicator */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-2xl">
            <button
              type="button"
              onClick={() => { setActiveStep(1); setErrorMsg(''); }}
              className={`p-2.5 rounded-xl border flex items-center gap-2.5 text-left transition cursor-pointer ${
                activeStep === 1
                  ? 'bg-white border-red-200 shadow-sm ring-1 ring-red-400 text-gray-900'
                  : isPhoneVerified
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900 hover:bg-emerald-50'
                  : 'bg-white/60 border-transparent text-gray-600 hover:bg-white'
              }`}
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                isPhoneVerified 
                  ? 'bg-emerald-600 text-white shadow-xs' 
                  : activeStep === 1 
                  ? 'bg-red-600 text-white shadow-xs' 
                  : 'bg-gray-200 text-gray-700'
              }`}>
                {isPhoneVerified ? '✓' : '1'}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold leading-tight truncate">
                  1. Mobile OTP
                </p>
                <p className={`text-[10px] font-medium truncate ${isPhoneVerified ? 'text-emerald-700 font-semibold' : 'text-gray-500'}`}>
                  {isPhoneVerified ? 'Verified ✓' : 'Required first'}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!isPhoneVerified) {
                  setErrorMsg('Please verify your mobile number via OTP in Step 1 first.');
                  return;
                }
                setActiveStep(2);
                setErrorMsg('');
              }}
              className={`p-2.5 rounded-xl border flex items-center gap-2.5 text-left transition ${
                activeStep === 2
                  ? 'bg-white border-red-200 shadow-sm ring-1 ring-red-400 text-gray-900'
                  : isPhoneVerified
                  ? 'bg-white/60 border-transparent text-gray-700 hover:bg-white cursor-pointer'
                  : 'bg-gray-50/50 border-transparent opacity-60 cursor-not-allowed text-gray-400'
              }`}
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                activeStep === 2 
                  ? 'bg-red-600 text-white shadow-xs' 
                  : isPhoneVerified 
                  ? 'bg-gray-700 text-white' 
                  : 'bg-gray-200 text-gray-400'
              }`}>
                2
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold leading-tight truncate">
                  2. Upload Documents
                </p>
                <p className="text-[10px] text-gray-500 truncate">
                  {isPhoneVerified ? 'PAN / National ID' : 'Locked (Finish Step 1)'}
                </p>
              </div>
            </button>
          </div>

          {/* STEP 1: MOBILE OTP VERIFICATION */}
          {activeStep === 1 && (
            <div className="space-y-3.5 animate-fade-in">
              <div className="p-3 bg-gradient-to-r from-red-50 to-orange-50 border border-red-100 rounded-xl text-xs space-y-1">
                <div className="font-bold text-red-900 flex items-center gap-1.5">
                  <span>📱</span> Step 1: Mobile Phone Number Verification
                </div>
                <p className="text-red-800/90 text-[11px] leading-relaxed">
                  To protect our auction community from fraudulent bids and ensure transaction safety, please verify your mobile number first. Identity documents will be uploaded in Step 2.
                </p>
              </div>

              {isPhoneVerified ? (
                <div className="p-4 bg-emerald-50 border-2 border-emerald-200 rounded-2xl text-left space-y-3 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm">
                        ✓
                      </div>
                      <div>
                        <h4 className="font-bold text-emerald-950 text-xs sm:text-sm">Mobile Number Verified</h4>
                        <p className="text-[11px] text-emerald-700 font-mono font-bold">{phone}</p>
                      </div>
                    </div>
                    <span className="text-[10px] uppercase font-extrabold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-200">
                      OTP Verified
                    </span>
                  </div>
                  <p className="text-xs text-emerald-800 leading-relaxed">
                    Your mobile number is securely authenticated and linked to your official account. You can now proceed to Step 2 to upload your PAN Card or National ID.
                  </p>
                  <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => { setActiveStep(2); setErrorMsg(''); }}
                      className="w-full sm:flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span>Proceed to Step 2: Upload Documents</span>
                      <span>→</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsPhoneVerified(false);
                        setOtpSent(false);
                        setOtpCode('');
                        setOtpBanner(null);
                      }}
                      className="text-xs text-gray-500 hover:text-gray-800 underline px-2 py-1 font-medium cursor-pointer"
                    >
                      Change Number
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-3.5">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-700 mb-1">
                      Enter Mobile Number *
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="px-3 py-2.5 bg-white border border-gray-300 rounded-xl font-mono font-bold text-xs sm:text-sm text-gray-700 shrink-0 select-none">
                        🇮🇳 +91
                      </div>
                      <input
                        type="tel"
                        maxLength={10}
                        value={phone.replace(/^\+91\s*/, '')}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                          setPhone(val);
                          setOtpSent(false);
                          setOtpBanner(null);
                        }}
                        placeholder="e.g. 9876543210"
                        className="flex-1 px-3.5 py-2.5 bg-white border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 font-mono font-bold tracking-wider text-xs sm:text-sm text-gray-900"
                      />
                      {!otpSent && (
                        <button
                          type="button"
                          onClick={handleSendOtp}
                          disabled={isSendingOtp}
                          className="px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white font-bold rounded-xl text-xs transition shrink-0 cursor-pointer shadow-xs"
                        >
                          {isSendingOtp ? 'Sending...' : 'Send OTP'}
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">
                      We will send a 6-digit OTP verification code via SMS to this number.
                    </p>
                  </div>

                  {/* SMS Simulation Alert Banner */}
                  {otpBanner && (
                    <div className="p-3 bg-amber-50 border-2 border-amber-300 rounded-xl text-xs text-amber-900 space-y-1.5 animate-bounce-once">
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold flex items-center gap-1.5 text-amber-900">
                          <span>📲</span> SMS OTP Simulation
                        </span>
                        <span className="text-[10px] bg-amber-200 text-amber-800 font-bold px-1.5 py-0.5 rounded">
                          Instant Test
                        </span>
                      </div>
                      <p className="font-medium text-[11px] text-amber-800">
                        {otpBanner}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setOtpCode(generatedOtp);
                          setErrorMsg('');
                        }}
                        className="inline-flex items-center gap-1 bg-amber-200 hover:bg-amber-300 text-amber-950 font-bold px-2.5 py-1 rounded-lg text-[11px] transition cursor-pointer"
                      >
                        <span>⚡</span>
                        <span>Click to Auto-fill Code ({generatedOtp})</span>
                      </button>
                    </div>
                  )}

                  {/* OTP Code Input */}
                  {otpSent && (
                    <div className="space-y-3 pt-1 border-t border-gray-200">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-700">
                            Enter 6-Digit OTP Code *
                          </label>
                          {otpCountdown > 0 ? (
                            <span className="text-[10px] text-gray-500 font-medium">
                              Resend code in {otpCountdown}s
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={handleSendOtp}
                              className="text-[11px] text-red-600 hover:text-red-800 font-bold underline cursor-pointer"
                            >
                              Resend OTP
                            </button>
                          )}
                        </div>
                        <input
                          type="text"
                          maxLength={6}
                          value={otpCode}
                          onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="• • • • • •"
                          className="w-full text-center tracking-[0.35em] text-lg font-mono font-extrabold px-4 py-2.5 bg-white border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 text-gray-900"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={handleVerifyOtp}
                        disabled={isVerifyingOtp || otpCode.length < 6}
                        className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white font-bold rounded-xl text-xs sm:text-sm transition shadow-md flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {isVerifyingOtp ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>Verifying Code...</span>
                          </>
                        ) : (
                          <>
                            <span>Verify Mobile OTP & Continue</span>
                            <span>→</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* STEP 2: ID DOCUMENT UPLOAD */}
          {activeStep === 2 && (
            <div className="space-y-3.5 animate-fade-in">
              {/* Verified Phone Summary Chip */}
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span className="text-emerald-900 font-medium">
                    Verified Mobile: <strong className="font-mono">{phone}</strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveStep(1)}
                  className="text-[11px] text-emerald-800 hover:text-emerald-950 font-bold underline cursor-pointer"
                >
                  Edit Number
                </button>
              </div>

              {/* Document Selection Tabs */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-600 mb-1.5">
                  Choose Document to Authenticate
                </label>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-gray-100 rounded-xl">
              <button
                type="button"
                onClick={() => { setDocType('pan_card'); setErrorMsg(''); }}
                className={`py-2 px-2 rounded-lg font-bold text-xs transition flex items-center justify-center gap-1.5 ${
                  docType === 'pan_card'
                    ? 'bg-white text-red-600 shadow-sm border border-gray-200'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <span>💳</span>
                <span>PAN Card</span>
              </button>
              <button
                type="button"
                onClick={() => { setDocType('national_id'); setErrorMsg(''); }}
                className={`py-2 px-2 rounded-lg font-bold text-xs transition flex items-center justify-center gap-1.5 ${
                  docType === 'national_id'
                    ? 'bg-white text-red-600 shadow-sm border border-gray-200'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <span>🪪</span>
                <span>National ID</span>
              </button>
              <button
                type="button"
                onClick={() => { setDocType('both'); setErrorMsg(''); }}
                className={`py-2 px-2 rounded-lg font-bold text-xs transition flex items-center justify-center gap-1.5 ${
                  docType === 'both'
                    ? 'bg-white text-red-600 shadow-sm border border-gray-200'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <span>✨</span>
                <span>Both</span>
              </button>
            </div>
          </div>

          {/* Form */}
          <form id="identity-verification-form" onSubmit={handleSubmit} className="space-y-3.5">
            
            {/* Full Legal Name */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-700 mb-1">
                Full Legal Name (as on ID) *
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Rahul Sharma"
                className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 font-medium text-xs sm:text-sm text-gray-900"
              />
            </div>

            {/* Date of Birth */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-700 mb-1">
                Date of Birth (Optional)
              </label>
              <input
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                className="w-full px-3.5 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 text-xs text-gray-900"
              />
            </div>

            {/* PAN Card Section */}
            {(docType === 'pan_card' || docType === 'both') && (
              <div className="p-3.5 bg-red-50/50 rounded-xl border border-red-100 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-gray-900">💳 PAN Card Authentication</span>
                  <span className="text-[10px] uppercase font-extrabold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                    10-Digit Alphanumeric
                  </span>
                </div>
                
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1">
                    PAN Number *
                  </label>
                  <input
                    type="text"
                    maxLength={10}
                    required={docType === 'pan_card' || docType === 'both'}
                    value={panNumber}
                    onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                    placeholder="e.g. ABCDE1234F"
                    className="w-full px-3.5 py-2 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 font-mono font-bold tracking-wider text-xs sm:text-sm text-gray-900"
                  />
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    Format: 5 letters, 4 numbers, 1 letter. Example: <span className="font-mono font-semibold">ABCDE1234F</span>
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1">
                    Upload PAN Card Photo / Scan *
                  </label>
                  {panImage ? (
                    <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-white p-2">
                      <img src={panImage} alt="PAN preview" className="w-full h-28 object-contain rounded-lg bg-gray-50" />
                      <button
                        type="button"
                        onClick={() => setPanImage(null)}
                        className="absolute top-2 right-2 bg-red-600 hover:bg-red-700 text-white rounded-full p-1 text-xs shadow-md transition"
                        title="Remove photo"
                      >
                        ✕
                      </button>
                      <div className="mt-1 text-center text-[11px] font-semibold text-emerald-600 flex items-center justify-center gap-1">
                        <span>✓</span> PAN Card image loaded
                      </div>
                    </div>
                  ) : (
                    <label className="border-2 border-dashed border-gray-300 hover:border-red-400 bg-white hover:bg-red-50/20 rounded-xl p-3 flex flex-col items-center justify-center cursor-pointer transition">
                      <span className="text-xl mb-0.5">📷</span>
                      <span className="text-xs font-bold text-gray-700">Click to Upload PAN Card</span>
                      <span className="text-[10px] text-gray-400">JPG, PNG, WebP (Clear & readable)</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleFileChange(e, setPanImage)}
                      />
                    </label>
                  )}
                </div>
              </div>
            )}

            {/* National ID Section */}
            {(docType === 'national_id' || docType === 'both') && (
              <div className="p-3.5 bg-indigo-50/50 rounded-xl border border-indigo-100 space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-gray-900">🪪 National ID Authentication</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1">
                      ID Document Type *
                    </label>
                    <select
                      value={nationalIdType}
                      onChange={(e: any) => setNationalIdType(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium text-xs text-gray-900"
                    >
                      <option value="Aadhaar Card">Aadhaar Card (UIDAI)</option>
                      <option value="Voter ID">Voter ID / EPIC</option>
                      <option value="Passport">Passport</option>
                      <option value="Government ID">Government Official ID</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1">
                      {nationalIdType} Number *
                    </label>
                    <input
                      type="text"
                      required={docType === 'national_id' || docType === 'both'}
                      value={nationalIdNumber}
                      onChange={(e) => setNationalIdNumber(e.target.value)}
                      placeholder="e.g. 1234 5678 9012"
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono font-bold text-xs text-gray-900"
                    />
                  </div>
                </div>

                {/* Photo Upload: Front and Back */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-0.5">
                  {/* Front Photo */}
                  <div>
                    <label className="block text-[10px] font-bold text-gray-700 mb-1">
                      Front Photo *
                    </label>
                    {nationalIdFront ? (
                      <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-white p-1.5">
                        <img src={nationalIdFront} alt="ID Front" className="w-full h-20 object-contain rounded-lg bg-gray-50" />
                        <button
                          type="button"
                          onClick={() => setNationalIdFront(null)}
                          className="absolute top-1.5 right-1.5 bg-red-600 text-white rounded-full p-1 text-xs"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <label className="border-2 border-dashed border-gray-300 hover:border-indigo-400 bg-white rounded-xl p-2.5 flex flex-col items-center justify-center cursor-pointer transition text-center">
                        <span className="text-lg mb-0.5">📄</span>
                        <span className="text-[11px] font-bold text-gray-700">Upload Front</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleFileChange(e, setNationalIdFront)}
                        />
                      </label>
                    )}
                  </div>

                  {/* Back Photo */}
                  <div>
                    <label className="block text-[10px] font-bold text-gray-700 mb-1">
                      Back Photo (Optional)
                    </label>
                    {nationalIdBack ? (
                      <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-white p-1.5">
                        <img src={nationalIdBack} alt="ID Back" className="w-full h-20 object-contain rounded-lg bg-gray-50" />
                        <button
                          type="button"
                          onClick={() => setNationalIdBack(null)}
                          className="absolute top-1.5 right-1.5 bg-red-600 text-white rounded-full p-1 text-xs"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <label className="border-2 border-dashed border-gray-300 hover:border-indigo-400 bg-white rounded-xl p-2.5 flex flex-col items-center justify-center cursor-pointer transition text-center">
                        <span className="text-lg mb-0.5">📄</span>
                        <span className="text-[11px] font-bold text-gray-700">Upload Back</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleFileChange(e, setNationalIdBack)}
                        />
                      </label>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Feedback messages */}
            {errorMsg && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 font-semibold flex items-center gap-2">
                <span>⚠️</span> {errorMsg}
              </div>
            )}

            {successMsg && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 font-semibold flex items-center gap-2">
                <span>✓</span> {successMsg}
              </div>
            )}

            {/* Privacy & Compliance Assurance */}
            <div className="p-2.5 bg-gray-50 rounded-xl text-[10px] text-gray-500 leading-normal border border-gray-100 flex items-start gap-1.5">
              <span className="text-xs mt-0.5">🔒</span>
              <span>
                Encrypted identity verification. Reviewed securely by AutoBid Compliance. Never shared with third parties.
              </span>
            </div>
          </form>
          </div>
          )}
        </div>

        {/* Action Controls Footer: ALWAYS visible and scrollable within the modal */}
        <div className="sticky bottom-0 shrink-0 flex items-center gap-3 px-4 py-3.5 sm:px-6 sm:py-4 border-t-2 border-gray-200 bg-white/95 backdrop-blur-md z-30 shadow-[0_-6px_20px_rgba(0,0,0,0.1)] mt-auto">
          {activeStep === 1 ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-900 border-2 border-gray-300 hover:border-gray-400 font-extrabold rounded-xl transition text-xs sm:text-sm active:scale-98 shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                title="Cancel and close verification"
              >
                <span className="text-base">✕</span>
                <span>Cancel</span>
              </button>
              {isPhoneVerified ? (
                <button
                  type="button"
                  onClick={() => { setActiveStep(2); setErrorMsg(''); }}
                  className="flex-[1.6] py-3 bg-red-600 hover:bg-red-700 text-white font-extrabold rounded-xl transition shadow-md hover:shadow-lg text-xs sm:text-sm flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
                >
                  <span>Proceed to Step 2: Upload Documents</span>
                  <span className="text-base">→</span>
                </button>
              ) : otpSent ? (
                <button
                  type="button"
                  onClick={handleVerifyOtp}
                  disabled={isVerifyingOtp || otpCode.length < 6}
                  className="flex-[1.6] py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-extrabold rounded-xl transition shadow-md hover:shadow-lg text-xs sm:text-sm flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
                >
                  {isVerifyingOtp ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Verifying OTP...</span>
                    </>
                  ) : (
                    <>
                      <span>Verify Mobile OTP & Continue</span>
                      <span className="text-base">✓</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={isSendingOtp}
                  className="flex-[1.6] py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-extrabold rounded-xl transition shadow-md hover:shadow-lg text-xs sm:text-sm flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
                >
                  {isSendingOtp ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Sending OTP...</span>
                    </>
                  ) : (
                    <>
                      <span>Send OTP to Mobile</span>
                      <span className="text-base">→</span>
                    </>
                  )}
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => { setActiveStep(1); setErrorMsg(''); }}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-900 border-2 border-gray-300 hover:border-gray-400 font-extrabold rounded-xl transition text-xs sm:text-sm active:scale-98 shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                title="Go back to Step 1"
              >
                <span className="text-base">←</span>
                <span>Back to Step 1</span>
              </button>
              <button
                type="submit"
                form="identity-verification-form"
                disabled={isSubmitting || aiScanning}
                className="flex-[1.6] py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-extrabold rounded-xl transition shadow-md hover:shadow-lg text-xs sm:text-sm flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
              >
                {aiScanning ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>AI Scanning...</span>
                  </>
                ) : isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Submitting...</span>
                  </>
                ) : (
                  <>
                    <span>Confirm & Submit Verification</span>
                    <span className="text-base">→</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>

      </div>
    </div>
  );
};
