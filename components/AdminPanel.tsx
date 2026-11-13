import React, { useState, useEffect } from 'react';
import { db, collection, onSnapshot, doc, updateDoc, getDocs, setDoc, deleteDoc, addDoc, getDoc } from '../firebase';
import { User, Vehicle, VehicleStatus, WithdrawalRequest, VerificationRequest, WalletTransaction } from '../types';
import type { UserRole } from '../types';
import { AdminAuditLogs } from './admin/AdminAuditLogs';
import { AdminContentCMS } from './admin/AdminContentCMS';
import { AdminNotifications } from './admin/AdminNotifications';
import { AdminReports } from './admin/AdminReports';
import { AdminAppConfig } from './admin/AdminAppConfig';
import { AdminCoupons } from './admin/AdminCoupons';
import { AdminVendors } from './admin/AdminVendors';
import { AdminModeration } from './admin/AdminModeration';
import { AdminSessions } from './admin/AdminSessions';
import { AdminVersionControl } from './admin/AdminVersionControl';
import { AdminFinancialManagement } from './admin/AdminFinancialManagement';
import { AdminCookiesCMS } from './admin/AdminCookiesCMS';
import { AdminAiMonitor } from './admin/AdminAiMonitor';
import { AdminAiBrain } from './admin/AdminAiBrain';
import { logAdminAction } from './admin/adminAuditHelper';
import { TransactionReceiptModal } from './TransactionReceiptModal';
import { enrichTransaction, getPaymentMethodInfo } from '../utils/transactionHelper';

interface AdminPanelProps {
  currentUser: User | null;
  onNavigate: (view: string) => void;
  onSelectVehicle?: (vehicle: Vehicle) => void;
}

export type AdminTab =
  | 'dashboard'
  | 'financial_management'
  | 'users'
  | 'content'
  | 'ledger'
  | 'withdrawals'
  | 'notifications'
  | 'reports'
  | 'employees'
  | 'pending'
  | 'tickets'
  | 'chatting'
  | 'appeals'
  | 'audit'
  | 'config'
  | 'coupons'
  | 'vendors'
  | 'moderation'
  | 'sessions'
  | 'version'
  | 'verifications'
  | 'cookies'
  | 'ai_monitor'
  | 'ai_brain';

export const AdminPanel: React.FC<AdminPanelProps> = ({ currentUser, onNavigate, onSelectVehicle }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [vehiclesCount, setVehiclesCount] = useState<Record<string, number>>({});
  const [allVehicles, setAllVehicles] = useState<Vehicle[]>([]);
  const [auctionFilter, setAuctionFilter] = useState<'all' | 'live' | 'upcoming' | 'sold' | 'pending' | 'restricted' | 'shadow_banned'>('all');
  const [tickets, setTickets] = useState<any[]>([]);
  const [appeals, setAppeals] = useState<any[]>([]);
  const [supportChats, setSupportChats] = useState<any[]>([]);
  const [verifications, setVerifications] = useState<VerificationRequest[]>([]);
  const [verificationFilter, setVerificationFilter] = useState<'all' | 'pending' | 'verified' | 'rejected'>('all');
  const [verificationSearchQuery, setVerificationSearchQuery] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [aiBrainInitialQuery, setAiBrainInitialQuery] = useState<string>('');
  
  // In-app modal and feedback state for verifications (avoids iframe-blocked window.confirm/prompt)
  const [verifActionModal, setVerifActionModal] = useState<{
    type: 'approve' | 'reject' | 'revoke';
    req?: VerificationRequest;
    userId?: string;
    username?: string;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('Document photo was blurry or name did not match.');
  const [isProcessingVerif, setIsProcessingVerif] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // In-app modal for vehicle moderation actions (Restrict, Shadow Ban, Delete, Reject, Edit Reserve)
  const [vehicleActionModal, setVehicleActionModal] = useState<{
    type: 'restrict' | 'shadow_ban' | 'delete' | 'reject' | 'edit_reserve';
    vehicle: Vehicle;
  } | null>(null);
  const [vehicleActionReason, setVehicleActionReason] = useState<string>('');
  const [newReservePriceInput, setNewReservePriceInput] = useState<number>(0);
  const [isProcessingVehicleAction, setIsProcessingVehicleAction] = useState<boolean>(false);

  const handleExecuteVehicleAction = async () => {
    if (!vehicleActionModal) return;
    const { type, vehicle } = vehicleActionModal;
    setIsProcessingVehicleAction(true);

    try {
      if (type === 'restrict') {
        const toggle = !vehicle.isRestricted;
        const reason = toggle ? (vehicleActionReason.trim() || 'Administrative moderation review') : '';
        
        // Optimistic local update
        setAllVehicles(prev => prev.map(v => v.id === vehicle.id ? { ...v, isRestricted: toggle, restrictionReason: reason } : v));
        
        await updateDoc(doc(db, 'vehicles', vehicle.id), {
          isRestricted: toggle,
          restrictionReason: reason
        });
        await logAdminAction(currentUser, toggle ? 'RESTRICT_VEHICLE' : 'UNRESTRICT_VEHICLE', 'vehicles', vehicle.id, `${toggle ? 'Restricted' : 'Unrestricted'} vehicle: ${reason}`);
        setActionFeedback({
          message: toggle 
            ? `Listing for "${vehicle.year} ${vehicle.make} ${vehicle.model}" is now RESTRICTED. Bids and purchases are locked.` 
            : `Restriction removed from "${vehicle.year} ${vehicle.make} ${vehicle.model}".`,
          type: 'success'
        });
      } else if (type === 'shadow_ban') {
        const toggle = !vehicle.isShadowBanned;
        
        // Optimistic local update
        setAllVehicles(prev => prev.map(v => v.id === vehicle.id ? { ...v, isShadowBanned: toggle } : v));
        
        await updateDoc(doc(db, 'vehicles', vehicle.id), {
          isShadowBanned: toggle
        });
        await logAdminAction(currentUser, toggle ? 'SHADOW_BAN_VEHICLE' : 'UN_SHADOW_BAN_VEHICLE', 'vehicles', vehicle.id, `${toggle ? 'Shadow banned' : 'Removed shadow ban from'} vehicle`);
        setActionFeedback({
          message: toggle 
            ? `Listing for "${vehicle.year} ${vehicle.make} ${vehicle.model}" is now SHADOW-BANNED (hidden from regular search & feeds).` 
            : `Shadow ban removed from "${vehicle.year} ${vehicle.make} ${vehicle.model}".`,
          type: 'success'
        });
      } else if (type === 'delete') {
        // Optimistic local update
        setAllVehicles(prev => prev.filter(v => v.id !== vehicle.id));
        
        await deleteDoc(doc(db, 'vehicles', vehicle.id));
        await logAdminAction(currentUser, 'DELETE_VEHICLE', 'vehicles', vehicle.id, `Permanently deleted vehicle listing ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
        setActionFeedback({
          message: `Vehicle listing "${vehicle.year} ${vehicle.make} ${vehicle.model}" was permanently deleted!`,
          type: 'success'
        });
      } else if (type === 'reject') {
        const reason = vehicleActionReason.trim() || 'Submission did not meet listing standards';
        setAllVehicles(prev => prev.map(v => v.id === vehicle.id ? { ...v, status: 'Rejected' as any, rejectionReason: reason } : v));
        await updateDoc(doc(db, 'vehicles', vehicle.id), { status: 'Rejected', rejectionReason: reason });
        await logAdminAction(currentUser, 'REJECT_LISTING', 'vehicles', vehicle.id, `Rejected listing: ${reason}`);
        setActionFeedback({
          message: `Listing rejected. Reason recorded.`,
          type: 'success'
        });
      } else if (type === 'edit_reserve') {
        const p = Math.max(0, newReservePriceInput || 0);
        setAllVehicles(prev => prev.map(v => v.id === vehicle.id ? { ...v, startingPrice: p } : v));
        await updateDoc(doc(db, 'vehicles', vehicle.id), { startingPrice: p });
        await logAdminAction(currentUser, 'UPDATE_RESERVE_PRICE', 'vehicles', vehicle.id, `Updated reserve price to ₹${p.toLocaleString()}`);
        setActionFeedback({
          message: `Reserve price updated to ₹${p.toLocaleString()}!`,
          type: 'success'
        });
      }
    } catch (err: any) {
      console.error("Error executing vehicle action:", err);
      setActionFeedback({
        message: `Action error: ${err.message || 'Operation failed'}`,
        type: 'error'
      });
    } finally {
      setIsProcessingVehicleAction(false);
      setVehicleActionModal(null);
    }
  };

  // In-app modal for User Moderation actions (Suspend, Unsuspend, Delete User, Change Role, Verify KYC)
  const [userActionModal, setUserActionModal] = useState<{
    type: 'suspend' | 'unsuspend' | 'delete' | 'role' | 'kyc';
    user: User;
  } | null>(null);
  const [userActionReason, setUserActionReason] = useState<string>('');
  const [userActionSuspensionType, setUserActionSuspensionType] = useState<'temporary' | 'permanent'>('temporary');
  const [userActionNewRole, setUserActionNewRole] = useState<UserRole>('user');
  const [deleteUserListingsToo, setDeleteUserListingsToo] = useState<boolean>(true);
  const [isProcessingUserAction, setIsProcessingUserAction] = useState<boolean>(false);

  // Audience engagement modal (view real viewers, likes, wishlist)
  const [audienceInspectModal, setAudienceInspectModal] = useState<{
    title: string;
    type: 'views' | 'likes' | 'wishlist';
    vehicle: Vehicle;
    users: { userId: string; username: string; fullName?: string; avatarUrl?: string; timestamp: number }[];
  } | null>(null);

  // User listings filter in inspection view
  const [userVehiclesFilter, setUserVehiclesFilter] = useState<'all' | 'auction' | 'direct' | 'live' | 'upcoming' | 'sold' | 'restricted'>('all');
  // User inspection tab (Vehicles vs Financial Ledger)
  const [selectedUserDetailTab, setSelectedUserDetailTab] = useState<'vehicles' | 'ledger'>('vehicles');
  const [adminSelectedTxForReceipt, setAdminSelectedTxForReceipt] = useState<WalletTransaction | null>(null);
  const [userLedgerFilter, setUserLedgerFilter] = useState<'all' | 'credit' | 'debit' | 'failed'>('all');
  const [userLedgerSearch, setUserLedgerSearch] = useState<string>('');

  const handleExecuteUserAction = async () => {
    if (!userActionModal) return;
    const { type, user } = userActionModal;
    setIsProcessingUserAction(true);

    try {
      if (type === 'suspend') {
        if (!currentUser || currentUser.role !== 'admin') {
          if (!['support', 'employee'].includes(currentUser?.role || '') || userActionSuspensionType !== 'temporary') {
            setActionFeedback({ message: 'Only admins can suspend accounts.', type: 'error' });
            return;
          }
        }
        if (currentUser && user.id === currentUser.id) {
          setActionFeedback({ message: 'You cannot suspend your own admin account.', type: 'error' });
          return;
        }

        const reason = userActionReason.trim() || `Suspended by administrator (${userActionSuspensionType === 'permanent' ? 'Permanent Ban' : 'Temporary Suspension'})`;
        
        // Optimistic update
        setUsers(prev => prev.map(u => u.id === user.id ? { ...u, suspensionStatus: userActionSuspensionType } : u));
        if (selectedUser?.id === user.id) {
          setSelectedUser(prev => prev ? { ...prev, suspensionStatus: userActionSuspensionType } : null);
        }

        await updateDoc(doc(db, 'users', user.id), {
          suspensionStatus: userActionSuspensionType,
          suspensionReason: reason,
          suspendedAt: Date.now()
        });

        await logAdminAction(
          currentUser, 
          userActionSuspensionType === 'permanent' ? 'PERMANENT_SUSPEND_USER' : 'TEMPORARY_SUSPEND_USER', 
          'users', 
          user.id, 
          `${userActionSuspensionType === 'permanent' ? 'Permanently banned' : 'Temporarily suspended'} @${user.username}: ${reason}`
        );

        setActionFeedback({
          message: `User @${user.username} has been ${userActionSuspensionType}ly suspended.`,
          type: 'success'
        });
      } else if (type === 'unsuspend') {
        // Optimistic update
        setUsers(prev => prev.map(u => u.id === user.id ? { ...u, suspensionStatus: 'none', isDeleted: false } : u));
        if (selectedUser?.id === user.id) {
          setSelectedUser(prev => prev ? { ...prev, suspensionStatus: 'none', isDeleted: false } : null);
        }

        await updateDoc(doc(db, 'users', user.id), {
          suspensionStatus: 'none',
          suspensionReason: '',
          isDeleted: false
        });

        await logAdminAction(currentUser, 'UNSUSPEND_USER', 'users', user.id, `Reactivated account for @${user.username}`);

        setActionFeedback({
          message: `User @${user.username}'s account was successfully reactivated!`,
          type: 'success'
        });
      } else if (type === 'delete') {
        if (!currentUser || currentUser.role !== 'admin') {
          setActionFeedback({ message: 'Only admins have permission to permanently delete user accounts.', type: 'error' });
          return;
        }
        if (currentUser && user.id === currentUser.id) {
          setActionFeedback({ message: 'You cannot delete your own admin account.', type: 'error' });
          return;
        }

        // Delete user's vehicles if option selected
        if (deleteUserListingsToo) {
          const userVehicleIds = allVehicles
            .filter(v => (v.ownerId && v.ownerId === user.id) || (v.ownerUsername && user.username && v.ownerUsername.toLowerCase() === user.username.toLowerCase()))
            .map(v => v.id);

          setAllVehicles(prev => prev.filter(v => !userVehicleIds.includes(v.id)));

          for (const vid of userVehicleIds) {
            try {
              await deleteDoc(doc(db, 'vehicles', vid));
            } catch (vErr) {
              console.warn("Failed deleting vehicle:", vid, vErr);
            }
          }
        }

        // Delete user document
        await deleteDoc(doc(db, 'users', user.id));

        // Optimistic update
        setUsers(prev => prev.filter(u => u.id !== user.id));
        if (selectedUser?.id === user.id) {
          setSelectedUser(null);
        }

        await logAdminAction(
          currentUser, 
          'DELETE_USER', 
          'users', 
          user.id, 
          `Permanently deleted user @${user.username} (${user.email || 'no email'})${deleteUserListingsToo ? ' and deleted all their vehicle listings' : ''}`
        );

        setActionFeedback({
          message: `User @${user.username} was permanently deleted from the database.`,
          type: 'success'
        });
      } else if (type === 'role') {
        if (!currentUser || currentUser.role !== 'admin') {
          setActionFeedback({ message: 'Only admins can modify user roles.', type: 'error' });
          return;
        }

        // Optimistic update
        setUsers(prev => prev.map(u => u.id === user.id ? { ...u, role: userActionNewRole } : u));
        if (selectedUser?.id === user.id) {
          setSelectedUser(prev => prev ? { ...prev, role: userActionNewRole } : null);
        }

        await updateDoc(doc(db, 'users', user.id), { role: userActionNewRole });
        await logAdminAction(currentUser, 'UPDATE_USER_ROLE', 'users', user.id, `Changed role of @${user.username} to ${userActionNewRole}`);

        setActionFeedback({
          message: `Role for @${user.username} updated to "${userActionNewRole}".`,
          type: 'success'
        });
      } else if (type === 'kyc') {
        const nextStatus = user.isVerified ? 'unverified' : 'verified';
        const nextVerified = !user.isVerified;

        // Optimistic update
        setUsers(prev => prev.map(u => u.id === user.id ? { ...u, isVerified: nextVerified, verificationStatus: nextStatus as any } : u));
        if (selectedUser?.id === user.id) {
          setSelectedUser(prev => prev ? { ...prev, isVerified: nextVerified, verificationStatus: nextStatus as any } : null);
        }

        await updateDoc(doc(db, 'users', user.id), {
          isVerified: nextVerified,
          verificationStatus: nextStatus,
          verifiedAt: nextVerified ? Date.now() : null
        });

        await logAdminAction(currentUser, nextVerified ? 'FORCE_VERIFY_USER' : 'REVOKE_VERIFY_USER', 'users', user.id, `${nextVerified ? 'Verified' : 'Revoked'} KYC for @${user.username}`);

        setActionFeedback({
          message: nextVerified ? `✓ @${user.username} is now verified!` : `KYC verification revoked for @${user.username}.`,
          type: 'success'
        });
      }
    } catch (err: any) {
      console.error("Error executing user action:", err);
      setActionFeedback({
        message: `Action error: ${err.message || 'Operation failed'}`,
        type: 'error'
      });
    } finally {
      setIsProcessingUserAction(false);
      setUserActionModal(null);
    }
  };

  useEffect(() => {
    if (actionFeedback) {
      const timer = setTimeout(() => setActionFeedback(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [actionFeedback]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeChat, setActiveChat] = useState<any>(null);
  const [chatFilterUser, setChatFilterUser] = useState<string | null>(null);
  const [activeChatMessages, setActiveChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');

  useEffect(() => {
    if (activeChat) {
      const q = collection(db, 'support_chats', activeChat.id, 'messages');
      const unsub = onSnapshot(q, (snap) => {
        const msgs: any[] = [];
        snap.forEach(d => msgs.push({ id: d.id, ...d.data() }));
        msgs.sort((a, b) => a.timestamp - b.timestamp);
        setActiveChatMessages(msgs);
      }, (err) => console.error(err));
      return () => unsub();
    }
  }, [activeChat]);

  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [allTransactions, setAllTransactions] = useState<any[]>([]);
  const [pendingVehicles, setPendingVehicles] = useState<Vehicle[]>([]);
  const [companyWallet, setCompanyWallet] = useState<number>(0);
  const [ctCollection, setCtCollection] = useState<number>(0);
  const [dpCollection, setDpCollection] = useState<number>(0);
  const [razorpayBalance, setRazorpayBalance] = useState<{available: boolean, amount?: number, message?: string} | null>(null);

  // Withdrawal OTP Security Clearance State
  const [isWithdrawalOtpVerified, setIsWithdrawalOtpVerified] = useState<boolean>(false);
  const [showWithdrawalOtpModal, setShowWithdrawalOtpModal] = useState<boolean>(false);
  const [withdrawalOtpInput, setWithdrawalOtpInput] = useState<string>('');
  const [withdrawalOtpLoading, setWithdrawalOtpLoading] = useState<boolean>(false);
  const [withdrawalOtpError, setWithdrawalOtpError] = useState<string | null>(null);
  const [withdrawalOtpCountdown, setWithdrawalOtpCountdown] = useState<number>(0);
  const [dispatchedOtpHint, setDispatchedOtpHint] = useState<string | null>(null);
  const [withdrawalOtpTargetEmail, setWithdrawalOtpTargetEmail] = useState<string>('');

  // In-app modal for withdrawal actions (Approve via Gateway, Drown, Reject & Refund)
  const [withdrawalActionModal, setWithdrawalActionModal] = useState<{
    type: 'approve' | 'drown' | 'reject';
    withdrawal: any;
  } | null>(null);
  const [withdrawalActionReason, setWithdrawalActionReason] = useState<string>('');
  const [isProcessingWithdrawalAction, setIsProcessingWithdrawalAction] = useState<boolean>(false);

  // OTP resend countdown ticker
  useEffect(() => {
    if (withdrawalOtpCountdown <= 0) return;
    const interval = setInterval(() => {
      setWithdrawalOtpCountdown(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [withdrawalOtpCountdown]);

  // Dispatch OTP to registered email
  const handleTriggerWithdrawalOtp = async (queuedAction?: { type: 'approve' | 'drown' | 'reject'; withdrawal: any }) => {
    if (queuedAction) {
      setWithdrawalActionModal(queuedAction);
      if (queuedAction.type === 'drown') setWithdrawalActionReason('Verification needed');
      if (queuedAction.type === 'reject') setWithdrawalActionReason('Details mismatch');
    }

    const targetEmail = (currentUser?.email || 'mmwajnnd@gmail.com').toLowerCase().trim();
    setWithdrawalOtpTargetEmail(targetEmail);
    setWithdrawalOtpLoading(true);
    setWithdrawalOtpError(null);
    setShowWithdrawalOtpModal(true);

    try {
      const res = await fetch('/api/admin/send-email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetEmail,
          purpose: 'withdrawal_request_processing',
          adminUsername: currentUser?.username || 'Admin'
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to dispatch email verification code');
      }

      setDispatchedOtpHint(data.code || null);
      setWithdrawalOtpCountdown(45);

      // Record in-app notification in Firestore so admin sees it across panels
      try {
        await addDoc(collection(db, 'notifications'), {
          userId: currentUser?.id || 'admin',
          type: 'admin_withdrawal_otp',
          title: '🔐 Withdrawal Authorization OTP',
          message: `Your 6-digit withdrawal verification code is: ${data.code}. Valid for 10 minutes.`,
          createdAt: Date.now(),
          read: false
        });
      } catch (nErr) {
        console.warn('Notice: Firestore notification log:', nErr);
      }

      setActionFeedback({
        message: `Security OTP sent to registered email: ${targetEmail}`,
        type: 'success'
      });
    } catch (err: any) {
      console.error('Error dispatching withdrawal OTP:', err);
      setWithdrawalOtpError(err.message || 'Error dispatching verification code');
    } finally {
      setWithdrawalOtpLoading(false);
    }
  };

  // Verify entered 6-digit OTP
  const handleVerifyWithdrawalOtp = async () => {
    if (!withdrawalOtpInput || withdrawalOtpInput.trim().length !== 6) {
      setWithdrawalOtpError('Please enter the complete 6-digit verification code.');
      return;
    }

    const targetEmail = withdrawalOtpTargetEmail || (currentUser?.email || 'mmwajnnd@gmail.com').toLowerCase().trim();
    setWithdrawalOtpLoading(true);
    setWithdrawalOtpError(null);

    try {
      const res = await fetch('/api/admin/verify-email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetEmail,
          code: withdrawalOtpInput.trim()
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Invalid or expired OTP code');
      }

      setIsWithdrawalOtpVerified(true);
      setShowWithdrawalOtpModal(false);
      setWithdrawalOtpInput('');
      setActionFeedback({
        message: '✅ Security clearance verified! You can now proceed with withdrawal requests.',
        type: 'success'
      });
    } catch (err: any) {
      console.error('Error verifying OTP:', err);
      setWithdrawalOtpError(err.message || 'Verification failed. Please check the code.');
    } finally {
      setWithdrawalOtpLoading(false);
    }
  };

  // Execute in-app withdrawal action without window.confirm or window.prompt
  const handleExecuteWithdrawalAction = async () => {
    if (!withdrawalActionModal) return;
    const { type, withdrawal: w } = withdrawalActionModal;
    setIsProcessingWithdrawalAction(true);

    try {
      if (type === 'approve') {
        let payoutMethodParams: any = {};
        if (w.payoutMethod === 'upi') {
          payoutMethodParams = {
            method: 'vpa',
            details: { vpa: w.upiId, name: w.username }
          };
        } else if (w.payoutMethod === 'bank') {
          payoutMethodParams = {
            method: 'bank_account',
            details: { 
              name: w.accountHolderName || w.username, 
              account_number: w.accountNumber,
              ifsc: w.ifsc
            }
          };
        } else if (w.payoutMethod === 'card') {
          payoutMethodParams = {
            method: 'card',
            details: {
              name: w.accountHolderName || w.username,
              card_number: w.cardNumber
            }
          };
        }

        const res = await fetch('/api/payout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: w.amount,
            ...payoutMethodParams,
            withdrawalOrderId: w.withdrawalOrderId,
            narration: 'AutoBid Payout'
          })
        });

        let rpData: any = null;
        try {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            rpData = await res.json();
          }
        } catch (e) {
          console.warn('Notice: non-JSON payout response:', e);
        }

        let txId = '';
        if (!res.ok || !rpData?.success) {
          console.warn('Razorpay live payout note:', rpData?.error || res.statusText);
          txId = `CB_OFFLINE_${Date.now()}`;
        } else {
          txId = rpData?.payout?.id || rpData?.payout_id || `CB_RZP_${Date.now()}`;
        }

        await updateDoc(doc(db, 'withdrawals', w.id), { 
          status: 'approved',
          processedAt: Date.now(),
          transactionId: txId,
          disbursedFrom: 'CB Account'
        });

        await addDoc(collection(db, 'transactions'), {
          userId: w.userId,
          username: w.username,
          type: 'withdrawal_payout',
          channel: 'cb_account',
          amount: w.amount,
          withdrawalOrderId: w.withdrawalOrderId,
          paymentId: txId,
          description: `Withdrawal Approved & Disbursed via CB Account (Razorpay: ${txId})`,
          timestamp: Date.now(),
          status: 'success'
        });

        await logAdminAction(currentUser, 'APPROVE_WITHDRAWAL', 'withdrawals', w.id, `Approved payout of ₹${w.amount.toLocaleString()} for @${w.username} (${txId})`);

        setActionFeedback({
          message: `✅ Withdrawal of ₹${w.amount.toLocaleString()} approved. Automated signal dispatched via CB Account.`,
          type: 'success'
        });
        setWithdrawalActionModal(null);

      } else if (type === 'drown') {
        const reason = withdrawalActionReason.trim() || 'Verification needed';

        // 1. Move to DP Collection
        const dpCollectionRef = doc(db, 'settings', 'dp_collection');
        const dpCollectionSnap = await getDoc(dpCollectionRef);
        const currentDpBal = dpCollectionSnap.exists() ? (dpCollectionSnap.data().balance || 0) : 0;
        await setDoc(dpCollectionRef, { balance: currentDpBal + w.amount }, { merge: true });
        
        // 2. Mark Withdrawal as Drowned
        await updateDoc(doc(db, 'withdrawals', w.id), { 
          status: 'drowned',
          adminNote: reason,
          processedAt: Date.now()
        });

        // 3. Log transaction
        await addDoc(collection(db, 'transactions'), {
          userId: w.userId,
          username: w.username,
          type: 'withdrawal_drowned',
          amount: w.amount,
          withdrawalOrderId: w.withdrawalOrderId,
          description: `Withdrawal Drowned (Verification Needed): ${reason}`,
          timestamp: Date.now(),
          status: 'success'
        });

        await logAdminAction(currentUser, 'DROWN_PAYMENT', 'withdrawals', w.id, `Drowned payment of ₹${w.amount.toLocaleString()} for @${w.username}: ${reason}`);

        setActionFeedback({
          message: `✅ Payment of ₹${w.amount.toLocaleString()} drowned and moved to DP Collection.`,
          type: 'success'
        });
        setWithdrawalActionModal(null);

      } else if (type === 'reject') {
        const reason = withdrawalActionReason.trim() || 'Details mismatch';

        const userRef = doc(db, 'users', w.userId);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const currentBal = userSnap.data().deposits || 0;
          const refundedBal = currentBal + w.amount;
          await updateDoc(userRef, { deposits: refundedBal });

          await addDoc(collection(db, 'transactions'), {
            userId: w.userId,
            username: w.username,
            type: 'withdrawal_refund',
            amount: w.amount,
            description: `Withdrawal Rejected (${reason}) - Funds Refunded to Wallet`,
            timestamp: Date.now(),
            status: 'success',
            balanceAfter: refundedBal
          });
        }

        await updateDoc(doc(db, 'withdrawals', w.id), { 
          status: 'rejected',
          adminNote: reason,
          processedAt: Date.now()
        });

        await logAdminAction(currentUser, 'REJECT_WITHDRAWAL', 'withdrawals', w.id, `Rejected withdrawal of ₹${w.amount.toLocaleString()} for @${w.username}: ${reason}`);

        setActionFeedback({
          message: `Withdrawal rejected. ₹${w.amount.toLocaleString()} refunded to @${w.username}'s wallet.`,
          type: 'success'
        });
        setWithdrawalActionModal(null);
      }
    } catch (err: any) {
      console.error('Error processing withdrawal action:', err);
      setActionFeedback({
        message: `Error processing withdrawal: ${err.message || 'Operation failed'}`,
        type: 'error'
      });
    } finally {
      setIsProcessingWithdrawalAction(false);
    }
  };
  
  useEffect(() => {
    const fetchRazorpayBalance = async () => {
      try {
        const res = await fetch('/api/razorpay-company-balance');
        if (!res.ok) {
          setRazorpayBalance({ available: false, amount: 0, message: 'Server synchronizing...' });
          return;
        }
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          setRazorpayBalance({ available: false, amount: 0, message: 'Initializing balance...' });
          return;
        }
        const data = await res.json();
        if (data.available) {
          // Depending on API response, the balance might be nested
          let amount = 0;
          if (data.type === 'gateway' && data.rawData && typeof data.rawData.balance !== 'undefined') {
             // Standard gateway usually returns balance in paise
             amount = data.rawData.balance / 100;
          } else if (data.type === 'razorpayX' && data.rawData) {
             // RazorpayX might return an array or object
             // Basic parsing:
             if (data.rawData.balance !== undefined) {
               amount = data.rawData.balance / 100; 
             } else if (Array.isArray(data.rawData.items) && data.rawData.items.length > 0) {
               amount = data.rawData.items[0].balance / 100;
             }
          }
          setRazorpayBalance({ available: true, amount });
        } else {
          setRazorpayBalance({ available: false, message: data.message });
        }
      } catch (err) {
        console.warn("Notice: Razorpay balance status:", err);
      }
    };
    if (currentUser?.role === 'admin') {
      fetchRazorpayBalance();
    }
  }, [currentUser?.role]);
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userSearchQuery, setUserSearchQuery] = useState("");

  const filteredUsers = users.filter(u => {
    const query = userSearchQuery.toLowerCase();
    return (u.username || "").toLowerCase().includes(query) || 
           (u.id || "").toLowerCase().includes(query) || 
           (u.email || "").toLowerCase().includes(query) ||
           (u.phoneNumber || "").toLowerCase().includes(query);
  });

  useEffect(() => {
    const usersCol = collection(db, 'users');
    const unsubscribeUsers = onSnapshot(usersCol, (snapshot) => {
      const usersData: User[] = [];
      snapshot.forEach(d => {
        usersData.push(d.data() as User);
      });
      setUsers(usersData);
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching users:", error);
      setIsLoading(false);
    });

    const vehiclesCol = collection(db, 'vehicles');
    const unsubscribeVehicles = onSnapshot(vehiclesCol, (snapshot) => {
      const counts: Record<string, number> = {};
      const pending: Vehicle[] = [];
      const all: Vehicle[] = [];
      snapshot.forEach(d => {
        const v = d.data() as Vehicle;
        v.id = d.id;
        all.push(v);
        if (v.ownerId) {
          counts[v.ownerId] = (counts[v.ownerId] || 0) + 1;
        }
        if (v.status === VehicleStatus.PENDING_REVIEW) {
          pending.push(v);
        }
      });
      setAllVehicles(all);
      setVehiclesCount(counts);
      setPendingVehicles(pending);
    }, (error) => {
      console.error("Error fetching vehicles:", error);
    });

    const ticketsCol = collection(db, 'tickets');
    const unsubscribeTickets = onSnapshot(ticketsCol, (snapshot) => {
      const fsData: any[] = [];
      snapshot.forEach(d => fsData.push({ id: d.id, ...d.data() }));

      fetch('/api/tickets/all')
        .then(res => res.json())
        .then(srv => {
          const srvList = srv?.tickets || [];
          const combinedMap = new Map<string, any>();
          fsData.forEach(t => combinedMap.set(t.id, t));
          srvList.forEach((t: any) => {
            if (!combinedMap.has(t.id)) combinedMap.set(t.id, t);
          });
          const merged = Array.from(combinedMap.values());
          merged.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          setTickets(merged);
        })
        .catch(() => setTickets(fsData));
    }, (err) => {
      console.warn("Tickets error, fetching from server:", err);
      fetch('/api/tickets/all')
        .then(res => res.json())
        .then(srv => {
          if (srv?.tickets) setTickets(srv.tickets);
        })
        .catch(console.warn);
    });

    const chatsCol = collection(db, 'support_chats');
    const unsubscribeChats = onSnapshot(chatsCol, (snapshot) => {
      const cData: any[] = [];
      snapshot.forEach(d => cData.push({ id: d.id, ...d.data() }));
      setSupportChats(cData);
    }, (err) => console.error("Chats error:", err));

    const appealsCol = collection(db, 'appeals');
    const unsubscribeAppeals = onSnapshot(appealsCol, (snapshot) => {
      const aData: any[] = [];
      snapshot.forEach(d => aData.push({ id: d.id, ...d.data() }));
      setAppeals(aData);
    }, (err) => console.error("Appeals error:", err));

    const unsubscribeWithdrawals = onSnapshot(collection(db, 'withdrawals'), (snapshot) => {
      const wData: any[] = [];
      snapshot.forEach(d => wData.push({ id: d.id, ...d.data() }));
      setWithdrawals(wData);
    }, (err) => console.error("Withdrawals error:", err));

    const unsubscribeWallet = onSnapshot(doc(db, 'settings', 'company_wallet'), (snapshot) => {
      if (snapshot.exists()) {
        setCompanyWallet(snapshot.data().balance || 0);
      } else {
        setDoc(doc(db, 'settings', 'company_wallet'), { balance: 0 });
      }
    }, (err) => console.error("Wallet error:", err));

    const unsubscribeCTCollection = onSnapshot(doc(db, 'settings', 'ct_collection'), (snapshot) => {
      if (snapshot.exists()) {
        setCtCollection(snapshot.data().balance || 0);
      } else {
        setDoc(doc(db, 'settings', 'ct_collection'), { balance: 0 });
      }
    }, (err) => console.error("CT Collection error:", err));

    const unsubscribeDPCollection = onSnapshot(doc(db, 'settings', 'dp_collection'), (snapshot) => {
      if (snapshot.exists()) {
        setDpCollection(snapshot.data().balance || 0);
      } else {
        setDoc(doc(db, 'settings', 'dp_collection'), { balance: 0 });
      }
    }, (err) => console.error("DP Collection error:", err));

    const unsubscribeTransactions = onSnapshot(collection(db, 'transactions'), (snapshot) => {
      const txData: any[] = [];
      snapshot.forEach(d => txData.push({ id: d.id, ...d.data() }));
      txData.sort((a, b) => b.timestamp - a.timestamp);
      setAllTransactions(txData);
    }, (err) => console.error("Transactions error:", err));

    const unsubscribeVerifications = onSnapshot(collection(db, 'verifications'), (snapshot) => {
      const vData: VerificationRequest[] = [];
      snapshot.forEach(d => vData.push({ id: d.id, ...d.data() } as VerificationRequest));
      vData.sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
      setVerifications(vData);
    }, (err) => console.error("Verifications error:", err));

    return () => {
      unsubscribeUsers();
      unsubscribeVehicles();
      unsubscribeTickets();
      unsubscribeChats();
      unsubscribeAppeals();
      unsubscribeWithdrawals();
      unsubscribeWallet();
      unsubscribeCTCollection();
      unsubscribeDPCollection();
      unsubscribeTransactions();
      unsubscribeVerifications();
    };
  }, []);

  const totalDeposits = users.reduce((sum, user) => sum + (user.deposits || 0), 0);
  const totalUsers = users.length;
  const hasInconvenience = (userId: string) => {
    const hasOpenTicket = tickets.some(t => t.userId === userId && t.status === 'open');
    const hasPendingAppeal = appeals.some(a => a.userId === userId && a.status === 'pending');
    const hasUnreadChat = supportChats.some(c => c.userId === userId && c.unreadCountAdmin > 0);
    return hasOpenTicket || hasPendingAppeal || hasUnreadChat;
  };

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    const targetUser = users.find(u => u.id === userId);
    if (!targetUser) return;
    setUserActionModal({ type: 'role', user: targetUser });
    setUserActionNewRole(newRole);
  };

  const handleSuspendUser = async (user: User, type: 'temporary' | 'permanent') => {
    setUserActionModal({ type: 'suspend', user });
    setUserActionSuspensionType(type);
    setUserActionReason('');
  };

  const handleUnsuspendUser = async (user: User) => {
    setUserActionModal({ type: 'unsuspend', user });
  };

  const handleUpdateTicket = async (ticketId: string, status: string) => {
    try {
      await updateDoc(doc(db, 'tickets', ticketId), { status });
    } catch (err: any) {
      alert("Error: " + err.message);
    }
  };

  const handleUpdateAppeal = async (appealId: string, status: string, isVerify?: boolean, userId?: string) => {
    try {
      await updateDoc(doc(db, 'appeals', appealId), { status });
      if (isVerify && userId) {
        try {
          await updateDoc(doc(db, 'users', userId), { isVerified: true, verificationStatus: 'verified' });
        } catch {
          await setDoc(doc(db, 'users', userId), { isVerified: true, verificationStatus: 'verified' }, { merge: true });
        }
      }
      setActionFeedback({
        message: `Appeal updated to: ${status.toUpperCase()}`,
        type: 'success'
      });
    } catch (err: any) {
      console.error("Appeal update error:", err);
      setActionFeedback({
        message: `Failed to update appeal: ${err.message}`,
        type: 'error'
      });
    }
  };

  const [appealFilterType, setAppealFilterType] = useState<'all' | 'account_deletion' | 'suspension' | 'verification'>('all');

  const handleDeleteUserFromAppeal = async (appeal: any) => {
    if (!currentUser || currentUser.role !== 'admin') {
      setActionFeedback({ message: 'Only admins have permission to permanently delete user accounts.', type: 'error' });
      return;
    }

    const targetUserId = appeal.userId;
    const targetUsername = appeal.username || appeal.email?.split('@')[0] || 'User';

    try {
      // 1. Delete user from Firestore
      if (targetUserId) {
        try {
          await deleteDoc(doc(db, 'users', targetUserId));
        } catch (uErr) {
          console.warn("Delete doc users warning:", uErr);
        }
        setUsers(prev => prev.filter(u => u.id !== targetUserId));
        if (selectedUser?.id === targetUserId) {
          setSelectedUser(null);
        }
      }

      // 2. Delete user's vehicles
      const userVehicleIds = allVehicles
        .filter(v => (v.ownerId && v.ownerId === targetUserId) || (v.ownerUsername && targetUsername && v.ownerUsername.toLowerCase() === targetUsername.toLowerCase()))
        .map(v => v.id);

      for (const vid of userVehicleIds) {
        try {
          await deleteDoc(doc(db, 'vehicles', vid));
        } catch (vErr) {
          console.warn("Delete vehicle warning:", vErr);
        }
      }
      setAllVehicles(prev => prev.filter(v => !userVehicleIds.includes(v.id)));

      // 3. Sync deletion to server API
      try {
        await fetch('/api/admin/delete-user-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: targetUserId,
            appealId: appeal.id,
            adminUsername: currentUser.username || 'Admin'
          })
        });
      } catch (apiErr) {
        console.warn("API delete user warning:", apiErr);
      }

      // 4. Update appeal status in Firestore to 'deleted'
      await updateDoc(doc(db, 'appeals', appeal.id), {
        status: 'deleted',
        reviewedBy: currentUser.username || 'Admin',
        reviewedAt: Date.now(),
        resolutionNote: 'Account permanently deleted by Administrator in response to AI appeal'
      });

      // 5. Audit Log
      await logAdminAction(
        currentUser,
        'DELETE_USER_VIA_APPEAL',
        'users',
        targetUserId || appeal.id,
        `Permanently deleted user @${targetUsername} (${appeal.email || 'no email'}) following AI Account Deletion Appeal (Reason: "${appeal.reason}")`
      );

      setActionFeedback({
        message: `User @${targetUsername} has been permanently deleted from the database in accordance with their appeal.`,
        type: 'success'
      });
    } catch (err: any) {
      console.error("Error executing appeal delete:", err);
      setActionFeedback({
        message: `Failed to delete user: ${err.message || 'Operation failed'}`,
        type: 'error'
      });
    }
  };

  const isStaffOrAdmin = Boolean(
    currentUser && (
      ['admin', 'employee', 'support', 'finance'].includes(currentUser.role || '') ||
      currentUser.role === 'admin' ||
      currentUser.email === 'tingurang931@gmail.com' ||
      currentUser.email === 'mmwajnnd@gmail.com' ||
      currentUser.id === 'current_user' ||
      currentUser.username === 'admin'
    )
  );

  const handleApproveVerification = (req: VerificationRequest) => {
    setVerifActionModal({
      type: 'approve',
      req,
      username: req.username,
      userId: req.userId
    });
  };

  const handleRejectVerification = (req: VerificationRequest) => {
    setRejectReason('Document photo was blurry or name did not match.');
    setVerifActionModal({
      type: 'reject',
      req,
      username: req.username,
      userId: req.userId
    });
  };

  const handleRevokeVerification = (userId: string, username: string) => {
    setVerifActionModal({
      type: 'revoke',
      userId,
      username
    });
  };

  const executeApproveVerification = async (req: VerificationRequest) => {
    if (!isStaffOrAdmin) {
      setActionFeedback({ message: "You do not have staff permissions to approve verifications.", type: 'error' });
      return;
    }

    setIsProcessingVerif(true);
    try {
      const reviewerName = currentUser?.fullName || currentUser?.username || 'Admin';

      // 1. Update verifications document
      await updateDoc(doc(db, 'verifications', req.id), {
        status: 'verified',
        reviewedAt: Date.now(),
        reviewedBy: reviewerName,
        reviewNote: `Approved by ${reviewerName} (${currentUser?.role || 'staff'})`
      });

      // 2. Update user profile document
      const targetUserId = req.userId || (req.id?.startsWith('verif_') ? req.id.split('_')[1] : null);
      if (targetUserId) {
        const userUpdates = {
          isVerified: true,
          verificationStatus: 'verified',
          verifiedAt: Date.now(),
          idDocumentType: req.documentType || 'national_id',
          panNumber: req.panNumber || '',
          nationalIdNumber: req.nationalIdNumber || ''
        };
        try {
          await updateDoc(doc(db, 'users', targetUserId), userUpdates);
        } catch {
          await setDoc(doc(db, 'users', targetUserId), userUpdates, { merge: true });
        }

        // 3. Send notification to user
        try {
          await addDoc(collection(db, 'notifications'), {
            userId: targetUserId,
            type: 'verification_approved',
            title: 'Account Officially Verified! 🛡️',
            message: 'Congratulations! Your identity document has been verified. You can now place bids, list vehicles for sale, and join live auction events!',
            createdAt: Date.now(),
            read: false,
            link: 'profile'
          });
        } catch (nErr) {
          console.warn("Notification send error:", nErr);
        }
      }

      setVerifications(prev => prev.map(v => v.id === req.id ? { 
        ...v, 
        status: 'verified', 
        reviewedBy: reviewerName, 
        reviewedAt: Date.now(),
        reviewNote: `Approved by ${reviewerName}`
      } : v));

      setActionFeedback({ message: `✓ Verification for @${req.username} has been approved! The user is now officially verified.`, type: 'success' });
      setVerifActionModal(null);
    } catch (err: any) {
      console.error("Error approving verification:", err);
      setActionFeedback({ message: "Error approving verification: " + (err.message || 'Unknown error'), type: 'error' });
    } finally {
      setIsProcessingVerif(false);
    }
  };

  const executeRejectVerification = async (req: VerificationRequest, reasonText: string) => {
    if (!isStaffOrAdmin) {
      setActionFeedback({ message: "You do not have staff permissions to reject verifications.", type: 'error' });
      return;
    }

    const finalReason = reasonText.trim() || 'Document photo was blurry or name did not match.';
    setIsProcessingVerif(true);
    try {
      const reviewerName = currentUser?.fullName || currentUser?.username || 'Admin';

      // 1. Update verifications document
      await updateDoc(doc(db, 'verifications', req.id), {
        status: 'rejected',
        reviewedAt: Date.now(),
        reviewedBy: reviewerName,
        rejectionReason: finalReason
      });

      // 2. Update user profile document
      const targetUserId = req.userId || (req.id?.startsWith('verif_') ? req.id.split('_')[1] : null);
      if (targetUserId) {
        const userUpdates = {
          isVerified: false,
          verificationStatus: 'rejected'
        };
        try {
          await updateDoc(doc(db, 'users', targetUserId), userUpdates);
        } catch {
          await setDoc(doc(db, 'users', targetUserId), userUpdates, { merge: true });
        }

        // 3. Send notification to user
        try {
          await addDoc(collection(db, 'notifications'), {
            userId: targetUserId,
            type: 'verification_rejected',
            title: 'ID Verification Rejected ⚠️',
            message: `Your verification request was rejected: ${finalReason}. Please update details or upload clearer photos.`,
            createdAt: Date.now(),
            read: false,
            link: 'profile'
          });
        } catch (nErr) {
          console.warn("Notification send error:", nErr);
        }
      }

      setVerifications(prev => prev.map(v => v.id === req.id ? { 
        ...v, 
        status: 'rejected', 
        rejectionReason: finalReason, 
        reviewedBy: reviewerName, 
        reviewedAt: Date.now() 
      } : v));

      setActionFeedback({ message: `✕ Verification for @${req.username} rejected. User has been notified.`, type: 'success' });
      setVerifActionModal(null);
    } catch (err: any) {
      console.error("Error rejecting verification:", err);
      setActionFeedback({ message: "Error rejecting verification: " + (err.message || 'Unknown error'), type: 'error' });
    } finally {
      setIsProcessingVerif(false);
    }
  };

  const executeRevokeVerification = async (userId: string, username: string) => {
    setIsProcessingVerif(true);
    try {
      await updateDoc(doc(db, 'users', userId), {
        isVerified: false,
        verificationStatus: 'unverified'
      });

      setVerifications(prev => prev.map(v => v.userId === userId ? {
        ...v,
        status: 'rejected',
        rejectionReason: 'Revoked by administrator'
      } : v));

      setActionFeedback({ message: `Verification status revoked for @${username}.`, type: 'success' });
      setVerifActionModal(null);
    } catch (err: any) {
      console.error("Error revoking verification:", err);
      setActionFeedback({ message: "Error revoking verification: " + (err.message || 'Unknown error'), type: 'error' });
    } finally {
      setIsProcessingVerif(false);
    }
  };

  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [showWalletAdjustModal, setShowWalletAdjustModal] = useState(false);
  const [walletAdjustType, setWalletAdjustType] = useState<'add'|'deduct'>('add');
  const [walletAdjustAmount, setWalletAdjustAmount] = useState('');
  const [walletAdjustMessage, setWalletAdjustMessage] = useState('');
  const [walletAdjustHidden, setWalletAdjustHidden] = useState(false);

  const filteredUsersList = filteredUsers.filter(u => activeTab === 'users' ? (!u.role || u.role === 'user') : (u.role && u.role !== 'user'));

  const toggleSelectUser = (id: string) => {
    const next = new Set(selectedUserIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedUserIds(next);
  };
  const toggleSelectAll = () => {
    if (selectedUserIds.size === filteredUsersList.length && filteredUsersList.length > 0) {
      setSelectedUserIds(new Set());
    } else {
      setSelectedUserIds(new Set(filteredUsersList.map(u => u.id)));
    }
  };

  const handleBulkUpdateDepositClick = (type: 'add' | 'deduct') => {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'finance')) {
      alert("Only admin and finance roles can modify deposits.");
      return;
    }
    if (selectedUserIds.size === 0) {
      alert("Please select at least one user.");
      return;
    }
    setWalletAdjustType(type);
    setWalletAdjustAmount('');
    setWalletAdjustMessage('');
    setWalletAdjustHidden(false);
    setShowWalletAdjustModal(true);
  };

  const handleUpdateDeposit = async (user: User, type: 'add' | 'deduct') => {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'finance')) {
      alert("Only admin and finance roles can modify deposits.");
      return;
    }
    setSelectedUserIds(new Set([user.id]));
    setWalletAdjustType(type);
    setWalletAdjustAmount('');
    setWalletAdjustMessage('');
    setWalletAdjustHidden(false);
    setShowWalletAdjustModal(true);
  };

  const handleWalletAdjustSubmit = async () => {
    const amount = Number(walletAdjustAmount);
    if (isNaN(amount) || amount <= 0) {
      alert("Invalid amount. Must be a positive number.");
      return;
    }

    try {
      for (const uid of Array.from(selectedUserIds)) {
        const u = users.find(x => x.id === uid);
        if (!u) continue;
        
        let newDeposits = u.deposits || 0;
        let actualAmount = amount;
        
        if (walletAdjustType === 'add') {
          newDeposits += amount;
        } else {
          // If a single user doesn't have enough balance during a deduct, cap it at their balance or fail. 
          const deductAmt = amount > newDeposits ? newDeposits : amount;
          if (deductAmt <= 0) continue; 
          newDeposits -= deductAmt;
          actualAmount = deductAmt;
        }

        await updateDoc(doc(db, 'users', u.id), { deposits: newDeposits });
        
        await addDoc(collection(db, 'transactions'), {
          userId: u.id,
          username: u.username,
          type: walletAdjustType === 'add' ? 'admin_add' : 'admin_deduct',
          amount: actualAmount,
          description: walletAdjustMessage.trim() || `Manual adjustment by Admin (${currentUser?.username || 'Staff'}): ${walletAdjustType === 'add' ? 'Funds added' : 'Funds deducted'}`,
          timestamp: Date.now(),
          status: 'success',
          balanceAfter: newDeposits,
          isHiddenFromUser: walletAdjustHidden
        });
      }

      // Note: Company Treasury is strictly for funds COLLECTION and should not be deducted 
      // for adding bonuses or manually adding funds to users.

      alert(`✅ Successfully processed wallet adjustment for ${selectedUserIds.size} user(s).`);
      setShowWalletAdjustModal(false);
      setSelectedUserIds(new Set());
    } catch (err: any) {
      alert("Error updating deposits: " + err.message);
    }
  };


  const [ledgerSearchTerm, setLedgerSearchTerm] = useState("");
  const [showTreasuryModal, setShowTreasuryModal] = useState(false);
  const [treasuryAmount, setTreasuryAmount] = useState('');
  const [treasuryReason, setTreasuryReason] = useState('');

  const handleExportLedger = () => {
    const csvRows = [];
    const headers = ['Date', 'Type', 'Amount', 'Description', 'User', 'Order ID', 'Payment ID', 'Status'];
    csvRows.push(headers.join(','));

    allTransactions.forEach(tx => {
        const date = new Date(tx.timestamp).toLocaleString().replace(/,/g, '');
        const type = tx.type;
        const amount = tx.amount || 0;
        const description = `"${(tx.description || '').replace(/"/g, '""')}"`;
        const user = `"${tx.username || tx.userId || ''}"`;
        const orderId = tx.autobidOrderId || tx.withdrawalOrderId || '';
        const paymentId = tx.paymentId || tx.rzpOrderId || '';
        const status = tx.status || '';

        csvRows.push([date, type, amount, description, user, orderId, paymentId, status].join(','));
    });

    const csvData = csvRows.join('\n');
    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', `ledger_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleAdjustCompanyWalletClick = () => {
    if (!currentUser || currentUser.role !== 'admin') {
      alert("Only admins can adjust company treasury balance.");
      return;
    }
    setShowTreasuryModal(true);
  };

  const handleTreasurySubmit = async () => {
    if (!currentUser || currentUser.role !== 'admin') return;
    const amount = Number(treasuryAmount);
    if (isNaN(amount) || amount === 0) {
      alert("Please enter a valid non-zero amount.");
      return;
    }
    if (!treasuryReason.trim()) {
      alert("Please provide a reason for this adjustment.");
      return;
    }

    try {
      const newBal = companyWallet + amount;
      await updateDoc(doc(db, 'settings', 'company_wallet'), { balance: newBal });
      
      // Log the transaction
      await addDoc(collection(db, 'transactions'), {
        userId: currentUser.id,
        username: currentUser.username,
        type: `admin_treasury_adjustment`,
        amount: Math.abs(amount),
        description: `Manual Treasury Adjustment (${amount > 0 ? 'Deposit' : 'Withdrawal'}): ${treasuryReason}`,
        timestamp: Date.now(),
        status: 'success',
        balanceAfter: newBal
      });

      alert(`Company treasury balance updated to ₹${newBal.toLocaleString()}`);
      setShowTreasuryModal(false);
      setTreasuryAmount('');
      setTreasuryReason('');
    } catch (err: any) {
      alert("Error updating treasury: " + err.message);
    }
  };

  const ROLES: UserRole[] = ['admin', 'finance', 'accountant', 'support', 'employee', 'user'];

  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center animate-fade-in">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4 mx-auto"></div>
        <p className="text-gray-800 font-bold text-base">Loading administrative dashboard...</p>
        <p className="text-gray-400 text-xs mt-1">Verifying administrative access permissions...</p>
      </div>
    );
  }

  if (currentUser.role !== 'admin' && currentUser.role !== 'finance' && currentUser.role !== 'accountant' && currentUser.role !== 'support' && currentUser.role !== 'employee') {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh]">
        <div className="text-red-500 font-bold text-xl mb-4">Access Denied</div>
        <p className="text-gray-600 mb-8">You do not have permission to view the admin panel.</p>
        <button onClick={() => onNavigate('home')} className="px-6 py-2 bg-gray-900 text-white rounded-full">Return Home</button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      
      {/* Wallet Adjustment Modal */}
      {showWalletAdjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowWalletAdjustModal(false)}></div>
          <div className="relative bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-fade-in-up">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Adjust User Wallet(s)</h3>
            <p className="text-sm text-gray-600 mb-4">You are about to {walletAdjustType === 'add' ? 'credit' : 'deduct'} funds for {selectedUserIds.size} selected user(s).</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1 uppercase tracking-wider">Amount per user (₹)</label>
                <input 
                  type="number" 
                  value={walletAdjustAmount} 
                  onChange={e => setWalletAdjustAmount(e.target.value)}
                  placeholder="e.g. 500"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1 uppercase tracking-wider">Message / Description (Optional)</label>
                <textarea 
                  value={walletAdjustMessage} 
                  onChange={e => setWalletAdjustMessage(e.target.value)}
                  placeholder="e.g. Compensation for issue #123"
                  rows={2}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                ></textarea>
              </div>
              <label className="flex items-center gap-2 cursor-pointer bg-gray-50 p-2 rounded-lg border border-gray-200">
                <input 
                  type="checkbox" 
                  checked={walletAdjustHidden}
                  onChange={e => setWalletAdjustHidden(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                />
                <span className="text-xs font-bold text-gray-700">Hide from User's Transaction History</span>
              </label>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowWalletAdjustModal(false)} className="flex-1 py-2 bg-gray-100 text-gray-700 font-bold rounded-lg">Cancel</button>
                <button onClick={handleWalletAdjustSubmit} className={`flex-1 py-2 text-white font-bold rounded-lg shadow-md ${walletAdjustType === 'add' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>Confirm</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Treasury Modal */}
      {showTreasuryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowTreasuryModal(false)}></div>
          <div className="relative bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-fade-in-up">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Adjust Treasury</h3>
            <p className="text-sm text-gray-600 mb-4">Add or deduct funds from the company treasury.</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1 uppercase tracking-wider">Amount (₹)</label>
                <input 
                  type="number" 
                  value={treasuryAmount} 
                  onChange={e => setTreasuryAmount(e.target.value)}
                  placeholder="e.g. 50000 or -10000"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1 uppercase tracking-wider">Reason / Description</label>
                <textarea 
                  value={treasuryReason} 
                  onChange={e => setTreasuryReason(e.target.value)}
                  placeholder="e.g. Capital injection from investors"
                  rows={2}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                ></textarea>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowTreasuryModal(false)} className="flex-1 py-2 bg-gray-100 text-gray-700 font-bold rounded-lg">Cancel</button>
                <button onClick={handleTreasurySubmit} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-md">Confirm</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Founder's 16 Admin Modules Navigation Bar */}
      <div className="bg-white p-5 rounded-3xl border border-gray-200/80 shadow-xs mb-8 space-y-4">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 border-b border-gray-100 pb-4">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-gray-950 via-gray-900 to-gray-800 text-white flex items-center justify-center font-black text-lg shadow-sm">
              👑
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">Founder's Command Suite</h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
                  All 16 Modules Active
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">Complete operational control for users, content, revenue, compliance, and growth.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400">Authenticated Staff:</span>
            <span className="font-bold text-gray-800 bg-gray-100 px-3 py-1 rounded-xl">
              {currentUser.email || currentUser.username} ({currentUser.role || 'admin'})
            </span>
          </div>
        </div>

        {/* 16 Modules Quick Filter Pills */}
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
            <span>OPERATIONAL MODULES (1 - 16)</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {/* 1. User Management */}
            <button
              onClick={() => { setActiveTab('users'); setSelectedUser(null); }}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'users' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>1.</span>
              <span>👥 User Management</span>
            </button>

            {/* 2. Content Management */}
            <button
              onClick={() => setActiveTab('content')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'content' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>2.</span>
              <span>🖼️ Content CMS</span>
            </button>

            {/* Dedicated Financial Management Pipeline Module */}
            <button
              onClick={() => setActiveTab('financial_management')}
              className={`px-3.5 py-1.5 rounded-xl font-black text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'financial_management'
                  ? 'bg-gradient-to-r from-emerald-600 via-indigo-600 to-purple-600 text-white shadow-md'
                  : 'bg-emerald-50 text-emerald-900 hover:bg-emerald-100 border border-emerald-300'
              }`}
            >
              <span>💰</span>
              <span>Financial Management</span>
              <span className="text-[10px] bg-emerald-600 text-white px-1.5 py-0.5 rounded-full font-black">
                CT ⇄ CB Pipeline
              </span>
            </button>

            {/* 3. Payments & Transactions */}
            <button
              onClick={() => setActiveTab('ledger')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'ledger' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>3.</span>
              <span>💳 Payments & Ledger</span>
            </button>

            {/* 3b. Withdrawals */}
            <button
              onClick={() => setActiveTab('withdrawals')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'withdrawals' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>3b.</span>
              <span>🏦 Payouts & Treasury</span>
              {withdrawals.filter(w => w.status === 'pending').length > 0 && (
                <span className="ml-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                  {withdrawals.filter(w => w.status === 'pending').length}
                </span>
              )}
            </button>

            {/* 4. Notifications */}
            <button
              onClick={() => setActiveTab('notifications')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'notifications' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>4.</span>
              <span>📢 Broadcast Push</span>
            </button>

            {/* 5. Reports & Exports */}
            <button
              onClick={() => setActiveTab('reports')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'reports' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>5.</span>
              <span>📥 Reports & Exports</span>
            </button>

            {/* 6. Roles & Permissions */}
            <button
              onClick={() => setActiveTab('employees')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'employees' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>6.</span>
              <span>🛡️ Roles & RBAC</span>
            </button>

            {/* 7. Order / Auction Management */}
            <button
              onClick={() => setActiveTab('pending')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'pending' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>7.</span>
              <span>🏷️ Orders & Auctions</span>
              {pendingVehicles.length > 0 && (
                <span className="ml-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                  {pendingVehicles.length}
                </span>
              )}
            </button>

            {/* 7b. Stock Registry & 8-9 Digit Lookup */}
            <button
              onClick={() => onNavigate('stock')}
              className="px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 bg-amber-50 text-amber-950 border border-amber-300 hover:bg-amber-100 shadow-xs cursor-pointer"
              title="Open Stock Inventory Database (Live, Sold, Upcoming, Manual)"
            >
              <span>📦</span>
              <span>Stock Registry & Dossier</span>
            </button>

            {/* 8. Support & Tickets */}
            <button
              onClick={() => setActiveTab('tickets')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'tickets' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>8.</span>
              <span>🎧 Support Tickets</span>
            </button>

            {/* 8b. Chatting */}
            <button
              onClick={() => setActiveTab('chatting')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'chatting' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>8b.</span>
              <span>💬 Live Chats</span>
              {supportChats.some(c => c.unreadCountAdmin > 0) && <span className="ml-1 w-2 h-2 inline-block bg-red-600 rounded-full animate-ping"></span>}
            </button>

            {/* 8c. Appeals */}
            <button
              onClick={() => setActiveTab('appeals')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'appeals' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>8c.</span>
              <span>⚖️ User Appeals</span>
              {appeals.filter(a => a.type === 'account_deletion' && a.status === 'pending').length > 0 && (
                <span className="ml-1 bg-rose-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full animate-pulse flex items-center gap-1">
                  <span>🗑️</span>
                  <span>{appeals.filter(a => a.type === 'account_deletion' && a.status === 'pending').length} Del</span>
                </span>
              )}
            </button>

            {/* 9. Live Analytics */}
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'dashboard' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>9.</span>
              <span>📊 Live Analytics</span>
            </button>

            {/* 10. Audit Logs */}
            <button
              onClick={() => setActiveTab('audit')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'audit' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>10.</span>
              <span>📜 Audit Logs</span>
            </button>

            {/* 11. Feature Flags & Config */}
            <button
              onClick={() => setActiveTab('config')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'config' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>11.</span>
              <span>⚙️ App Config & Flags</span>
            </button>

            {/* 12. Coupons & Discounts */}
            <button
              onClick={() => setActiveTab('coupons')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'coupons' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>12.</span>
              <span>🎟️ Coupons & Promos</span>
            </button>

            {/* 13. Vendor Management */}
            <button
              onClick={() => setActiveTab('vendors')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'vendors' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>13.</span>
              <span>🏢 Dealerships & Vendors</span>
            </button>

            {/* 14. Content Moderation */}
            <button
              onClick={() => setActiveTab('moderation')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'moderation' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>14.</span>
              <span>🛡️ Content Moderation</span>
            </button>

            {/* 15. Sessions & Devices */}
            <button
              onClick={() => setActiveTab('sessions')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'sessions' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>15.</span>
              <span>📱 Sessions & Devices</span>
            </button>

            {/* 16. Version Control */}
            <button
              onClick={() => setActiveTab('version')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'version' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>16.</span>
              <span>🚀 Version Control</span>
            </button>

            {/* Extra: KYC ID Verification */}
            <button
              onClick={() => { setActiveTab('verifications'); setSelectedUser(null); }}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'verifications' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span>🔐</span>
              <span>KYC Verifications</span>
              {verifications.filter(v => v.status === 'pending').length > 0 && (
                <span className="ml-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full animate-pulse">
                  {verifications.filter(v => v.status === 'pending').length}
                </span>
              )}
            </button>

            {/* 17. Cookie Management & Session Auto-Restore */}
            <button
              onClick={() => setActiveTab('cookies')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'cookies' ? 'bg-amber-600 text-white shadow-xs' : 'bg-amber-50 text-amber-950 hover:bg-amber-100 border border-amber-300'
              }`}
            >
              <span>17.</span>
              <span>🍪 Cookie & Draft Governance</span>
            </button>

            {/* 18. Groq Autonomous AI Monitor */}
            <button
              onClick={() => setActiveTab('ai_monitor')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'ai_monitor'
                  ? 'bg-gradient-to-r from-purple-700 via-indigo-700 to-purple-900 text-white shadow-md'
                  : 'bg-purple-50 text-purple-950 hover:bg-purple-100 border border-purple-300'
              }`}
            >
              <span>18.</span>
              <span>🤖 AI Monitor</span>
              <span className="text-[10px] bg-purple-600 text-white px-1.5 py-0.2 rounded-full font-black">
                Groq Active
              </span>
            </button>

            {/* 19. Groq AI Brain & Executive Analytics */}
            <button
              onClick={() => setActiveTab('ai_brain')}
              className={`px-3.5 py-1.5 rounded-xl font-black text-xs transition-all flex items-center gap-1.5 ${
                activeTab === 'ai_brain'
                  ? 'bg-gradient-to-r from-purple-800 via-indigo-700 to-pink-700 text-white shadow-lg ring-2 ring-purple-400'
                  : 'bg-gradient-to-r from-purple-100 via-indigo-50 to-pink-50 text-purple-950 hover:brightness-95 border-2 border-purple-400 font-extrabold shadow-xs'
              }`}
            >
              <span>19.</span>
              <span>🧠 AI Brain</span>
              <span className="text-[10px] bg-gradient-to-r from-amber-500 to-red-500 text-white px-2 py-0.5 rounded-full font-black animate-pulse">
                Executive Intel
              </span>
            </button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="animate-pulse flex space-x-4">
          <div className="flex-1 space-y-4 py-1">
            <div className="h-4 bg-gray-300 rounded w-3/4"></div>
            <div className="space-y-2">
              <div className="h-4 bg-gray-300 rounded"></div>
              <div className="h-4 bg-gray-300 rounded w-5/6"></div>
            </div>
          </div>
        </div>
      ) : activeTab === 'dashboard' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-center items-center">
            <span className="text-gray-500 font-medium mb-1 text-sm">Total User Deposits</span>
            <span className="text-4xl font-extrabold text-green-600">₹{totalDeposits.toLocaleString()}</span>
            <span className="text-xs text-gray-400 mt-2">Combined balance in user accounts</span>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-center items-center relative">
            <span className="text-gray-500 font-medium mb-1 text-sm">CT Account (Deposits)</span>
            <span className="text-4xl font-extrabold text-indigo-600">₹{companyWallet.toLocaleString()}</span>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-gray-400">Total User Deposits</span>
              {currentUser.role === 'admin' && (
                <button 
                  onClick={handleAdjustCompanyWalletClick}
                  className="text-[11px] bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold px-2 py-0.5 rounded"
                >
                  Adjust
                </button>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-center items-center relative">
            <span className="text-gray-500 font-medium mb-1 text-sm">CT Collection (Revenue)</span>
            <span className="text-4xl font-extrabold text-blue-600">₹{ctCollection.toLocaleString()}</span>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-gray-400">Total virtual currency spent</span>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-center items-center relative">
            <span className="text-gray-500 font-medium mb-1 text-sm">DP Collection (Stuck)</span>
            <span className="text-4xl font-extrabold text-purple-600">₹{dpCollection.toLocaleString()}</span>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-gray-400">Drowned / Pending Verification</span>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-center items-center relative">
            <span className="text-gray-500 font-medium mb-1 text-sm flex items-center gap-1">
              CB Account (Company Balance)
            </span>
            {razorpayBalance ? (
              razorpayBalance.available ? (
                <>
                  <span className="text-4xl font-extrabold text-purple-600">
                    ₹{razorpayBalance.amount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-xs text-gray-400 mt-2">Disbursements & Payouts (Razorpay)</span>
                </>
              ) : (
                <>
                  <span className="text-xl font-bold text-gray-400 my-2">Not Configured</span>
                  <span className="text-xs text-gray-400 text-center">{razorpayBalance.message || 'Setup required'}</span>
                </>
              )
            ) : (
              <span className="text-sm font-bold text-gray-400 my-4">Fetching...</span>
            )}
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-center items-center">
            <span className="text-gray-500 font-medium mb-1 text-sm">Total Registered Accounts</span>
            <span className="text-4xl font-extrabold text-blue-600">{totalUsers.toLocaleString()}</span>
            <span className="text-xs text-gray-400 mt-2">{users.filter(u => u.role && u.role !== 'user').length} staff / employees</span>
          </div>
          
          <div className="md:col-span-3 bg-gray-900 text-white p-6 rounded-2xl">
            <h3 className="text-xl font-bold mb-2">Your Access Level: <span className="text-red-400 capitalize">{currentUser.role}</span></h3>
            <p className="text-gray-300 text-sm leading-relaxed">
              {currentUser.role === 'admin' ? "You have full superadmin control over user accounts, employee roles, company treasury, payment gateways, and withdrawal approvals." :
               currentUser.role === 'finance' ? "You have access to financial reports, deposit adjustments, and withdrawal request approvals." :
               currentUser.role === 'support' ? "You have access to customer support tickets, chat inquiries, and verification appeals." :
               currentUser.role === 'accountant' ? "You can review accounting ledgers and reconcile wallet transactions." :
               "You have staff access to assist users and manage listings."}
            </p>
          </div>
        </div>
      ) : activeTab === 'users' || activeTab === 'employees' ? (
        selectedUser ? (
          <div className="space-y-6">
            {/* Top User Header & Action Controls */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-6 pb-6 border-b border-gray-100">
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setSelectedUser(null)} 
                    className="p-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold transition flex items-center gap-1.5 text-xs cursor-pointer"
                  >
                    <span>&larr;</span> Back to Directory
                  </button>
                  <img src={selectedUser.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200'} alt="" className="w-16 h-16 rounded-full object-cover border-2 border-gray-100 shadow-xs" />
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-2xl font-bold text-gray-900">{selectedUser.username}</h2>
                      <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
                        {selectedUser.role || 'user'}
                      </span>
                      {selectedUser.isVerified ? (
                        <span className="inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-800 font-bold px-2.5 py-0.5 rounded-full border border-emerald-200">
                          <span>🛡️</span> Verified Member
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 font-bold px-2.5 py-0.5 rounded-full border border-amber-200">
                          <span>⚠️</span> KYC Unverified
                        </span>
                      )}
                      {(selectedUser.suspensionStatus === 'temporary' || selectedUser.suspensionStatus === 'permanent' || selectedUser.isDeleted) ? (
                        <span className="inline-flex items-center gap-1 text-xs bg-red-100 text-red-800 font-bold px-2.5 py-0.5 rounded-full border border-red-200">
                          <span>⛔</span> {selectedUser.suspensionStatus === 'permanent' ? 'Permanently Banned' : 'Temporarily Suspended'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-800 font-bold px-2.5 py-0.5 rounded-full border border-green-200">
                          <span>✓</span> Active Account
                        </span>
                      )}
                    </div>
                    <p className="text-gray-500 text-sm mt-0.5">{selectedUser.email || 'No email registered'}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                        <span>📱</span> Mobile: <strong className="font-mono text-gray-900">{selectedUser.phoneNumber || 'Not provided'}</strong>
                      </span>
                      {selectedUser.phoneVerified ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-200">
                          <span>✓</span> OTP Verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-[10px] font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                          Unverified
                        </span>
                      )}
                      {selectedUser.agreedToTerms && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">
                          <span>📜</span> Terms Accepted
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Primary User Administration Action Buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  {(selectedUser.suspensionStatus === 'temporary' || selectedUser.suspensionStatus === 'permanent' || selectedUser.isDeleted) ? (
                    <button
                      onClick={() => setUserActionModal({ type: 'unsuspend', user: selectedUser })}
                      className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>▶️</span> Unsuspend & Reactivate
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setUserActionModal({ type: 'suspend', user: selectedUser });
                        setUserActionSuspensionType('temporary');
                        setUserActionReason('');
                      }}
                      className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>⏸️</span> Suspend Account
                    </button>
                  )}

                  {currentUser?.role === 'admin' && (
                    <button
                      onClick={() => {
                        setUserActionModal({ type: 'delete', user: selectedUser });
                        setUserActionReason('');
                      }}
                      className="px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>🗑️</span> Delete Account
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setUserActionModal({ type: 'role', user: selectedUser });
                      setUserActionNewRole((selectedUser.role as UserRole) || 'user');
                    }}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xs rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>👑</span> Role ({selectedUser.role || 'user'})
                  </button>

                  <button
                    onClick={() => setUserActionModal({ type: 'kyc', user: selectedUser })}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xs rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>🛡️</span> {selectedUser.isVerified ? 'Revoke KYC' : 'Verify KYC'}
                  </button>

                  <button
                    onClick={() => { setActiveTab('chatting'); setChatFilterUser(selectedUser.id); setActiveChat(null); }}
                    className="px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>💬</span> Chat with User
                  </button>
                </div>
              </div>

              {/* User Metric Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="block text-xs text-gray-500 mb-1">Wallet Deposits</span>
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-bold text-green-600">₹{(selectedUser.deposits || 0).toLocaleString()}</span>
                    {(currentUser?.role === 'admin' || currentUser?.role === 'finance') && (
                      <div className="flex gap-1.5">
                        <button 
                          onClick={() => handleUpdateDeposit(selectedUser, 'add')}
                          className="text-[11px] bg-green-600 text-white font-bold px-2 py-1 rounded-lg hover:bg-green-700 cursor-pointer"
                        >
                          + Add
                        </button>
                        <button 
                          onClick={() => handleUpdateDeposit(selectedUser, 'deduct')}
                          className="text-[11px] bg-red-600 text-white font-bold px-2 py-1 rounded-lg hover:bg-red-700 cursor-pointer"
                        >
                          - Deduct
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="block text-xs text-gray-500 mb-1">Identity & Terms Status</span>
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-bold capitalize ${
                      selectedUser.verificationStatus === 'verified' ? 'text-emerald-600' :
                      selectedUser.verificationStatus === 'pending' ? 'text-amber-600' :
                      selectedUser.verificationStatus === 'rejected' ? 'text-red-600' : 'text-gray-600'
                    }`}>
                      KYC: {selectedUser.verificationStatus || 'unverified'}
                    </span>
                    {selectedUser.panNumber && (
                      <span className="text-[10px] font-mono font-bold bg-white px-2 py-0.5 rounded border border-gray-200">
                        PAN: {selectedUser.panNumber}
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="block text-xs text-gray-500 mb-1">Total Vehicle Listings</span>
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-bold text-gray-900">
                      {allVehicles.filter(v => (v.ownerId && v.ownerId === selectedUser.id) || (v.ownerUsername && selectedUser.username && v.ownerUsername.toLowerCase() === selectedUser.username.toLowerCase())).length}
                    </span>
                    <span className="text-xs text-gray-500 font-semibold">Active & Historic</span>
                  </div>
                </div>

                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="block text-xs text-gray-500 mb-1">Total Commission Paid</span>
                  <span className="text-xl font-bold text-emerald-600">₹{(selectedUser.totalCommissionPaid || 0).toLocaleString()}</span>
                </div>

                <div className="p-4 bg-indigo-50/70 rounded-xl border border-indigo-100 flex flex-col justify-between">
                  <div>
                    <span className="block text-xs text-indigo-700 font-semibold mb-1">Financial Activity</span>
                    <span className="text-xl font-bold text-indigo-900">
                      ₹{((selectedUser.walletBalance || 0) + (selectedUser.securityDeposit || 0)).toLocaleString()}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedUserDetailTab('ledger')}
                    className="mt-2 text-xs font-bold text-indigo-700 hover:text-indigo-900 flex items-center gap-1 cursor-pointer"
                  >
                    <span>Review User's Ledger</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            </div>

            {/* User Inspection Content: Vehicle Listings vs Ledger & Transactions */}
            {(() => {
              const inspectedUserVehicles = allVehicles.filter(v => 
                (v.ownerId && v.ownerId === selectedUser.id) ||
                (v.ownerUsername && selectedUser.username && v.ownerUsername.toLowerCase() === selectedUser.username.toLowerCase())
              );

              // Gather and enrich all transactions for this user across all channels
              const inspectedUserTransactions = allTransactions
                .filter(tx => 
                  (tx.userId && tx.userId === selectedUser.id) ||
                  (tx.username && selectedUser.username && tx.username.toLowerCase() === selectedUser.username.toLowerCase()) ||
                  (tx.email && selectedUser.email && tx.email.toLowerCase() === selectedUser.email.toLowerCase()) ||
                  (tx.userEmail && selectedUser.email && tx.userEmail.toLowerCase() === selectedUser.email.toLowerCase())
                )
                .map(tx => enrichTransaction(tx))
                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

              const userTotalInflows = inspectedUserTransactions
                .filter(tx => tx.status === 'success' && (tx.type === 'deposit' || tx.type === 'refund' || tx.type === 'referral_credit' || (tx.amount && tx.amount > 0 && tx.type !== 'withdrawal')))
                .reduce((sum, tx) => sum + (tx.amount || 0), 0);

              const userTotalOutflows = inspectedUserTransactions
                .filter(tx => tx.status === 'success' && (tx.type === 'withdrawal' || tx.type === 'bid_hold' || tx.type === 'buy_now' || tx.type === 'penalty' || tx.type === 'fee'))
                .reduce((sum, tx) => sum + Math.abs(tx.amount || 0), 0);

              const userFailedTransactions = inspectedUserTransactions.filter(tx => tx.status === 'failed');

              const filteredUserLedger = inspectedUserTransactions.filter(tx => {
                if (userLedgerFilter === 'credit') {
                  return tx.status === 'success' && (tx.type === 'deposit' || tx.type === 'refund' || tx.type === 'referral_credit');
                }
                if (userLedgerFilter === 'debit') {
                  return tx.status === 'success' && (tx.type === 'withdrawal' || tx.type === 'bid_hold' || tx.type === 'buy_now' || tx.type === 'fee' || tx.type === 'penalty');
                }
                if (userLedgerFilter === 'failed') {
                  return tx.status === 'failed';
                }
                return true;
              }).filter(tx => {
                if (!userLedgerSearch.trim()) return true;
                const q = userLedgerSearch.toLowerCase();
                return (
                  (tx.transactionId && tx.transactionId.toLowerCase().includes(q)) ||
                  (tx.id && tx.id.toLowerCase().includes(q)) ||
                  (tx.paymentId && tx.paymentId.toLowerCase().includes(q)) ||
                  (tx.gatewayOrderNumber && tx.gatewayOrderNumber.toLowerCase().includes(q)) ||
                  (tx.autobidOrderId && tx.autobidOrderId.toLowerCase().includes(q)) ||
                  (tx.utr && tx.utr.toLowerCase().includes(q)) ||
                  (tx.phoneNumber && tx.phoneNumber.toLowerCase().includes(q)) ||
                  (tx.paymentMethod && tx.paymentMethod.toLowerCase().includes(q)) ||
                  (tx.description && tx.description.toLowerCase().includes(q))
                );
              });

              const auctionVehicles = inspectedUserVehicles.filter(v => v.listingType === 'auction' || v.status === VehicleStatus.LIVE || v.status === VehicleStatus.UPCOMING || (!v.listingType && !v.buyNowPrice && v.status !== VehicleStatus.DIRECT_SALE));
              const directVehicles = inspectedUserVehicles.filter(v => v.listingType === 'direct' || v.status === VehicleStatus.DIRECT_SALE || Boolean(v.buyNowPrice && !v.currentBid));
              const liveVehicles = inspectedUserVehicles.filter(v => v.status === VehicleStatus.LIVE);
              const upcomingVehicles = inspectedUserVehicles.filter(v => v.status === VehicleStatus.UPCOMING);
              const restrictedVehicles = inspectedUserVehicles.filter(v => v.isRestricted || v.isShadowBanned);
              const soldVehicles = inspectedUserVehicles.filter(v => v.status === VehicleStatus.SOLD);

              const filteredUserVehicles = inspectedUserVehicles.filter(v => {
                if (userVehiclesFilter === 'auction') return v.listingType === 'auction' || v.status === VehicleStatus.LIVE || v.status === VehicleStatus.UPCOMING || (!v.listingType && !v.buyNowPrice && v.status !== VehicleStatus.DIRECT_SALE);
                if (userVehiclesFilter === 'direct') return v.listingType === 'direct' || v.status === VehicleStatus.DIRECT_SALE || Boolean(v.buyNowPrice && !v.currentBid);
                if (userVehiclesFilter === 'live') return v.status === VehicleStatus.LIVE;
                if (userVehiclesFilter === 'upcoming') return v.status === VehicleStatus.UPCOMING;
                if (userVehiclesFilter === 'restricted') return v.isRestricted || v.isShadowBanned;
                if (userVehiclesFilter === 'sold') return v.status === VehicleStatus.SOLD;
                return true;
              });

              return (
                <div className="space-y-4">
                  {/* Top Switcher: Vehicles vs Ledger */}
                  <div className="flex items-center gap-2 bg-white p-2 rounded-2xl border border-gray-100 shadow-xs">
                    <button
                      type="button"
                      onClick={() => setSelectedUserDetailTab('vehicles')}
                      className={`flex-1 py-3 px-4 rounded-xl text-xs sm:text-sm font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
                        selectedUserDetailTab === 'vehicles'
                          ? 'bg-gray-900 text-white shadow-sm'
                          : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      <span>🚗</span>
                      <span>Vehicle Listings ({inspectedUserVehicles.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedUserDetailTab('ledger')}
                      className={`flex-1 py-3 px-4 rounded-xl text-xs sm:text-sm font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
                        selectedUserDetailTab === 'ledger'
                          ? 'bg-indigo-900 text-white shadow-sm'
                          : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      <span>📊</span>
                      <span>User's Ledger & Financial Transactions ({inspectedUserTransactions.length})</span>
                      {userFailedTransactions.length > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500 text-white animate-pulse">
                          {userFailedTransactions.length} Failed/Exited
                        </span>
                      )}
                    </button>
                  </div>

                  {selectedUserDetailTab === 'ledger' ? (
                    /* User's Financial Ledger View */
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
                      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-gray-100">
                        <div>
                          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                            <span>📊</span>
                            <span>Financial Ledger for @{selectedUser.username}</span>
                            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                              UID: {selectedUser.id}
                            </span>
                          </h3>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Audit trail showing mean of payment (UPI, Cards, Net Banking, Wallet), Gateway Order #, UTR, customer phone number used during checkout, and failed in-between exits.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const headers = ['Transaction ID', 'Date', 'Type', 'Mean of Payment', 'Gateway Order #', 'UTR', 'Phone Number', 'Amount', 'Status', 'Description'];
                              const rows = filteredUserLedger.map(tx => [
                                `"${tx.transactionId || tx.id}"`,
                                `"${new Date(tx.timestamp).toISOString()}"`,
                                `"${tx.type}"`,
                                `"${tx.paymentMethod || 'Wallet'}"`,
                                `"${tx.gatewayOrderNumber || tx.rzpOrderId || ''}"`,
                                `"${tx.utr || ''}"`,
                                `"${tx.phoneNumber || selectedUser.phoneNumber || ''}"`,
                                `"${tx.amount}"`,
                                `"${tx.status}"`,
                                `"${(tx.description || '').replace(/"/g, '""')}"`
                              ]);
                              const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
                              const encodedUri = encodeURI(csvContent);
                              const link = document.createElement('a');
                              link.setAttribute('href', encodedUri);
                              link.setAttribute('download', `ledger_${selectedUser.username}_${new Date().toISOString().slice(0, 10)}.csv`);
                              document.body.appendChild(link);
                              link.click();
                              document.body.removeChild(link);
                            }}
                            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                          >
                            <span>📥</span> Export User Ledger (CSV)
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-100">
                          <span className="text-[10px] font-bold text-gray-400 block uppercase">Wallet Balance</span>
                          <span className="text-lg font-black text-gray-900 block mt-0.5">
                            ₹{(selectedUser.walletBalance || 0).toLocaleString()}
                          </span>
                          <span className="text-[10px] text-gray-500">Available to withdraw / bid</span>
                        </div>

                        <div className="p-3.5 bg-indigo-50/50 rounded-xl border border-indigo-100">
                          <span className="text-[10px] font-bold text-indigo-700 block uppercase">Security Deposit</span>
                          <span className="text-lg font-black text-indigo-900 block mt-0.5">
                            ₹{(selectedUser.securityDeposit || 0).toLocaleString()}
                          </span>
                          <span className="text-[10px] text-indigo-600">Active auction collateral</span>
                        </div>

                        <div className="p-3.5 bg-emerald-50/50 rounded-xl border border-emerald-100">
                          <span className="text-[10px] font-bold text-emerald-700 block uppercase">Total Inflows (Deposits)</span>
                          <span className="text-lg font-black text-emerald-700 block mt-0.5">
                            ₹{userTotalInflows.toLocaleString()}
                          </span>
                          <span className="text-[10px] text-emerald-600">Verified platform credits</span>
                        </div>

                        <div className="p-3.5 bg-blue-50/50 rounded-xl border border-blue-100">
                          <span className="text-[10px] font-bold text-blue-700 block uppercase">Total Outflows & Debits</span>
                          <span className="text-lg font-black text-blue-800 block mt-0.5">
                            ₹{userTotalOutflows.toLocaleString()}
                          </span>
                          <span className="text-[10px] text-blue-600">Withdrawals, bids & fees</span>
                        </div>

                        <div className="p-3.5 bg-rose-50/50 rounded-xl border border-rose-100">
                          <span className="text-[10px] font-bold text-rose-700 block uppercase">Failed / Exited Attempts</span>
                          <span className="text-lg font-black text-rose-700 block mt-0.5">
                            {userFailedTransactions.length}
                          </span>
                          <span className="text-[10px] text-rose-600">Abandoned / dismissed gateway</span>
                        </div>
                      </div>

                      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-gray-50/80 p-3 rounded-xl border border-gray-200">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setUserLedgerFilter('all')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                              userLedgerFilter === 'all' ? 'bg-gray-900 text-white shadow-xs' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                            }`}
                          >
                            All ({inspectedUserTransactions.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setUserLedgerFilter('credit')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                              userLedgerFilter === 'credit' ? 'bg-emerald-700 text-white shadow-xs' : 'bg-white text-emerald-700 hover:bg-emerald-50 border border-gray-200'
                            }`}
                          >
                            <span>↓</span> Inflows & Deposits
                          </button>
                          <button
                            type="button"
                            onClick={() => setUserLedgerFilter('debit')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                              userLedgerFilter === 'debit' ? 'bg-blue-700 text-white shadow-xs' : 'bg-white text-blue-700 hover:bg-blue-50 border border-gray-200'
                            }`}
                          >
                            <span>↑</span> Outflows & Debits
                          </button>
                          <button
                            type="button"
                            onClick={() => setUserLedgerFilter('failed')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                              userLedgerFilter === 'failed' ? 'bg-rose-700 text-white shadow-xs' : 'bg-white text-rose-700 hover:bg-rose-50 border border-gray-200'
                            }`}
                          >
                            <span>⚠️</span> Failed / Exited In-Between ({userFailedTransactions.length})
                          </button>
                        </div>

                        <div className="w-full md:w-80">
                          <input
                            type="text"
                            placeholder="Search Tx ID, UTR, Gateway Order, phone..."
                            value={userLedgerSearch}
                            onChange={e => setUserLedgerSearch(e.target.value)}
                            className="w-full px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                      </div>

                      <div className="overflow-x-auto rounded-xl border border-gray-200">
                        <table className="w-full text-left text-xs text-gray-500">
                          <thead className="text-[11px] text-gray-700 uppercase bg-gray-100 border-b border-gray-200 font-bold">
                            <tr>
                              <th className="px-4 py-3">Transaction ID & Date</th>
                              <th className="px-4 py-3">Mean of Payment</th>
                              <th className="px-4 py-3">Channel / Description</th>
                              <th className="px-4 py-3">Gateway Order # & UTR</th>
                              <th className="px-4 py-3">Gateway Phone</th>
                              <th className="px-4 py-3 text-right">Amount</th>
                              <th className="px-4 py-3 text-center">Status</th>
                              <th className="px-4 py-3 text-right">Inspect</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 bg-white">
                            {filteredUserLedger.length === 0 ? (
                              <tr>
                                <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                                  <div className="text-3xl mb-1">💳</div>
                                  <div className="font-bold text-gray-600">No Ledger Records Found</div>
                                  <p className="text-[11px] text-gray-400 mt-0.5">
                                    {inspectedUserTransactions.length === 0
                                      ? `@${selectedUser.username} does not have any financial transactions yet.`
                                      : 'No transactions match the selected filter or search term.'}
                                  </p>
                                </td>
                              </tr>
                            ) : (
                              filteredUserLedger.map((tx) => {
                                const methodInfo = getPaymentMethodInfo(tx.paymentMethod);
                                const isCredit = tx.type === 'deposit' || tx.type === 'refund' || tx.type === 'referral_credit';
                                const isFailed = tx.status === 'failed';

                                return (
                                  <tr 
                                    key={tx.id || tx.transactionId}
                                    onClick={() => setAdminSelectedTxForReceipt(tx)}
                                    className={`transition cursor-pointer hover:bg-indigo-50/30 ${isFailed ? 'bg-rose-50/20' : ''}`}
                                  >
                                    <td className="px-4 py-3 whitespace-nowrap">
                                      <div className="flex items-center gap-1.5 font-mono font-bold text-gray-900 text-[11px]">
                                        <span className="text-indigo-600">#{tx.transactionId || tx.id}</span>
                                      </div>
                                      <div className="text-[10px] text-gray-400 mt-0.5">
                                        {new Date(tx.timestamp).toLocaleString('en-IN', {
                                          day: '2-digit',
                                          month: 'short',
                                          year: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit'
                                        })}
                                      </div>
                                    </td>

                                    <td className="px-4 py-3 whitespace-nowrap">
                                      <div className="flex items-center gap-1.5">
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1 border ${methodInfo.bgColor} ${methodInfo.textColor} ${methodInfo.borderColor}`}>
                                          <span>{methodInfo.icon}</span>
                                          <span>{methodInfo.label}</span>
                                        </span>
                                      </div>
                                      {tx.paymentMethodDetails && (
                                        <div className="text-[10px] text-gray-500 font-mono mt-0.5 truncate max-w-[150px]">
                                          {tx.paymentMethodDetails}
                                        </div>
                                      )}
                                    </td>

                                    <td className="px-4 py-3 max-w-xs">
                                      <div className="font-bold text-gray-900 text-xs truncate">
                                        {tx.description || tx.type}
                                      </div>
                                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400">
                                        <span className="uppercase font-semibold tracking-wider px-1.5 py-0.2 bg-gray-100 rounded text-[9px] text-gray-600">
                                          {tx.channel || tx.type}
                                        </span>
                                        {tx.autobidOrderId && (
                                          <span className="font-mono text-indigo-600 font-semibold truncate">
                                            Ord: {tx.autobidOrderId}
                                          </span>
                                        )}
                                      </div>
                                    </td>

                                    <td className="px-4 py-3 whitespace-nowrap">
                                      <div className="text-[11px] font-mono text-gray-800">
                                        {tx.gatewayOrderNumber || tx.rzpOrderId ? (
                                          <span className="font-semibold text-gray-700">
                                            {tx.gatewayOrderNumber || tx.rzpOrderId}
                                          </span>
                                        ) : (
                                          <span className="text-gray-300 italic">Internal</span>
                                        )}
                                      </div>
                                      <div className="text-[10px] font-mono text-gray-500 mt-0.5">
                                        {tx.utr ? (
                                          <span className="text-emerald-700 font-semibold">UTR: {tx.utr}</span>
                                        ) : tx.paymentId ? (
                                          <span className="text-gray-400">Tx: {tx.paymentId}</span>
                                        ) : (
                                          <span className="text-gray-300">No UTR</span>
                                        )}
                                      </div>
                                    </td>

                                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs">
                                      {tx.phoneNumber || selectedUser.phoneNumber ? (
                                        <span className="text-gray-800 font-semibold">
                                          {tx.phoneNumber || selectedUser.phoneNumber}
                                        </span>
                                      ) : (
                                        <span className="text-gray-300 italic">N/A</span>
                                      )}
                                    </td>

                                    <td className="px-4 py-3 whitespace-nowrap text-right">
                                      <div className={`text-sm font-black ${
                                        isFailed ? 'text-gray-400 line-through' :
                                        isCredit ? 'text-emerald-600' : 'text-blue-700'
                                      }`}>
                                        {isCredit ? '+' : '-'}₹{(tx.amount || 0).toLocaleString()}
                                      </div>
                                    </td>

                                    <td className="px-4 py-3 whitespace-nowrap text-center">
                                      {isFailed ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-200">
                                          <span>✕</span> Failed / Exited
                                        </span>
                                      ) : tx.status === 'success' ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200">
                                          <span>✓</span> Completed
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-200">
                                          <span>⏳</span> Pending
                                        </span>
                                      )}
                                      {tx.failureReason && (
                                        <div className="text-[9px] text-rose-600 max-w-[140px] truncate mx-auto mt-0.5" title={tx.failureReason}>
                                          {tx.failureReason}
                                        </div>
                                      )}
                                    </td>

                                    <td className="px-4 py-3 whitespace-nowrap text-right">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setAdminSelectedTxForReceipt(tx);
                                        }}
                                        className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg text-xs transition border border-indigo-100 cursor-pointer"
                                      >
                                        Inspect ↗
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                  {/* Section Title & Filtering */}
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6 pb-4 border-b border-gray-100">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <span>🚗</span>
                        <span>Vehicle Listings by @{selectedUser.username}</span>
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                          {inspectedUserVehicles.length} total
                        </span>
                      </h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Inspect all posts, view real viewer count, asking prices, sale format (auction vs direct sale), and control moderation.
                      </p>
                    </div>

                    {/* Filter Tabs */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setUserVehiclesFilter('all')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                          userVehiclesFilter === 'all' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        All ({inspectedUserVehicles.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setUserVehiclesFilter('auction')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                          userVehiclesFilter === 'auction' ? 'bg-purple-700 text-white shadow-xs' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                        }`}
                      >
                        <span>🔨</span> Sell with Auction ({auctionVehicles.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setUserVehiclesFilter('direct')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                          userVehiclesFilter === 'direct' ? 'bg-emerald-700 text-white shadow-xs' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        }`}
                      >
                        <span>⚡</span> Sell without Auction ({directVehicles.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setUserVehiclesFilter('live')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                          userVehiclesFilter === 'live' ? 'bg-green-700 text-white shadow-xs' : 'bg-green-50 text-green-700 hover:bg-green-100'
                        }`}
                      >
                        <span>🟢</span> Live ({liveVehicles.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setUserVehiclesFilter('upcoming')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                          userVehiclesFilter === 'upcoming' ? 'bg-blue-700 text-white shadow-xs' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                        }`}
                      >
                        <span>🔵</span> Upcoming ({upcomingVehicles.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setUserVehiclesFilter('restricted')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                          userVehiclesFilter === 'restricted' ? 'bg-amber-700 text-white shadow-xs' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                        }`}
                      >
                        <span>🚫</span> Moderated ({restrictedVehicles.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setUserVehiclesFilter('sold')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                          userVehiclesFilter === 'sold' ? 'bg-gray-800 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        <span>✓</span> Sold ({soldVehicles.length})
                      </button>
                    </div>
                  </div>

                  {/* Listings Content */}
                  {filteredUserVehicles.length === 0 ? (
                    <div className="py-16 text-center text-gray-400 bg-gray-50/50 rounded-2xl border border-dashed border-gray-200">
                      <div className="text-4xl mb-2">🚗</div>
                      <h4 className="font-bold text-gray-700 text-base">No Listings Found</h4>
                      <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
                        {inspectedUserVehicles.length === 0 
                          ? `@${selectedUser.username} has not submitted any vehicle posts yet.`
                          : `No vehicles match the "${userVehiclesFilter}" filter for this user.`}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {filteredUserVehicles.map(vehicle => {
                        const isAuctionFormat = vehicle.listingType === 'auction' || vehicle.status === VehicleStatus.LIVE || vehicle.status === VehicleStatus.UPCOMING || (!vehicle.listingType && !vehicle.buyNowPrice && vehicle.status !== VehicleStatus.DIRECT_SALE);

                        return (
                          <div 
                            key={vehicle.id}
                            className={`p-4 rounded-2xl border transition shadow-xs flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 ${
                              vehicle.isRestricted ? 'bg-amber-50/40 border-amber-200' :
                              vehicle.isShadowBanned ? 'bg-purple-50/40 border-purple-200' :
                              'bg-white border-gray-100 hover:border-gray-300'
                            }`}
                          >
                            {/* Left: Thumbnail & Main Specs */}
                            <div className="flex items-center gap-4 min-w-0">
                              <div className="relative w-24 h-24 rounded-xl overflow-hidden bg-gray-100 shrink-0">
                                <img 
                                  src={vehicle.images?.[vehicle.coverImageIndex || 0] || `https://picsum.photos/id/${vehicle.imageSeed}/400/400`} 
                                  alt={vehicle.model}
                                  className="w-full h-full object-cover" 
                                />
                                {vehicle.isBoosted && (
                                  <span className="absolute top-1 left-1 bg-amber-500 text-white font-extrabold text-[9px] px-1 py-0.5 rounded shadow">
                                    ⚡ BOOST
                                  </span>
                                )}
                              </div>

                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                  <h4 className="font-bold text-gray-900 text-base truncate">
                                    {vehicle.year} {vehicle.make} {vehicle.model}
                                  </h4>

                                  {/* Sale Mode Badge */}
                                  {isAuctionFormat ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-extrabold bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full border border-purple-200">
                                      <span>🔨</span> Sell with Auction
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-extrabold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-200">
                                      <span>⚡</span> Sell without Auction
                                    </span>
                                  )}

                                  {/* Listing Status Badge */}
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                    vehicle.status === VehicleStatus.LIVE ? 'bg-green-100 text-green-800 border border-green-200 animate-pulse' :
                                    vehicle.status === VehicleStatus.UPCOMING ? 'bg-blue-100 text-blue-800 border border-blue-200' :
                                    vehicle.status === VehicleStatus.SOLD ? 'bg-gray-100 text-gray-700 border border-gray-200' :
                                    'bg-gray-100 text-gray-600'
                                  }`}>
                                    {vehicle.status}
                                  </span>

                                  {/* Moderation Badges */}
                                  {vehicle.isRestricted && (
                                    <span className="text-[10px] font-bold bg-amber-500 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                                      <span>🚫</span> Restricted
                                    </span>
                                  )}
                                  {vehicle.isShadowBanned && (
                                    <span className="text-[10px] font-bold bg-purple-700 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                                      <span>👻</span> Shadow Banned
                                    </span>
                                  )}
                                </div>

                                <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                                  <span>VIN: <strong className="font-mono text-gray-700">{vehicle.vin || 'N/A'}</strong></span>
                                  <span>•</span>
                                  <span>Stock #: <strong className="font-mono text-gray-700">#{vehicle.stockNumber || vehicle.id.slice(0, 8)}</strong></span>
                                  <span>•</span>
                                  <span>📍 {vehicle.location || 'Pan-India'}</span>
                                  <span>•</span>
                                  <span>Odometer: {(vehicle.odometer || 0).toLocaleString()} km</span>
                                </div>

                                {vehicle.restrictionReason && vehicle.isRestricted && (
                                  <p className="text-[11px] text-amber-800 bg-amber-100/60 rounded px-2 py-0.5 mt-1.5 font-medium">
                                    Restriction Note: {vehicle.restrictionReason}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Middle: Real Audience & Engagement Stats (Clickable to view real users modal) */}
                            <div className="flex items-center gap-3 bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                              <button
                                type="button"
                                onClick={() => setAudienceInspectModal({
                                  title: `Real Viewers for ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
                                  type: 'views',
                                  vehicle,
                                  users: vehicle.viewersList || []
                                })}
                                title="Click to view all real viewers of this vehicle"
                                className="text-center px-2 py-1 hover:bg-white rounded-lg transition cursor-pointer"
                              >
                                <span className="text-[10px] font-bold text-gray-400 block uppercase">Views</span>
                                <span className="text-sm font-extrabold text-blue-600 flex items-center gap-1 justify-center">
                                  <span>👁️</span> {vehicle.views || 0}
                                </span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setAudienceInspectModal({
                                  title: `Likes for ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
                                  type: 'likes',
                                  vehicle,
                                  users: vehicle.likesList || []
                                })}
                                title="Click to view users who liked this vehicle"
                                className="text-center px-2 py-1 hover:bg-white rounded-lg transition cursor-pointer"
                              >
                                <span className="text-[10px] font-bold text-gray-400 block uppercase">Likes</span>
                                <span className="text-sm font-extrabold text-rose-600 flex items-center gap-1 justify-center">
                                  <span>❤️</span> {vehicle.likesCount || vehicle.interestedCount || (vehicle.likesList?.length) || 0}
                                </span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setAudienceInspectModal({
                                  title: `Wishlist Saves for ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
                                  type: 'wishlist',
                                  vehicle,
                                  users: vehicle.wishlistUsers || []
                                })}
                                title="Click to view users who saved to wishlist"
                                className="text-center px-2 py-1 hover:bg-white rounded-lg transition cursor-pointer"
                              >
                                <span className="text-[10px] font-bold text-gray-400 block uppercase">Wishlist</span>
                                <span className="text-sm font-extrabold text-amber-600 flex items-center gap-1 justify-center">
                                  <span>🔖</span> {vehicle.watchCount || (vehicle.wishlistUsers?.length) || 0}
                                </span>
                              </button>
                            </div>

                            {/* Right: Pricing & Admin Post Control Activities */}
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                              <div className="text-left sm:text-right">
                                <span className="text-[10px] text-gray-400 font-bold uppercase block">
                                  {isAuctionFormat ? 'Asking / Reserve' : 'Asking / Direct Price'}
                                </span>
                                <span className="text-base font-extrabold text-gray-900 block">
                                  ₹{(vehicle.startingPrice || vehicle.buyNowPrice || vehicle.directPrice || 0).toLocaleString()}
                                </span>
                                {isAuctionFormat && (
                                  <span className="text-[11px] text-emerald-700 font-bold block">
                                    Highest Bid: ₹{(vehicle.currentBid || 0).toLocaleString()}
                                  </span>
                                )}
                                {vehicle.buyNowPrice && isAuctionFormat && (
                                  <span className="text-[10px] text-gray-500 font-medium block">
                                    Buy Now: ₹{(vehicle.buyNowPrice || 0).toLocaleString()}
                                  </span>
                                )}
                              </div>

                              {/* Control Action Buttons */}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setVehicleActionModal({ type: 'restrict', vehicle });
                                    setVehicleActionReason(vehicle.restrictionReason || '');
                                  }}
                                  title={vehicle.isRestricted ? "Remove restriction" : "Restrict listing from purchases/bids"}
                                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                                    vehicle.isRestricted ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' : 'bg-gray-100 text-gray-700 hover:bg-amber-50 hover:text-amber-800'
                                  }`}
                                >
                                  <span>🚫</span> {vehicle.isRestricted ? 'Unrestrict' : 'Restrict'}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setVehicleActionModal({ type: 'shadow_ban', vehicle });
                                  }}
                                  title={vehicle.isShadowBanned ? "Remove shadow ban" : "Shadow ban listing (hide from search & feeds)"}
                                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                                    vehicle.isShadowBanned ? 'bg-purple-100 text-purple-800 hover:bg-purple-200' : 'bg-gray-100 text-gray-700 hover:bg-purple-50 hover:text-purple-800'
                                  }`}
                                >
                                  <span>👻</span> {vehicle.isShadowBanned ? 'Un-Ghost' : 'Shadow Ban'}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setVehicleActionModal({ type: 'edit_reserve', vehicle });
                                    setNewReservePriceInput(vehicle.startingPrice || 0);
                                  }}
                                  title="Edit reserve price / asking price"
                                  className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg text-xs transition flex items-center gap-1 cursor-pointer"
                                >
                                  <span>✏️</span> Edit Price
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setVehicleActionModal({ type: 'delete', vehicle });
                                  }}
                                  title="Permanently delete vehicle listing"
                                  className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-lg text-xs transition flex items-center gap-1 cursor-pointer"
                                >
                                  <span>🗑️</span> Delete
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    if (onSelectVehicle) {
                                      onSelectVehicle(vehicle);
                                    } else {
                                      onNavigate('search');
                                    }
                                  }}
                                  title="Open live post"
                                  className="px-3 py-1.5 bg-gray-900 hover:bg-black text-white font-bold rounded-lg text-xs transition flex items-center gap-1 cursor-pointer"
                                >
                                  <span>👁️</span> View Post
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                  )}
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 bg-gray-50 border-b border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
              <span className="text-xs text-gray-600">
                {activeTab === 'users' ? 'Registered platform buyers and sellers.' : 'Staff and team accounts with custom permission roles.'}
              </span>
              <div className="flex items-center gap-3 w-full md:w-auto">
                {selectedUserIds.size > 0 && (
                  <div className="flex items-center gap-2 mr-2">
                    <span className="text-xs font-bold text-gray-600">{selectedUserIds.size} selected</span>
                    <button onClick={() => handleBulkUpdateDepositClick('add')} className="text-xs bg-green-100 text-green-700 font-bold px-3 py-1.5 rounded-lg hover:bg-green-200">+ Bulk Add</button>
                    <button onClick={() => handleBulkUpdateDepositClick('deduct')} className="text-xs bg-red-100 text-red-700 font-bold px-3 py-1.5 rounded-lg hover:bg-red-200">- Bulk Deduct</button>
                  </div>
                )}
                <input
                  type="text"
                  placeholder="Search username, email, or UID..."
                  value={userSearchQuery}
                  onChange={e => setUserSearchQuery(e.target.value)}
                  className="border border-gray-300 rounded-xl px-3.5 py-1.5 text-xs w-full md:w-72 focus:outline-none focus:border-red-500"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-gray-500">
                <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-4">
                      <input 
                        type="checkbox" 
                        checked={selectedUserIds.size === filteredUsersList.length && filteredUsersList.length > 0}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
                      />
                    </th>
                    <th className="px-6 py-4">Account</th>
                    <th className="px-6 py-4">Email</th>
                    <th className="px-6 py-4">Mobile Number</th>
                    <th className="px-6 py-4">UID</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Listings</th>
                    <th className="px-6 py-4">Wallet Balance</th>
                    <th className="px-6 py-4">Role</th>
                    <th className="px-6 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsersList.map(user => (
                    <tr key={user.id} className={`border-b hover:bg-gray-50 cursor-pointer ${(user.suspensionStatus === 'temporary' || user.suspensionStatus === 'permanent' || user.isDeleted) ? 'bg-red-50/30' : 'bg-white'}`} onClick={() => setSelectedUser(user)}>
                      <td className="px-6 py-4" onClick={e => e.stopPropagation()}>
                        <input 
                          type="checkbox" 
                          checked={selectedUserIds.has(user.id)}
                          onChange={() => toggleSelectUser(user.id)}
                          className="w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
                        />
                      </td>
                      <td className="px-6 py-4 font-medium text-gray-900 flex items-center gap-3">
                        <img src={user.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200'} alt="" className="w-8 h-8 rounded-full object-cover" />
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-gray-900 block">{user.username}</span>
                            {appeals.some(a => a.userId === user.id && a.type === 'account_deletion' && a.status === 'pending') && (
                              <span className="text-[10px] bg-rose-100 text-rose-800 border border-rose-300 font-extrabold px-1.5 py-0.5 rounded-full animate-pulse flex items-center gap-1">
                                <span>🗑️</span> Deletion Appeal
                              </span>
                            )}
                          </div>
                          {hasInconvenience(user.id) && <span className="text-[10px] text-red-600 font-bold">Needs Attention</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs">{user.email || 'N/A'}</td>
                      <td className="px-6 py-4 text-xs font-mono">
                        {user.phoneNumber ? (
                          <div className="flex items-center gap-1.5 font-bold text-gray-900">
                            <span>{user.phoneNumber}</span>
                            {user.phoneVerified && (
                              <span className="text-emerald-600 text-xs font-extrabold" title="OTP Verified">✓</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400 font-sans italic text-[11px]">Unregistered</span>
                        )}
                      </td>
                      <td className="px-6 py-4 font-mono text-[11px] text-gray-400">{user.id.slice(0, 10)}...</td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${(user.suspensionStatus === 'temporary' || user.suspensionStatus === 'permanent' || user.isDeleted) ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                          {(user.suspensionStatus === 'temporary' || user.suspensionStatus === 'permanent' || user.isDeleted) ? 'Suspended' : 'Active'}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-semibold text-gray-700">{vehiclesCount[user.id] || 0}</td>
                      <td className="px-6 py-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-green-600">₹{(user.deposits || 0).toLocaleString()}</span>
                          {(currentUser.role === 'admin' || currentUser.role === 'finance') && (
                            <div className="flex gap-1">
                              <button 
                                onClick={() => handleUpdateDeposit(user, 'add')}
                                title="Add funds to wallet (deducts from company)"
                                className="text-[11px] bg-green-50 text-green-700 font-bold px-2 py-0.5 rounded hover:bg-green-100"
                              >
                                + Add
                              </button>
                              <button 
                                onClick={() => handleUpdateDeposit(user, 'deduct')}
                                title="Deduct funds from wallet (credits to company)"
                                className="text-[11px] bg-red-50 text-red-700 font-bold px-2 py-0.5 rounded hover:bg-red-100"
                              >
                                - Minus
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4" onClick={e => e.stopPropagation()}>
                        {currentUser.role === 'admin' ? (
                          <select 
                            className="bg-gray-50 border border-gray-300 text-gray-900 text-xs rounded-lg focus:ring-red-500 focus:border-red-500 block p-1.5 font-medium"
                            value={user.role || 'user'}
                            onChange={(e) => handleRoleChange(user.id, e.target.value as UserRole)}
                          >
                            {ROLES.map(r => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="capitalize px-2.5 py-1 bg-gray-100 rounded-full text-xs font-bold text-gray-700">{user.role || 'user'}</span>
                        )}
                      </td>
                      <td className="px-6 py-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setSelectedUser(user)}
                            className="text-blue-700 bg-blue-50 hover:bg-blue-100 font-bold px-2.5 py-1 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition"
                            title="Inspect user details and vehicle posts"
                          >
                            <span>🔍</span> Inspect ({vehiclesCount[user.id] || 0})
                          </button>

                          {(user.suspensionStatus === 'temporary' || user.suspensionStatus === 'permanent' || user.isDeleted) ? (
                            <button 
                              type="button"
                              className="text-emerald-700 hover:text-emerald-900 font-bold bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-lg text-xs cursor-pointer transition flex items-center gap-1"
                              onClick={() => setUserActionModal({ type: 'unsuspend', user })}
                              title="Reactivate user account"
                            >
                              <span>▶️</span> Unsuspend
                            </button>
                          ) : (
                            currentUser?.role === 'admin' && (
                              <button 
                                type="button"
                                className="text-amber-700 hover:text-amber-900 font-bold bg-amber-50 hover:bg-amber-100 px-2.5 py-1 rounded-lg text-xs cursor-pointer transition flex items-center gap-1"
                                onClick={() => {
                                  setUserActionModal({ type: 'suspend', user });
                                  setUserActionSuspensionType('temporary');
                                  setUserActionReason('');
                                }}
                                title="Suspend user account"
                              >
                                <span>⏸️</span> Suspend
                              </button>
                            )
                          )}

                          {currentUser?.role === 'admin' && (
                            <button 
                              type="button"
                              className="text-rose-700 hover:text-rose-900 font-bold bg-rose-50 hover:bg-rose-100 px-2.5 py-1 rounded-lg text-xs cursor-pointer transition flex items-center gap-1"
                              onClick={() => {
                                setUserActionModal({ type: 'delete', user });
                                setUserActionReason('');
                              }}
                              title="Permanently delete user account and clean up"
                            >
                              <span>🗑️</span> Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : activeTab === 'pending' ? (
        <div className="bg-white rounded-2xl shadow-xs border border-gray-200 overflow-hidden p-6 space-y-6">
          {actionFeedback && (
            <div className={`p-4 rounded-xl flex items-center justify-between border shadow-xs animate-fade-in ${
              actionFeedback.type === 'success' 
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                : 'bg-red-50 border-red-200 text-red-800'
            }`}>
              <div className="flex items-center gap-2.5 font-bold text-xs sm:text-sm">
                <span>{actionFeedback.type === 'success' ? '✓' : '⚠️'}</span>
                <span>{actionFeedback.message}</span>
              </div>
              <button 
                type="button"
                onClick={() => setActionFeedback(null)} 
                className="text-xs font-bold px-2 py-1 hover:bg-black/5 rounded-lg transition"
              >
                ✕
              </button>
            </div>
          )}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse"></span>
                <h2 className="text-xl font-bold text-gray-900">Module 7: Order & Auction Command Center</h2>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Full auction tracking, manual status overrides, extending timers, dispute handling, and direct buy management.
              </p>
            </div>

            {/* Filter Pills */}
            <div className="flex flex-wrap gap-1.5 bg-gray-100 p-1 rounded-xl text-xs font-semibold">
              <button
                onClick={() => setAuctionFilter('all')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${auctionFilter === 'all' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900'}`}
              >
                All ({allVehicles.length})
              </button>
              <button
                onClick={() => setAuctionFilter('pending')}
                className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 ${auctionFilter === 'pending' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900'}`}
              >
                <span>Pending Review</span>
                {pendingVehicles.length > 0 && (
                  <span className="bg-red-600 text-white text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                    {pendingVehicles.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setAuctionFilter('live')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${auctionFilter === 'live' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900'}`}
              >
                Live Bidding ({allVehicles.filter(v => v.status === 'Live Auction').length})
              </button>
              <button
                onClick={() => setAuctionFilter('upcoming')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${auctionFilter === 'upcoming' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900'}`}
              >
                Upcoming ({allVehicles.filter(v => v.status === 'Upcoming').length})
              </button>
              <button
                onClick={() => setAuctionFilter('sold')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${auctionFilter === 'sold' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900'}`}
              >
                Ended / Sold ({allVehicles.filter(v => v.status === 'Ended' || v.status === 'Sold').length})
              </button>
              <button
                onClick={() => setAuctionFilter('restricted')}
                className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 ${auctionFilter === 'restricted' ? 'bg-amber-100 text-amber-900 font-bold shadow-xs' : 'text-amber-700 hover:bg-amber-50'}`}
              >
                <span>⚠️ Restricted</span>
                <span className="bg-amber-200 text-amber-900 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                  {allVehicles.filter(v => v.isRestricted).length}
                </span>
              </button>
              <button
                onClick={() => setAuctionFilter('shadow_banned')}
                className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 ${auctionFilter === 'shadow_banned' ? 'bg-purple-100 text-purple-900 font-bold shadow-xs' : 'text-purple-700 hover:bg-purple-50'}`}
              >
                <span>👻 Shadow Banned</span>
                <span className="bg-purple-200 text-purple-900 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                  {allVehicles.filter(v => v.isShadowBanned).length}
                </span>
              </button>
            </div>
          </div>

          {/* Vehicle Cards Grid */}
          {(() => {
            const displayedVehicles = allVehicles.filter(v => {
              if (v.isDeleted) return false;
              if (auctionFilter === 'pending') return v.status === VehicleStatus.PENDING_REVIEW;
              if (auctionFilter === 'live') return v.status === 'Live Auction';
              if (auctionFilter === 'upcoming') return v.status === 'Upcoming';
              if (auctionFilter === 'sold') return v.status === 'Ended' || v.status === 'Sold';
              if (auctionFilter === 'restricted') return v.isRestricted;
              if (auctionFilter === 'shadow_banned') return v.isShadowBanned;
              return true;
            });

            if (displayedVehicles.length === 0) {
              return (
                <div className="text-center py-16 text-gray-400 space-y-2">
                  <div className="w-12 h-12 mx-auto rounded-full bg-gray-100 flex items-center justify-center text-xl">
                    🚗
                  </div>
                  <h4 className="font-bold text-gray-700 text-sm">No vehicles matching filter</h4>
                  <p className="text-xs text-gray-400">Try switching to "All" or waiting for sellers to submit listings.</p>
                </div>
              );
            }

            return (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {displayedVehicles.map(vehicle => {
                  const isLive = vehicle.status === 'Live Auction';
                  const isPending = vehicle.status === VehicleStatus.PENDING_REVIEW;
                  const isSold = vehicle.status === 'Sold';
                  return (
                    <div key={vehicle.id} className="border border-gray-200 rounded-2xl p-4 flex flex-col justify-between gap-3 shadow-2xs hover:shadow-xs transition-shadow bg-white">
                      <div>
                        <div className="relative h-44 bg-gray-100 rounded-xl overflow-hidden mb-3">
                          <img
                            src={vehicle.images?.[vehicle.coverImageIndex || 0] || 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&q=80&w=800'}
                            alt={vehicle.model}
                            className="w-full h-full object-cover"
                          />
                          <span className={`absolute top-2 left-2 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            isLive ? 'bg-red-600 text-white animate-pulse' :
                            isPending ? 'bg-amber-500 text-white' :
                            isSold ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-white'
                          }`}>
                            {vehicle.status}
                          </span>
                          <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                            {vehicle.isBlacklisted && (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-black text-red-400">
                                BLACKLISTED
                              </span>
                            )}
                            {vehicle.isRestricted && (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-amber-500 text-white shadow-xs">
                                RESTRICTED
                              </span>
                            )}
                            {vehicle.isShadowBanned && (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-purple-700 text-white shadow-xs">
                                👻 SHADOW BANNED
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <h3 className="font-bold text-base text-gray-900">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
                          <div className="flex justify-between text-xs text-gray-600">
                            <span>Current Bid: <strong className="text-gray-900">₹{(vehicle.currentBid || vehicle.startingPrice || 0).toLocaleString()}</strong></span>
                            <span>Direct Price: <strong className="text-emerald-600">{vehicle.directPrice ? `₹${vehicle.directPrice.toLocaleString()}` : 'N/A'}</strong></span>
                          </div>
                          <div className="text-[11px] text-gray-400">
                            Owner: <span className="font-mono text-gray-600">{vehicle.ownerUsername || vehicle.ownerId?.slice(0, 10)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Admin Controls */}
                      <div className="pt-3 border-t border-gray-100 space-y-2">
                        {isPending && (
                          <div className="flex gap-2">
                            <button
                              onClick={async () => {
                                try {
                                  setAllVehicles(prev => prev.map(v => v.id === vehicle.id ? { ...v, status: VehicleStatus.UPCOMING } : v));
                                  await updateDoc(doc(db, 'vehicles', vehicle.id), { status: VehicleStatus.UPCOMING });
                                  await addDoc(collection(db, 'notifications'), {
                                    userId: vehicle.ownerId,
                                    type: 'listing_approved',
                                    message: `Your listing for ${vehicle.year} ${vehicle.make} ${vehicle.model} has been approved and scheduled!`,
                                    read: false,
                                    createdAt: Date.now(),
                                    vehicleId: vehicle.id
                                  });
                                  await logAdminAction(currentUser, 'APPROVE_LISTING', 'vehicles', vehicle.id, `Approved vehicle ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
                                  setActionFeedback({ message: `Listing for ${vehicle.year} ${vehicle.make} ${vehicle.model} approved & scheduled!`, type: 'success' });
                                } catch (e: any) {
                                  setActionFeedback({ message: `Approval error: ${e.message}`, type: 'error' });
                                }
                              }}
                              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 rounded-xl text-xs transition cursor-pointer"
                            >
                              Approve & Schedule
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setVehicleActionReason('Listing photo or details did not meet marketplace quality standards');
                                setVehicleActionModal({ type: 'reject', vehicle });
                              }}
                              className="px-3 bg-red-50 hover:bg-red-100 text-red-600 font-bold py-2 rounded-xl text-xs transition cursor-pointer"
                            >
                              Reject
                            </button>
                          </div>
                        )}

                        {isLive && (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                const newEndTime = (vehicle.endTime || Date.now()) + 3600000;
                                setAllVehicles(prev => prev.map(v => v.id === vehicle.id ? { ...v, endTime: newEndTime } : v));
                                await updateDoc(doc(db, 'vehicles', vehicle.id), { endTime: newEndTime });
                                await logAdminAction(currentUser, 'EXTEND_AUCTION_TIMER', 'vehicles', vehicle.id, `Extended timer +1hr for ${vehicle.model}`);
                                setActionFeedback({ message: `Auction extended +1 hr for ${vehicle.model}!`, type: 'success' });
                              }}
                              className="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold py-2 rounded-xl text-xs transition cursor-pointer"
                            >
                              +1 Hr Extend
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                setAllVehicles(prev => prev.map(v => v.id === vehicle.id ? { ...v, status: 'Ended' as any, endTime: Date.now() } : v));
                                await updateDoc(doc(db, 'vehicles', vehicle.id), { status: 'Ended', endTime: Date.now() });
                                await logAdminAction(currentUser, 'FORCE_END_AUCTION', 'vehicles', vehicle.id, `Force ended auction for ${vehicle.model}`);
                                setActionFeedback({ message: `Auction closed for ${vehicle.model}!`, type: 'success' });
                              }}
                              className="flex-1 bg-gray-900 hover:bg-black text-white font-bold py-2 rounded-xl text-xs transition cursor-pointer"
                            >
                              End Auction Now
                            </button>
                          </div>
                        )}

                        {/* Admin Vehicle Moderation: Restrict, Shadow Ban & Delete (In-App, No window.confirm) */}
                        <div className="grid grid-cols-3 gap-1.5 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              if (vehicle.isRestricted) {
                                // If already restricted, prompt to unrestrict
                                setVehicleActionReason('');
                                setVehicleActionModal({ type: 'restrict', vehicle });
                              } else {
                                setVehicleActionReason('Administrative inspection and moderation review');
                                setVehicleActionModal({ type: 'restrict', vehicle });
                              }
                            }}
                            className={`px-2 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
                              vehicle.isRestricted 
                                ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-2xs' 
                                : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
                            }`}
                            title="Restrict vehicle from receiving bids or sales"
                          >
                            <span>⚠️</span> {vehicle.isRestricted ? 'Unrestrict' : 'Restrict'}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setVehicleActionModal({ type: 'shadow_ban', vehicle });
                            }}
                            className={`px-2 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
                              vehicle.isShadowBanned 
                                ? 'bg-purple-700 text-white hover:bg-purple-800 shadow-2xs' 
                                : 'bg-purple-50 text-purple-800 hover:bg-purple-100 border border-purple-200'
                            }`}
                            title="Shadow ban vehicle (hidden from all users except seller and admins)"
                          >
                            <span>👻</span> {vehicle.isShadowBanned ? 'Un-Shadow' : 'Shadow Ban'}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setVehicleActionModal({ type: 'delete', vehicle });
                            }}
                            className="px-2 py-1.5 rounded-lg text-[11px] font-bold bg-red-50 text-red-700 hover:bg-red-600 hover:text-white border border-red-200 transition flex items-center justify-center gap-1 cursor-pointer"
                            title="Permanently delete vehicle listing"
                          >
                            <span>🗑️</span> Delete
                          </button>
                        </div>

                        <div className="flex justify-between items-center text-xs pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setNewReservePriceInput(vehicle.startingPrice || 0);
                              setVehicleActionModal({ type: 'edit_reserve', vehicle });
                            }}
                            className="text-gray-500 hover:text-gray-800 font-medium cursor-pointer"
                          >
                            Edit Reserve
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const toggle = !vehicle.isBlacklisted;
                              setAllVehicles(prev => prev.map(v => v.id === vehicle.id ? { ...v, isBlacklisted: toggle } : v));
                              await updateDoc(doc(db, 'vehicles', vehicle.id), { isBlacklisted: toggle });
                              await logAdminAction(currentUser, 'TOGGLE_BLACKLIST', 'vehicles', vehicle.id, `Set isBlacklisted=${toggle}`);
                              setActionFeedback({ message: `Vehicle ${toggle ? 'blacklisted' : 'un-blacklisted'}!`, type: 'success' });
                            }}
                            className="text-red-500 hover:text-red-700 font-bold cursor-pointer"
                          >
                            {vehicle.isBlacklisted ? 'Un-blacklist' : 'Blacklist'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      ) : activeTab === 'financial_management' ? (
        <AdminFinancialManagement
          currentUser={currentUser}
          companyWallet={companyWallet}
          ctCollection={ctCollection}
          dpCollection={dpCollection}
          razorpayBalance={razorpayBalance}
          withdrawals={withdrawals}
          allTransactions={allTransactions}
          users={users}
          isWithdrawalOtpVerified={isWithdrawalOtpVerified}
          onRequestOtpVerification={(action) => handleTriggerWithdrawalOtp(action)}
          onRefreshBalances={async () => {
            try {
              const res = await fetch('/api/razorpay-company-balance');
              if (!res.ok) return;
              const contentType = res.headers.get('content-type') || '';
              if (!contentType.includes('application/json')) return;
              const data = await res.json();
              if (data.available) {
                let amount = 0;
                if (data.type === 'gateway' && data.rawData && typeof data.rawData.balance !== 'undefined') {
                  amount = data.rawData.balance / 100;
                } else if (data.type === 'razorpayX' && data.rawData) {
                  if (data.rawData.balance !== undefined) {
                    amount = data.rawData.balance / 100;
                  } else if (Array.isArray(data.rawData.items) && data.rawData.items.length > 0) {
                    amount = data.rawData.items[0].balance / 100;
                  }
                }
                setRazorpayBalance({ available: true, amount });
              }
            } catch (err) {
              console.warn('Notice: Sync Razorpay balance:', err);
            }
          }}
        />
      ) : activeTab === 'ledger' ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden p-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Platform Ledger (Transactions)</h2>
              <p className="text-xs text-gray-500 mt-0.5">View all financial activity across the platform, including user deposits, admin adjustments, services, donations, and withdrawals.</p>
            </div>
            <div className="bg-gray-900 text-white px-4 py-2 rounded-xl text-right flex gap-6">
              <div>
                <span className="text-[10px] text-gray-400 block uppercase font-bold">CT Account</span>
                <span className="text-lg font-bold text-green-400">₹{companyWallet.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-[10px] text-gray-400 block uppercase font-bold">CT Collection</span>
                <span className="text-lg font-bold text-blue-400">₹{ctCollection.toLocaleString()}</span>
              </div>
            </div>
          </div>
          
          <div className="mb-4 flex flex-col md:flex-row gap-3">
            <input 
              type="text" 
              placeholder="Search by Username, Order ID, or Transaction ID..." 
              value={ledgerSearchTerm} 
              onChange={(e) => setLedgerSearchTerm(e.target.value)} 
              className="w-full md:w-1/3 px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-medium"
            />
            <button
              onClick={handleExportLedger}
              className="px-4 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-xl font-bold text-sm border border-indigo-100 transition-colors whitespace-nowrap"
            >
              Export to CSV
            </button>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-gray-500">
              <thead className="text-[11px] text-gray-700 uppercase bg-gray-50 border-b font-bold">
                <tr>
                  <th className="px-5 py-3">Transaction ID & Date</th>
                  <th className="px-5 py-3">Mean of Payment</th>
                  <th className="px-5 py-3">User & Contact</th>
                  <th className="px-5 py-3">Type & Description</th>
                  <th className="px-5 py-3">Gateway Order & UTR</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  <th className="px-5 py-3 text-center">Status</th>
                  <th className="px-5 py-3 text-right">Audit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {allTransactions
                  .map(tx => enrichTransaction(tx))
                  .filter(tx => !ledgerSearchTerm || 
                    (tx.transactionId && tx.transactionId.toLowerCase().includes(ledgerSearchTerm.toLowerCase())) ||
                    (tx.username && tx.username.toLowerCase().includes(ledgerSearchTerm.toLowerCase())) ||
                    (tx.withdrawalOrderId && tx.withdrawalOrderId.toLowerCase().includes(ledgerSearchTerm.toLowerCase())) ||
                    (tx.autobidOrderId && tx.autobidOrderId.toLowerCase().includes(ledgerSearchTerm.toLowerCase())) ||
                    (tx.paymentId && tx.paymentId.toLowerCase().includes(ledgerSearchTerm.toLowerCase())) ||
                    (tx.gatewayOrderNumber && tx.gatewayOrderNumber.toLowerCase().includes(ledgerSearchTerm.toLowerCase())) ||
                    (tx.rzpOrderId && tx.rzpOrderId.toLowerCase().includes(ledgerSearchTerm.toLowerCase())) ||
                    (tx.utr && tx.utr.toLowerCase().includes(ledgerSearchTerm.toLowerCase())) ||
                    (tx.phoneNumber && tx.phoneNumber.toLowerCase().includes(ledgerSearchTerm.toLowerCase())) ||
                    (tx.paymentMethod && tx.paymentMethod.toLowerCase().includes(ledgerSearchTerm.toLowerCase())) ||
                    (tx.id && tx.id.toLowerCase().includes(ledgerSearchTerm.toLowerCase()))
                  )
                  .slice(0, 200).map(tx => {
                    const methodInfo = getPaymentMethodInfo(tx.paymentMethod);
                    const isCredit = tx.type === 'deposit' || tx.type === 'refund' || tx.type === 'referral_credit';
                    const isFailed = tx.status === 'failed';

                    return (
                      <tr 
                        key={tx.id || tx.transactionId} 
                        onClick={() => setAdminSelectedTxForReceipt(tx)}
                        className={`transition cursor-pointer hover:bg-indigo-50/40 ${isFailed ? 'bg-rose-50/20' : ''}`}
                      >
                        {/* Transaction ID & Date */}
                        <td className="px-5 py-3 whitespace-nowrap">
                          <div className="font-mono font-bold text-gray-900 text-xs text-indigo-600">
                            #{tx.transactionId || tx.id}
                          </div>
                          <div className="text-[10px] text-gray-400 mt-0.5">
                            {new Date(tx.timestamp).toLocaleString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                        </td>

                        {/* Mean of Payment */}
                        <td className="px-5 py-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider inline-flex items-center gap-1 border ${methodInfo.bgColor} ${methodInfo.textColor} ${methodInfo.borderColor}`}>
                            <span>{methodInfo.icon}</span>
                            <span>{methodInfo.label}</span>
                          </span>
                          {tx.paymentMethodDetails && (
                            <div className="text-[10px] text-gray-500 font-mono mt-0.5 truncate max-w-[140px]">
                              {tx.paymentMethodDetails}
                            </div>
                          )}
                        </td>

                        {/* User & Contact */}
                        <td className="px-5 py-3 whitespace-nowrap">
                          <div className="font-bold text-gray-900 text-xs">
                            {tx.username || 'System Account'}
                          </div>
                          <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                            {tx.phoneNumber ? (
                              <span>📱 {tx.phoneNumber}</span>
                            ) : tx.userEmail ? (
                              <span className="truncate max-w-[130px] block">{tx.userEmail}</span>
                            ) : (
                              <span className="text-gray-400">UID: {tx.userId?.slice(0, 8) || 'N/A'}</span>
                            )}
                          </div>
                        </td>

                        {/* Type & Description */}
                        <td className="px-5 py-3 max-w-xs" title={tx.description}>
                          <div className="truncate font-semibold text-gray-800 text-xs">{tx.description || tx.type}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 bg-gray-100 text-gray-600 rounded">
                              {tx.channel || tx.type}
                            </span>
                            {(tx.autobidOrderId || tx.withdrawalOrderId) && (
                              <span className="text-[10px] text-indigo-600 font-mono font-semibold">
                                {tx.autobidOrderId || tx.withdrawalOrderId}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Gateway Order & UTR */}
                        <td className="px-5 py-3 whitespace-nowrap">
                          <div className="text-[11px] font-mono text-gray-800 font-semibold">
                            {tx.gatewayOrderNumber || tx.rzpOrderId ? (
                              <span>{tx.gatewayOrderNumber || tx.rzpOrderId}</span>
                            ) : (
                              <span className="text-gray-300 italic font-normal">Internal Ledger</span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-gray-500 mt-0.5">
                            {tx.utr ? (
                              <span className="text-emerald-700 font-semibold">UTR: {tx.utr}</span>
                            ) : tx.paymentId ? (
                              <span className="text-gray-400">Tx: {tx.paymentId}</span>
                            ) : (
                              <span className="text-gray-300">N/A</span>
                            )}
                          </div>
                        </td>

                        {/* Amount */}
                        <td className="px-5 py-3 whitespace-nowrap text-right">
                          <span className={`font-black text-sm ${
                            isFailed ? 'text-gray-400 line-through' :
                            isCredit ? 'text-emerald-600' : 'text-blue-700'
                          }`}>
                            {isCredit ? '+' : '-'}₹{(tx.amount || 0).toLocaleString()}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-5 py-3 whitespace-nowrap text-center">
                          {isFailed ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-100 text-rose-800 border border-rose-200">
                              Failed / Exited
                            </span>
                          ) : tx.status === 'success' ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-green-100 text-green-700 border border-green-200">
                              Success
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-orange-100 text-orange-700 border border-orange-200">
                              Pending
                            </span>
                          )}
                          {tx.failureReason && (
                            <div className="text-[9px] text-rose-600 truncate max-w-[120px] mx-auto mt-0.5" title={tx.failureReason}>
                              {tx.failureReason}
                            </div>
                          )}
                        </td>

                        {/* Audit / Inspect */}
                        <td className="px-5 py-3 whitespace-nowrap text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAdminSelectedTxForReceipt(tx);
                            }}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg text-xs transition border border-indigo-100 cursor-pointer"
                          >
                            Inspect ↗
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                {allTransactions.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
                      No transactions recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === 'withdrawals' ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden p-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-gray-900">Withdrawal & Payout Requests</h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
                  Requester Email OTP Verified
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Review and disburse payout requests. Users have verified their registered email OTP during request. Approving automatically debits your CB Account (Razorpay Balance).
              </p>
            </div>
            <div className="bg-gray-900 text-white px-4 py-2 rounded-xl text-right">
              <span className="text-[10px] text-gray-400 block uppercase font-bold">CB Account (Payout Balance)</span>
              {razorpayBalance?.available ? (
                <span className="text-lg font-bold text-blue-400">
                  ₹{razorpayBalance.amount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              ) : (
                <span className="text-sm font-bold text-red-400">Not Configured</span>
              )}
            </div>
          </div>

          <div className="mb-6 p-3.5 rounded-2xl bg-emerald-50/80 border border-emerald-200 flex items-center justify-between gap-3 text-emerald-900">
            <div className="flex items-center gap-2.5 text-xs font-bold">
              <span className="text-base">🛡️</span>
              <span>
                User-Side OTP Protection Active: All withdrawal requests in this queue have been verified by the user entering their 6-digit OTP dispatched to their registered sign-up email via Firebase. You can proceed with payouts directly.
              </span>
            </div>
          </div>

          <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3">Pending Requests</h3>
          {withdrawals.filter(w => w.status === 'pending').length === 0 ? (
            <div className="p-8 text-center bg-gray-50 rounded-xl text-gray-500 text-sm mb-8">
              No pending withdrawal requests at the moment.
            </div>
          ) : (
            <div className="space-y-4 mb-8">
              {withdrawals.filter(w => w.status === 'pending').map(w => (
                <div key={w.id} className="border border-gray-200 p-5 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white shadow-sm hover:border-gray-300 transition-colors">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-900 text-base">{w.username}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-600 uppercase">
                        {w.userRole || 'User'}
                      </span>
                      <span className="text-[10px] font-black px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                        <span>✓</span> Email OTP Verified
                      </span>
                    </div>

                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl text-green-600 font-extrabold">₹{w.amount.toLocaleString()}</span>
                      <span className="text-xs text-gray-400">via {w.payoutMethod === 'bank' ? 'Bank Transfer' : 'UPI'}</span>
                    </div>

                    <div className="p-3 bg-gray-50 rounded-lg text-xs space-y-1 text-gray-700">
                      {w.payoutMethod === 'upi' ? (
                        <div><strong>UPI ID:</strong> <span className="font-mono text-indigo-600 font-semibold">{w.upiId || 'Not specified'}</span></div>
                      ) : (
                        <>
                          <div><strong>Account Name:</strong> {w.accountHolderName || w.username}</div>
                          <div><strong>Account Number:</strong> <span className="font-mono">{w.accountNumber || 'N/A'}</span></div>
                          <div><strong>IFSC Code:</strong> <span className="font-mono uppercase">{w.ifsc || 'N/A'}</span></div>
                        </>
                      )}
                    </div>

                    <span className="text-[11px] text-gray-400 block">
                      User ID: {w.userId} {w.userEmail ? `• Email: ${w.userEmail}` : ''} • Requested on {new Date(w.createdAt).toLocaleString()}
                    </span>
                  </div>

                  <div className="flex flex-row md:flex-col gap-2 shrink-0">
                    <button 
                      type="button"
                      onClick={() => {
                        setWithdrawalActionModal({ type: 'approve', withdrawal: w });
                      }} 
                      className="flex-1 text-xs bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-xl font-bold transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span>⚡</span>
                      <span>Approve via Gateway</span>
                    </button>

                    <button 
                      type="button"
                      onClick={() => {
                        setWithdrawalActionReason('Verification needed');
                        setWithdrawalActionModal({ type: 'drown', withdrawal: w });
                      }} 
                      className="flex-1 text-xs bg-purple-600 hover:bg-purple-700 text-white px-4 py-2.5 rounded-xl font-bold transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span>🌊</span>
                      <span>Drown Payment</span>
                    </button>
                    
                    <button 
                      type="button"
                      onClick={() => {
                        setWithdrawalActionReason('Details mismatch');
                        setWithdrawalActionModal({ type: 'reject', withdrawal: w });
                      }} 
                      className="flex-1 md:flex-none text-xs bg-red-50 text-red-600 border border-red-200 px-5 py-2.5 rounded-xl font-bold hover:bg-red-100 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span>↩️</span>
                      <span>Reject & Refund</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3">Processed History</h3>
          {withdrawals.filter(w => w.status !== 'pending').length === 0 ? (
            <p className="text-gray-400 text-xs">No withdrawal history available yet.</p>
          ) : (
            <div className="space-y-3">
              {withdrawals.filter(w => w.status !== 'pending').sort((a,b)=> (b.processedAt || b.createdAt) - (a.processedAt || a.createdAt)).slice(0, 15).map(w => (
                <div key={w.id} className="border border-gray-100 p-4 rounded-xl flex justify-between items-center bg-gray-50/70">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 text-sm">{w.username}</span>
                      <span className="text-xs text-gray-500 font-bold">₹{w.amount.toLocaleString()}</span>
                    </div>
                    <span className="text-[11px] text-gray-400 mt-1 block">
                      {w.payoutMethod === 'upi' ? `UPI: ${w.upiId || 'N/A'}` : `Bank: ${w.accountNumber || 'N/A'}`} • {new Date(w.createdAt).toLocaleDateString()}
                      {w.adminNote ? ` • Note: ${w.adminNote}` : ''}
                    </span>
                  </div>
                  <div>
                    <span className={`px-3 py-1 text-xs rounded-full font-bold ${
                      w.status === 'approved' ? 'bg-green-100 text-green-700' : 
                      w.status === 'drowned' ? 'bg-purple-100 text-purple-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {w.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeTab === 'tickets' ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden p-6">
          <h2 className="text-xl font-bold mb-4">Support Tickets</h2>
          {tickets.filter(t => currentUser.role === 'admin' || (currentUser.role === 'finance' && t.category === 'amount_related') || (currentUser.role === 'support' && t.category !== 'amount_related')).length === 0 ? <p className="text-gray-500">No tickets found for your role.</p> : (
            <div className="space-y-4">
              {tickets.filter(t => currentUser.role === 'admin' || (currentUser.role === 'finance' && t.category === 'amount_related') || (currentUser.role === 'support' && t.category !== 'amount_related')).map(t => (
                <div key={t.id} className="border p-4 rounded-lg flex justify-between items-center">
                  <div>
                    <div className="flex gap-2 items-center mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{t.category ? t.category.replace('_', ' ') : 'General'}</span>
                      <h3 className="font-bold text-gray-900">{t.subject}</h3>
                    </div>
                    <p className="text-sm text-gray-600">{t.description}</p>
                    <span className="text-xs text-gray-400 mt-2 block">User ID: {t.userId} | Created: {new Date(t.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    <span className={`px-2 py-1 text-xs rounded font-bold ${t.status === 'open' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-700'}`}>{t.status.toUpperCase()}</span>
                    {t.status === 'open' && (
                      <button onClick={() => handleUpdateTicket(t.id, 'closed')} className="text-xs bg-gray-900 text-white px-3 py-1 rounded">Close Ticket</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeTab === 'chatting' ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">
              {activeChat ? `Chat with ${activeChat.username}` : chatFilterUser ? 'User Support Chats' : 'Live Support Chats'}
            </h2>
            {(activeChat || chatFilterUser) && (
              <button onClick={() => { activeChat ? setActiveChat(null) : setChatFilterUser(null); }} className="text-gray-500 hover:text-gray-900">
                &larr; Back
              </button>
            )}
          </div>
          {activeChat ? (
            <div className="flex flex-col h-[500px]">
              <div className="flex-1 overflow-y-auto p-4 bg-gray-50 border rounded-t-lg space-y-4 flex flex-col">
                {activeChatMessages.map(m => (
                  <div key={m.id} className={`flex ${m.senderId === currentUser.id ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] p-3 rounded-2xl ${m.senderId === currentUser.id ? 'bg-red-600 text-white rounded-tr-none' : 'bg-gray-200 text-gray-900 rounded-tl-none'}`}>
                      <div className="text-xs opacity-75 mb-1">{m.senderRole}</div>
                      <p className="text-sm">{m.text}</p>
                    </div>
                  </div>
                ))}
              </div>
              {activeChat.status !== 'closed' ? (
                <form onSubmit={(e) => {
                  e.preventDefault();
                  if (!chatInput.trim()) return;
                  addDoc(collection(db, 'support_chats', activeChat.id, 'messages'), {
                    chatId: activeChat.id,
                    senderId: currentUser.id,
                    senderRole: currentUser.role || 'admin',
                    text: chatInput,
                    timestamp: Date.now()
                  });
                  updateDoc(doc(db, 'support_chats', activeChat.id), {
                    updatedAt: Date.now(),
                    unreadCountUser: (activeChat.unreadCountUser || 0) + 1,
                    unreadCountAdmin: 0
                  });
                  setChatInput('');
                }} className="flex gap-2 p-4 border border-t-0 rounded-b-lg">
                  <input value={chatInput} onChange={e => setChatInput(e.target.value)} type="text" placeholder="Type message..." className="flex-1 border rounded-lg px-4 py-2" />
                  <button type="submit" className="bg-red-600 text-white px-6 py-2 rounded-lg font-bold">Send</button>
                </form>
              ) : (
                <div className="p-4 border border-t-0 rounded-b-lg bg-gray-100 text-center text-gray-500">This chat is closed.</div>
              )}
            </div>
          ) : (
            supportChats.filter(c => chatFilterUser ? c.userId === chatFilterUser : true).length === 0 ? <p className="text-gray-500">No support chats found.</p> : (
              <div className="space-y-4">
                {supportChats.filter(c => chatFilterUser ? c.userId === chatFilterUser : true).map(c => (
                  <div key={c.id} className="border p-4 rounded-lg flex justify-between items-center cursor-pointer hover:bg-gray-50" onClick={() => {
                    setActiveChat(c);
                    if (c.unreadCountAdmin > 0) {
                      updateDoc(doc(db, 'support_chats', c.id), { unreadCountAdmin: 0 });
                    }
                  }}>
                    <div>
                      <div className="flex gap-2 items-center mb-1">
                        <h3 className="font-bold text-gray-900">{c.username}</h3>
                        {c.unreadCountAdmin > 0 && <span className="w-2 h-2 bg-red-600 rounded-full"></span>}
                      </div>
                      <span className="text-xs text-gray-400 mt-2 block">User ID: {c.userId} | Last Updated: {new Date(c.updatedAt).toLocaleTimeString()}</span>
                    </div>
                    <div className="flex flex-col gap-2 items-end">
                      <span className={`px-2 py-1 text-xs rounded font-bold ${c.status === 'open' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>{c.status.toUpperCase()}</span>
                      {c.status !== 'closed' && <button onClick={(e) => { e.stopPropagation(); updateDoc(doc(db, 'support_chats', c.id), { status: 'closed' }); }} className="text-xs text-red-600 hover:underline">Close Chat</button>}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      ) : activeTab === 'appeals' ? (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-200/80 overflow-hidden p-6 space-y-6">
          {/* Header & Stats */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-gray-100 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-2xl bg-rose-50 text-rose-700 flex items-center justify-center font-black text-lg">
                  ⚖️
                </span>
                <div>
                  <h2 className="text-xl font-black text-gray-900 tracking-tight">User Appeals & Deletion Requests</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Review and process account deletion appeals submitted via 24/7 AI Support, account suspension reviews, and KYC appeals.
                  </p>
                </div>
              </div>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setAppealFilterType('all')}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs transition cursor-pointer ${
                  appealFilterType === 'all' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                All ({appeals.length})
              </button>

              <button
                type="button"
                onClick={() => setAppealFilterType('account_deletion')}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs transition flex items-center gap-1 cursor-pointer ${
                  appealFilterType === 'account_deletion'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                }`}
              >
                <span>🗑️</span>
                <span>Account Deletion ({appeals.filter(a => a.type === 'account_deletion').length})</span>
                {appeals.filter(a => a.type === 'account_deletion' && a.status === 'pending').length > 0 && (
                  <span className="bg-white text-rose-700 text-[10px] font-black px-1.5 py-0.2 rounded-full">
                    {appeals.filter(a => a.type === 'account_deletion' && a.status === 'pending').length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setAppealFilterType('suspension')}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs transition flex items-center gap-1 cursor-pointer ${
                  appealFilterType === 'suspension'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                }`}
              >
                <span>⚠️</span>
                <span>Suspension ({appeals.filter(a => a.type === 'suspension').length})</span>
              </button>

              <button
                type="button"
                onClick={() => setAppealFilterType('verification')}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs transition flex items-center gap-1 cursor-pointer ${
                  appealFilterType === 'verification'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100'
                }`}
              >
                <span>🪪</span>
                <span>Verification ({appeals.filter(a => a.type === 'verification').length})</span>
              </button>
            </div>
          </div>

          {/* Appeals List */}
          {appeals.filter(a => appealFilterType === 'all' || a.type === appealFilterType).length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
              <span className="text-3xl block mb-2">📭</span>
              <p className="text-sm font-bold text-gray-700">No appeals found matching the selected filter.</p>
              <p className="text-xs text-gray-400 mt-1">When users request account deletion or submit appeals through AI Support, they will appear here in real time.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {appeals
                .filter(a => appealFilterType === 'all' || a.type === appealFilterType)
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                .map(a => {
                  const targetUser = users.find(u => u.id === a.userId || (u.email && a.email && u.email.toLowerCase() === a.email.toLowerCase()));
                  const isAccountDeletion = a.type === 'account_deletion';
                  const isPending = a.status === 'pending';
                  const isDeleted = a.status === 'deleted';

                  return (
                    <div
                      key={a.id}
                      className={`rounded-2xl p-5 border transition-all ${
                        isAccountDeletion
                          ? isPending
                            ? 'bg-rose-50/40 border-rose-200 hover:border-rose-300'
                            : 'bg-gray-50 border-gray-200 opacity-80'
                          : 'bg-white border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {/* Top Header Row */}
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 pb-3 border-b border-gray-200/60">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
                            isAccountDeletion
                              ? 'bg-rose-600 text-white border-rose-700'
                              : a.type === 'verification'
                              ? 'bg-indigo-600 text-white border-indigo-700'
                              : 'bg-amber-600 text-white border-amber-700'
                          }`}>
                            {isAccountDeletion ? '🗑️ Account Deletion Request' : a.type === 'verification' ? '🪪 Verification Appeal' : '⚠️ Suspension Appeal'}
                          </span>

                          <span className="text-[11px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <span>🤖</span>
                            <span>Source: {a.source === 'ai_support_agent' ? 'AI Support & Solver' : (a.source || 'Direct User')}</span>
                          </span>

                          <span className="text-xs text-gray-400 font-mono">
                            #{a.id.slice(0, 10)}
                          </span>
                        </div>

                        {/* Status Chip */}
                        <div className="flex items-center gap-2">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-black uppercase tracking-wider border ${
                            isPending
                              ? 'bg-amber-100 text-amber-800 border-amber-300 animate-pulse'
                              : isDeleted
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                              : a.status === 'resolved'
                              ? 'bg-green-100 text-green-800 border-green-300'
                              : 'bg-rose-100 text-rose-800 border-rose-300'
                          }`}>
                            {isDeleted ? '✓ Account Deleted' : a.status.toUpperCase()}
                          </span>
                        </div>
                      </div>

                      {/* Main Info Body */}
                      <div className="py-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                        {/* Column 1: User Identity */}
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">User Account Details</span>
                          <div className="flex items-center gap-2.5">
                            <div className="w-10 h-10 rounded-full bg-gray-200 text-gray-700 font-black flex items-center justify-center text-sm">
                              {a.username ? a.username.slice(0, 2).toUpperCase() : '👤'}
                            </div>
                            <div>
                              <span className="font-extrabold text-sm text-gray-900 block">
                                @{a.username || 'Member'}
                              </span>
                              <span className="text-xs text-gray-500 block truncate max-w-[220px]">
                                ✉️ {a.email || 'No email provided'}
                              </span>
                              <span className="text-[11px] text-gray-400 font-mono block">
                                ID: {a.userId}
                              </span>
                            </div>
                          </div>

                          {targetUser ? (
                            <div className="mt-2 text-xs bg-white p-2.5 rounded-xl border border-gray-100 space-y-1">
                              <div className="flex justify-between text-gray-600">
                                <span>Wallet Balance:</span>
                                <strong className="text-emerald-700 font-bold">₹{(targetUser.deposits || 0).toLocaleString()}</strong>
                              </div>
                              <div className="flex justify-between text-gray-600">
                                <span>Role:</span>
                                <strong className="capitalize">{targetUser.role || 'user'}</strong>
                              </div>
                              <div className="flex justify-between text-gray-600">
                                <span>Live Listings:</span>
                                <strong>{vehiclesCount[targetUser.id] || 0}</strong>
                              </div>
                            </div>
                          ) : (
                            <p className="text-[11px] text-gray-400 italic">User document not currently in active table.</p>
                          )}
                        </div>

                        {/* Column 2: Deletion Reason Stated */}
                        <div className="md:col-span-2 space-y-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 block flex items-center gap-1">
                            <span>💬</span>
                            <span>{isAccountDeletion ? 'Stated Reason for Account Deletion' : 'Appeal Explanation'}</span>
                          </span>

                          <div className="bg-white p-3.5 rounded-xl border border-gray-200 text-xs sm:text-sm text-gray-800 leading-relaxed font-medium whitespace-pre-wrap shadow-2xs">
                            "{a.reason}"
                          </div>

                          {a.type === 'verification' && (
                            <div className="text-xs text-gray-600 bg-white p-2.5 rounded-xl border border-gray-200 space-y-0.5">
                              <p><strong>Phone:</strong> {a.phone || 'N/A'}</p>
                              <p><strong>Submitted Documents:</strong> {a.documents || 'PAN/National ID'}</p>
                            </div>
                          )}

                          <div className="text-[11px] text-gray-400 flex items-center gap-3">
                            <span>Submitted: {new Date(a.createdAt).toLocaleString()}</span>
                            {a.reviewedBy && (
                              <span>• Reviewed by: <strong>{a.reviewedBy}</strong></span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Bottom Actions Row */}
                      {isPending && (
                        <div className="pt-3 border-t border-gray-200/60 flex items-center justify-end gap-2.5 flex-wrap">
                          {isAccountDeletion ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleDeleteUserFromAppeal(a)}
                                className="px-4 py-2 bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-700 hover:to-red-800 text-white font-extrabold text-xs rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5"
                              >
                                <span>🗑️</span>
                                <span>Permanently Delete User Account</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleUpdateAppeal(a.id, 'rejected')}
                                className="px-3.5 py-2 bg-white hover:bg-gray-100 text-gray-700 font-bold text-xs rounded-xl border border-gray-200 transition cursor-pointer"
                              >
                                ✕ Reject Appeal
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => handleUpdateAppeal(a.id, 'resolved', a.type === 'verification', a.userId)}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer"
                              >
                                {a.type === 'verification' ? '✓ Approve Verification' : '✓ Mark Resolved'}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleUpdateAppeal(a.id, 'rejected')}
                                className="px-3.5 py-2 bg-white hover:bg-gray-100 text-gray-700 font-bold text-xs rounded-xl border border-gray-200 transition cursor-pointer"
                              >
                                ✕ Reject Appeal
                              </button>
                            </>
                          )}
                        </div>
                      )}

                      {isDeleted && (
                        <div className="pt-2 text-xs font-bold text-emerald-800 bg-emerald-50/70 p-2 rounded-xl border border-emerald-200 flex items-center gap-2">
                          <span>✓</span>
                          <span>Account was permanently deleted by {a.reviewedBy || 'Admin'}.</span>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      ) : activeTab === 'verifications' ? (
        <div className="space-y-6">
          {/* Action Feedback Banner */}
          {actionFeedback && (
            <div className={`p-4 rounded-2xl flex items-center justify-between border shadow-sm animate-fade-in ${
              actionFeedback.type === 'success' 
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                : 'bg-red-50 border-red-200 text-red-800'
            }`}>
              <div className="flex items-center gap-2.5 font-bold text-sm">
                <span>{actionFeedback.type === 'success' ? '✓' : '⚠️'}</span>
                <span>{actionFeedback.message}</span>
              </div>
              <button 
                onClick={() => setActionFeedback(null)} 
                className="text-xs font-bold px-2 py-1 hover:bg-black/5 rounded-lg transition"
              >
                ✕
              </button>
            </div>
          )}

          {/* Header & Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center">
              <span className="text-gray-500 font-medium text-xs">Total Requests</span>
              <span className="text-3xl font-black text-gray-900 mt-1">{verifications.length}</span>
              <span className="text-[11px] text-gray-400 mt-1">All time KYC submissions</span>
            </div>

            <div className="bg-white p-5 rounded-2xl shadow-sm border border-amber-100 flex flex-col items-center justify-center relative overflow-hidden">
              <div className="absolute top-0 right-0 w-12 h-12 bg-amber-500/10 rounded-bl-full pointer-events-none"></div>
              <span className="text-amber-600 font-bold text-xs uppercase tracking-wider">Pending Review</span>
              <span className="text-3xl font-black text-amber-600 mt-1">
                {verifications.filter(v => v.status === 'pending').length}
              </span>
              <span className="text-[11px] text-amber-700/70 mt-1">Awaiting staff action</span>
            </div>

            <div className="bg-white p-5 rounded-2xl shadow-sm border border-emerald-100 flex flex-col items-center justify-center">
              <span className="text-emerald-600 font-bold text-xs uppercase tracking-wider">Approved & Verified</span>
              <span className="text-3xl font-black text-emerald-600 mt-1">
                {verifications.filter(v => v.status === 'verified').length}
              </span>
              <span className="text-[11px] text-emerald-700/70 mt-1">Full auction privileges active</span>
            </div>

            <div className="bg-white p-5 rounded-2xl shadow-sm border border-red-100 flex flex-col items-center justify-center">
              <span className="text-red-600 font-bold text-xs uppercase tracking-wider">Rejected Submissions</span>
              <span className="text-3xl font-black text-red-600 mt-1">
                {verifications.filter(v => v.status === 'rejected').length}
              </span>
              <span className="text-[11px] text-red-700/70 mt-1">Requires user re-submission</span>
            </div>
          </div>

          {/* Controls Bar */}
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col md:flex-row items-center justify-between gap-4">
            {/* Filter Tabs */}
            <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
              <button
                onClick={() => setVerificationFilter('all')}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs transition ${
                  verificationFilter === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                All ({verifications.length})
              </button>
              <button
                onClick={() => setVerificationFilter('pending')}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs transition flex items-center gap-1.5 ${
                  verificationFilter === 'pending' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                }`}
              >
                <span>Pending Review</span>
                <span className="bg-white/20 px-1.5 py-0.2 rounded-full text-[10px]">
                  {verifications.filter(v => v.status === 'pending').length}
                </span>
              </button>
              <button
                onClick={() => setVerificationFilter('verified')}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs transition ${
                  verificationFilter === 'verified' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                Verified ({verifications.filter(v => v.status === 'verified').length})
              </button>
              <button
                onClick={() => setVerificationFilter('rejected')}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs transition ${
                  verificationFilter === 'rejected' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100'
                }`}
              >
                Rejected ({verifications.filter(v => v.status === 'rejected').length})
              </button>
            </div>

            {/* Search Box */}
            <div className="w-full md:w-72">
              <input
                type="text"
                value={verificationSearchQuery}
                onChange={(e) => setVerificationSearchQuery(e.target.value)}
                placeholder="Search name, username, PAN, ID..."
                className="w-full px-3.5 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>

          {/* Verifications List */}
          {verifications
            .filter(v => {
              if (verificationFilter !== 'all' && v.status !== verificationFilter) return false;
              if (!verificationSearchQuery.trim()) return true;
              const q = verificationSearchQuery.toLowerCase();
              return (
                (v.username || '').toLowerCase().includes(q) ||
                (v.userFullName || '').toLowerCase().includes(q) ||
                (v.userEmail || '').toLowerCase().includes(q) ||
                (v.phoneNumber || '').toLowerCase().includes(q) ||
                (v.panNumber || '').toLowerCase().includes(q) ||
                (v.nationalIdNumber || '').toLowerCase().includes(q)
              );
            })
            .length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
              <span className="text-4xl block mb-2">🛡️</span>
              <h3 className="text-lg font-bold text-gray-800">No Verification Requests Found</h3>
              <p className="text-sm text-gray-500 mt-1">
                {verificationFilter === 'pending'
                  ? 'All verification requests have been processed! No pending items in queue.'
                  : 'No verification records match your current filter.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {verifications
                .filter(v => {
                  if (verificationFilter !== 'all' && v.status !== verificationFilter) return false;
                  if (!verificationSearchQuery.trim()) return true;
                  const q = verificationSearchQuery.toLowerCase();
                  return (
                    (v.username || '').toLowerCase().includes(q) ||
                    (v.userFullName || '').toLowerCase().includes(q) ||
                    (v.userEmail || '').toLowerCase().includes(q) ||
                    (v.phoneNumber || '').toLowerCase().includes(q) ||
                    (v.panNumber || '').toLowerCase().includes(q) ||
                    (v.nationalIdNumber || '').toLowerCase().includes(q)
                  );
                })
                .map((req) => (
                  <div
                    key={req.id}
                    className="bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-gray-200 transition p-6"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                      
                      {/* Left: User & Identity Data */}
                      <div className="flex-1 space-y-4">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center font-bold text-gray-700 text-lg shadow-sm">
                            {req.username?.charAt(0).toUpperCase() || 'U'}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-extrabold text-gray-900 text-base">{req.userFullName || req.username}</h3>
                              <span className="text-xs text-gray-400 font-normal">(@{req.username})</span>
                              {req.status === 'verified' && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                  <span>🛡️</span> Verified
                                </span>
                              )}
                              {req.status === 'pending' && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 animate-pulse">
                                  <span>⏳</span> Pending Review
                                </span>
                              )}
                              {req.status === 'rejected' && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
                                  <span>✕</span> Rejected
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-3">
                              <span>User ID: <span className="font-mono text-gray-700">{req.userId}</span></span>
                              {req.userEmail && <span>Email: <span className="text-gray-700">{req.userEmail}</span></span>}
                              {req.phoneNumber && (
                                <span className="flex items-center gap-1 font-semibold text-gray-800">
                                  <span>📱</span> Mobile: <span className="font-mono text-gray-900 font-bold">{req.phoneNumber}</span>
                                  {req.phoneVerified && <span className="text-emerald-600 text-[10px] font-bold">✓ OTP Verified</span>}
                                </span>
                              )}
                              <span>Submitted: <span className="text-gray-700">{new Date(req.submittedAt).toLocaleString()}</span></span>
                            </div>
                          </div>
                        </div>

                        {/* ID Document Details Cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                          {/* PAN Card Data if present */}
                          {(req.documentType === 'pan_card' || req.documentType === 'both' || req.panNumber) && (
                            <div className="p-3.5 bg-red-50/60 rounded-xl border border-red-100 text-xs">
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-bold text-gray-800 flex items-center gap-1.5">
                                  <span>💳</span> PAN Card
                                </span>
                                <span className="text-[10px] font-mono font-bold bg-white text-red-700 px-2 py-0.5 rounded border border-red-200">
                                  {req.panNumber || 'N/A'}
                                </span>
                              </div>
                              <p className="text-gray-600 mt-1">Name on PAN: <strong className="text-gray-900">{req.panCardName || req.userFullName || 'N/A'}</strong></p>
                              {req.dob && <p className="text-gray-600">DOB: <strong className="text-gray-900">{req.dob}</strong></p>}
                            </div>
                          )}

                          {/* National ID Data if present */}
                          {(req.documentType === 'national_id' || req.documentType === 'both' || req.nationalIdNumber) && (
                            <div className="p-3.5 bg-indigo-50/60 rounded-xl border border-indigo-100 text-xs">
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-bold text-gray-800 flex items-center gap-1.5">
                                  <span>🪪</span> {req.nationalIdType || 'National ID Card'}
                                </span>
                                <span className="text-[10px] font-mono font-bold bg-white text-indigo-700 px-2 py-0.5 rounded border border-indigo-200">
                                  {req.nationalIdNumber || 'N/A'}
                                </span>
                              </div>
                              <p className="text-gray-600 mt-1">Name on ID: <strong className="text-gray-900">{req.nationalIdName || req.userFullName || 'N/A'}</strong></p>
                              {req.dob && <p className="text-gray-600">DOB: <strong className="text-gray-900">{req.dob}</strong></p>}
                            </div>
                          )}
                        </div>

                        {/* AI Pre-Validation Status */}
                        {req.aiNotes && (
                          <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs flex items-start gap-2">
                            <span className="text-base mt-0.5">🤖</span>
                            <div>
                              <span className="font-bold text-gray-800">AI Pre-Scan Assessment: </span>
                              <span className="text-gray-600">{req.aiNotes}</span>
                              {req.aiConfidence && (
                                <span className="ml-2 font-bold text-emerald-600">({req.aiConfidence}% match score)</span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Review Notes / Rejection Reason */}
                        {req.reviewNote && (
                          <p className="text-xs text-gray-500 italic">Staff Note: {req.reviewNote}</p>
                        )}
                        {req.rejectionReason && (
                          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                            <strong>Rejection Reason:</strong> {req.rejectionReason}
                          </div>
                        )}
                      </div>

                      {/* Middle: Document Image Previews with Zoom */}
                      <div className="flex flex-wrap lg:flex-nowrap gap-3 items-center">
                        {req.panCardPhotoUrl && (
                          <div className="text-center">
                            <span className="block text-[10px] font-bold text-gray-500 mb-1">PAN CARD PHOTO</span>
                            <div 
                              onClick={() => setPreviewImage(req.panCardPhotoUrl || null)}
                              className="relative w-28 h-20 bg-gray-100 border border-gray-200 rounded-xl overflow-hidden cursor-zoom-in group shadow-sm hover:ring-2 hover:ring-red-400 transition"
                            >
                              <img src={req.panCardPhotoUrl} alt="PAN Card" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-bold">
                                🔍 Click to Zoom
                              </div>
                            </div>
                          </div>
                        )}

                        {req.nationalIdPhotoUrl && (
                          <div className="text-center">
                            <span className="block text-[10px] font-bold text-gray-500 mb-1">ID FRONT</span>
                            <div 
                              onClick={() => setPreviewImage(req.nationalIdPhotoUrl || null)}
                              className="relative w-28 h-20 bg-gray-100 border border-gray-200 rounded-xl overflow-hidden cursor-zoom-in group shadow-sm hover:ring-2 hover:ring-indigo-400 transition"
                            >
                              <img src={req.nationalIdPhotoUrl} alt="ID Front" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-bold">
                                🔍 Click to Zoom
                              </div>
                            </div>
                          </div>
                        )}

                        {req.nationalIdBackPhotoUrl && (
                          <div className="text-center">
                            <span className="block text-[10px] font-bold text-gray-500 mb-1">ID BACK</span>
                            <div 
                              onClick={() => setPreviewImage(req.nationalIdBackPhotoUrl || null)}
                              className="relative w-28 h-20 bg-gray-100 border border-gray-200 rounded-xl overflow-hidden cursor-zoom-in group shadow-sm hover:ring-2 hover:ring-indigo-400 transition"
                            >
                              <img src={req.nationalIdBackPhotoUrl} alt="ID Back" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-bold">
                                🔍 Click to Zoom
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Right: Staff Action Buttons */}
                      <div className="flex flex-row lg:flex-col gap-2 justify-end lg:w-44 pt-2 lg:pt-0 border-t lg:border-t-0 border-gray-100">
                        {req.status === 'pending' ? (
                          <>
                            <button
                              onClick={() => handleApproveVerification(req)}
                              className="flex-1 lg:flex-none py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition shadow-md flex items-center justify-center gap-1.5"
                            >
                              <span>✓</span>
                              <span>Approve & Verify</span>
                            </button>
                            <button
                              onClick={() => handleRejectVerification(req)}
                              className="flex-1 lg:flex-none py-2.5 px-4 bg-red-50 hover:bg-red-100 text-red-700 font-bold rounded-xl text-xs transition border border-red-200 flex items-center justify-center gap-1.5"
                            >
                              <span>✕</span>
                              <span>Reject Request</span>
                            </button>
                          </>
                        ) : req.status === 'verified' ? (
                          <div className="space-y-2 text-center lg:text-right">
                            <div className="text-xs text-emerald-700 font-bold bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                              ✓ Verified by {req.reviewedBy || 'Admin'}
                            </div>
                            {currentUser.role === 'admin' && (
                              <button
                                onClick={() => handleRevokeVerification(req.userId, req.username)}
                                className="w-full py-1.5 px-3 bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-600 text-xs font-semibold rounded-lg transition"
                              >
                                Revoke Verification
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-2 text-center lg:text-right">
                            <div className="text-xs text-red-700 font-bold bg-red-50 px-3 py-1.5 rounded-lg border border-red-200">
                              ✕ Rejected
                            </div>
                            <button
                              onClick={() => handleApproveVerification(req)}
                              className="w-full py-1.5 px-3 bg-gray-100 hover:bg-emerald-50 text-gray-700 hover:text-emerald-700 text-xs font-semibold rounded-lg transition"
                            >
                              Re-evaluate & Approve
                            </button>
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      ) : activeTab === 'content' ? (
        <AdminContentCMS currentUser={currentUser} />
      ) : activeTab === 'notifications' ? (
        <AdminNotifications currentUser={currentUser} users={users} />
      ) : activeTab === 'reports' ? (
        <AdminReports 
          currentUser={currentUser}
          users={users}
          vehicles={allVehicles}
          transactions={allTransactions}
          withdrawals={withdrawals}
        />
      ) : activeTab === 'audit' ? (
        <AdminAuditLogs />
      ) : activeTab === 'config' ? (
        <AdminAppConfig currentUser={currentUser} />
      ) : activeTab === 'coupons' ? (
        <AdminCoupons currentUser={currentUser} />
      ) : activeTab === 'vendors' ? (
        <AdminVendors currentUser={currentUser} users={users} />
      ) : activeTab === 'moderation' ? (
        <AdminModeration currentUser={currentUser} vehicles={allVehicles} />
      ) : activeTab === 'sessions' ? (
        <AdminSessions
          currentUser={currentUser}
          users={users}
          onOpenAiBrainWithQuery={(q) => {
            setAiBrainInitialQuery(q);
            setActiveTab('ai_brain');
          }}
        />
      ) : activeTab === 'version' ? (
        <AdminVersionControl currentUser={currentUser} />
      ) : activeTab === 'cookies' ? (
        <AdminCookiesCMS currentUser={currentUser} />
      ) : activeTab === 'ai_monitor' ? (
        <AdminAiMonitor currentUser={currentUser} />
      ) : activeTab === 'ai_brain' ? (
        <AdminAiBrain
          currentUser={currentUser}
          allVehicles={allVehicles}
          users={users}
          initialQuery={aiBrainInitialQuery}
        />
      ) : null}

      {/* In-App Verification Action Modal (Approval / Rejection / Revoke) */}
      {verifActionModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => !isProcessingVerif && setVerifActionModal(null)}
        >
          <div 
            className="relative w-full max-w-lg bg-white rounded-3xl p-6 sm:p-7 shadow-2xl overflow-hidden border border-gray-100 animate-scale-up" 
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center text-xl shadow-sm ${
                  verifActionModal.type === 'approve'
                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                    : verifActionModal.type === 'reject'
                    ? 'bg-red-50 text-red-600 border border-red-200'
                    : 'bg-amber-50 text-amber-600 border border-amber-200'
                }`}>
                  {verifActionModal.type === 'approve' ? '🛡️' : verifActionModal.type === 'reject' ? '✕' : '⚠️'}
                </div>
                <div>
                  <h3 className="font-extrabold text-gray-900 text-base sm:text-lg">
                    {verifActionModal.type === 'approve' 
                      ? 'Approve Identity Verification' 
                      : verifActionModal.type === 'reject' 
                      ? 'Reject Verification Request' 
                      : 'Revoke User Verification'}
                  </h3>
                  <p className="text-xs text-gray-500">
                    User: <strong className="text-gray-900">@{verifActionModal.username || verifActionModal.req?.username}</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => !isProcessingVerif && setVerifActionModal(null)}
                disabled={isProcessingVerif}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center font-bold text-sm transition"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="py-5 space-y-4">
              {verifActionModal.type === 'approve' && (
                <div className="space-y-3.5">
                  <div className="p-4 bg-emerald-50/70 border border-emerald-100 rounded-2xl text-xs text-emerald-900 space-y-2">
                    <p className="font-semibold text-sm text-emerald-800 flex items-center gap-1.5">
                      <span>✓</span> Ready to Grant Verified Status
                    </p>
                    <p className="leading-relaxed">
                      Approving this request will immediately mark <strong>@{verifActionModal.username}</strong> as officially verified. The user will receive full platform privileges including:
                    </p>
                    <ul className="list-disc list-inside space-y-1 pl-1 text-[11px] text-emerald-800">
                      <li>Placing live and auction bids without KYC limits</li>
                      <li>Listing vehicles for auction and direct sale</li>
                      <li>Verified badge (🛡️) shown on their profile and bids</li>
                    </ul>
                  </div>

                  {verifActionModal.req && (
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Document Type:</span>
                        <span className="font-bold text-gray-800 uppercase">{verifActionModal.req.documentType}</span>
                      </div>
                      {verifActionModal.req.panNumber && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">PAN Number:</span>
                          <span className="font-mono font-bold text-gray-900">{verifActionModal.req.panNumber}</span>
                        </div>
                      )}
                      {verifActionModal.req.nationalIdNumber && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">National ID ({verifActionModal.req.nationalIdType || 'ID'}):</span>
                          <span className="font-mono font-bold text-gray-900">{verifActionModal.req.nationalIdNumber}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {verifActionModal.type === 'reject' && (
                <div className="space-y-3.5">
                  <p className="text-xs text-gray-600 leading-relaxed">
                    Select a preset reason or enter custom feedback. This explanation will be sent directly to the user so they can correct their submission.
                  </p>

                  {/* Preset reason chips */}
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                      Quick Preset Reasons:
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        'Document photo was blurry or unreadable',
                        'Name does not match identity card',
                        'Invalid PAN or National ID number',
                        'Both front and back photos required',
                        'Document appears expired or altered'
                      ].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setRejectReason(preset)}
                          className={`text-[11px] px-2.5 py-1 rounded-lg border transition text-left font-medium ${
                            rejectReason === preset
                              ? 'bg-red-500 text-white border-red-500'
                              : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200'
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom reason textarea */}
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                      Rejection Reason / Notes to User:
                    </label>
                    <textarea
                      rows={3}
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Explain why the verification could not be approved..."
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                </div>
              )}

              {verifActionModal.type === 'revoke' && (
                <div className="space-y-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900">
                  <p className="font-bold text-sm text-amber-800">
                    Are you sure you want to revoke verification?
                  </p>
                  <p className="leading-relaxed">
                    User <strong>@{verifActionModal.username}</strong> will lose verified status. Their bidding and vehicle listing access will be paused until they submit a new verification document and receive approval.
                  </p>
                </div>
              )}
            </div>

            {/* Footer Action Buttons */}
            <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setVerifActionModal(null)}
                disabled={isProcessingVerif}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-extrabold rounded-xl text-xs sm:text-sm transition active:scale-98 disabled:opacity-50"
              >
                Cancel
              </button>
              
              {verifActionModal.type === 'approve' && (
                <button
                  type="button"
                  onClick={() => verifActionModal.req && executeApproveVerification(verifActionModal.req)}
                  disabled={isProcessingVerif}
                  className="flex-[1.4] py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs sm:text-sm transition shadow-md hover:shadow-lg active:scale-98 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isProcessingVerif ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Approving...</span>
                    </>
                  ) : (
                    <>
                      <span>✓</span>
                      <span>Confirm & Approve</span>
                    </>
                  )}
                </button>
              )}

              {verifActionModal.type === 'reject' && (
                <button
                  type="button"
                  onClick={() => verifActionModal.req && executeRejectVerification(verifActionModal.req, rejectReason)}
                  disabled={isProcessingVerif || !rejectReason.trim()}
                  className="flex-[1.4] py-3 bg-red-600 hover:bg-red-700 text-white font-extrabold rounded-xl text-xs sm:text-sm transition shadow-md hover:shadow-lg active:scale-98 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isProcessingVerif ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Rejecting...</span>
                    </>
                  ) : (
                    <>
                      <span>✕</span>
                      <span>Confirm Rejection</span>
                    </>
                  )}
                </button>
              )}

              {verifActionModal.type === 'revoke' && (
                <button
                  type="button"
                  onClick={() => verifActionModal.userId && executeRevokeVerification(verifActionModal.userId, verifActionModal.username || 'User')}
                  disabled={isProcessingVerif}
                  className="flex-[1.4] py-3 bg-gray-900 hover:bg-black text-white font-extrabold rounded-xl text-xs sm:text-sm transition shadow-md hover:shadow-lg active:scale-98 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isProcessingVerif ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Revoking...</span>
                    </>
                  ) : (
                    <span>Confirm Revocation</span>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Image Zoom / Lightbox Modal */}
      {previewImage && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-white rounded-3xl p-4 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-4 right-4 z-10 w-9 h-9 bg-black/60 hover:bg-black text-white rounded-full flex items-center justify-center font-bold text-sm transition"
            >
              ✕
            </button>
            <div className="overflow-auto max-h-[80vh] flex items-center justify-center p-2 bg-gray-900 rounded-2xl">
              <img src={previewImage} alt="Document High-Res Preview" className="max-w-full max-h-full object-contain rounded-xl" />
            </div>
            <div className="mt-3 flex justify-between items-center text-xs text-gray-500 px-2">
              <span>AutoBid Identity Verification Document Inspector</span>
              <button 
                onClick={() => setPreviewImage(null)} 
                className="px-4 py-1.5 bg-gray-900 text-white font-bold rounded-lg hover:bg-black transition"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vehicle Moderation Action Modal (In-App, No window.confirm/prompt) */}
      {vehicleActionModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in"
          onClick={() => !isProcessingVehicleAction && setVehicleActionModal(null)}
        >
          <div 
            className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl border border-gray-100 flex flex-col max-h-[90vh]"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`p-4 sm:p-5 border-b flex items-center justify-between ${
              vehicleActionModal.type === 'delete' ? 'bg-red-50/80 border-red-100' :
              vehicleActionModal.type === 'restrict' ? 'bg-amber-50/80 border-amber-100' :
              vehicleActionModal.type === 'shadow_ban' ? 'bg-purple-50/80 border-purple-100' :
              'bg-gray-50 border-gray-100'
            }`}>
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">
                  {vehicleActionModal.type === 'delete' && '🗑️'}
                  {vehicleActionModal.type === 'restrict' && '⚠️'}
                  {vehicleActionModal.type === 'shadow_ban' && '👻'}
                  {vehicleActionModal.type === 'reject' && '✕'}
                  {vehicleActionModal.type === 'edit_reserve' && '🏷️'}
                </span>
                <div>
                  <h3 className="text-sm sm:text-base font-black text-gray-900">
                    {vehicleActionModal.type === 'delete' && 'Permanently Delete Vehicle Listing'}
                    {vehicleActionModal.type === 'restrict' && (vehicleActionModal.vehicle.isRestricted ? 'Remove Vehicle Restriction' : 'Restrict Vehicle Listing')}
                    {vehicleActionModal.type === 'shadow_ban' && (vehicleActionModal.vehicle.isShadowBanned ? 'Remove Shadow Ban' : 'Shadow Ban Vehicle Listing')}
                    {vehicleActionModal.type === 'reject' && 'Reject Vehicle Listing'}
                    {vehicleActionModal.type === 'edit_reserve' && 'Update Reserve / Starting Price'}
                  </h3>
                  <p className="text-[11px] text-gray-500 font-medium">
                    {vehicleActionModal.vehicle.year} {vehicleActionModal.vehicle.make} {vehicleActionModal.vehicle.model} (Lot #{vehicleActionModal.vehicle.id.slice(-6)})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isProcessingVehicleAction && setVehicleActionModal(null)}
                className="w-8 h-8 rounded-full hover:bg-black/5 flex items-center justify-center text-gray-500 hover:text-gray-900 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Content Body */}
            <div className="p-5 space-y-4 text-xs">
              {vehicleActionModal.type === 'delete' && (
                <div className="space-y-3">
                  <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-900 leading-relaxed">
                    <p className="font-bold text-red-950">⚠️ Warning: Irreversible Action</p>
                    <p className="text-[11px] text-red-800 mt-1">
                      Are you sure you want to permanently delete this listing? It will be removed immediately from public feeds, stock warehouse tracking, and search.
                    </p>
                  </div>
                </div>
              )}

              {vehicleActionModal.type === 'restrict' && (
                <div className="space-y-3">
                  <p className="text-gray-600 leading-relaxed">
                    {vehicleActionModal.vehicle.isRestricted 
                      ? 'Removing the restriction will unlock bidding and direct purchases on this listing immediately.'
                      : 'Restricting a listing keeps it visible but freezes all bidding, pre-stakes, and direct buy transactions.'}
                  </p>
                  {!vehicleActionModal.vehicle.isRestricted && (
                    <div>
                      <label className="block font-bold text-gray-800 mb-1">
                        Administrative Reason for Restriction:
                      </label>
                      <input
                        type="text"
                        value={vehicleActionReason}
                        onChange={e => setVehicleActionReason(e.target.value)}
                        placeholder="e.g. Document verification required, pending inspection"
                        className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  )}
                </div>
              )}

              {vehicleActionModal.type === 'shadow_ban' && (
                <div className="space-y-3">
                  <div className="p-3.5 bg-purple-50 border border-purple-200 rounded-xl text-purple-900 leading-relaxed">
                    <p className="font-bold text-purple-950">👻 Ghost / Shadow Ban Mechanism</p>
                    <p className="text-[11px] text-purple-800 mt-1">
                      {vehicleActionModal.vehicle.isShadowBanned
                        ? 'This listing is currently hidden from public discovery. Removing the shadow ban will restore its visibility across search and feeds.'
                        : 'Shadow-banning completely hides this listing from public search and home feeds for all buyers, while keeping it visible normally to the seller so they do not realize moderation was applied.'}
                    </p>
                  </div>
                </div>
              )}

              {vehicleActionModal.type === 'reject' && (
                <div className="space-y-3">
                  <label className="block font-bold text-gray-800 mb-1">
                    Rejection Reason (sent to seller):
                  </label>
                  <textarea
                    rows={3}
                    value={vehicleActionReason}
                    onChange={e => setVehicleActionReason(e.target.value)}
                    placeholder="Explain why this listing was rejected..."
                    className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              )}

              {vehicleActionModal.type === 'edit_reserve' && (
                <div className="space-y-3">
                  <label className="block font-bold text-gray-800 mb-1">
                    New Starting / Reserve Price (₹):
                  </label>
                  <input
                    type="number"
                    value={newReservePriceInput || ''}
                    onChange={e => setNewReservePriceInput(parseInt(e.target.value) || 0)}
                    placeholder="Enter price in INR"
                    className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setVehicleActionModal(null)}
                disabled={isProcessingVehicleAction}
                className="px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-50 text-xs cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleExecuteVehicleAction}
                disabled={isProcessingVehicleAction}
                className={`px-5 py-2.5 rounded-xl font-bold text-white transition shadow-sm active:scale-98 disabled:opacity-50 text-xs flex items-center gap-1.5 cursor-pointer ${
                  vehicleActionModal.type === 'delete' ? 'bg-red-600 hover:bg-red-700' :
                  vehicleActionModal.type === 'restrict' ? 'bg-amber-600 hover:bg-amber-700' :
                  vehicleActionModal.type === 'shadow_ban' ? 'bg-purple-700 hover:bg-purple-800' :
                  'bg-gray-900 hover:bg-black'
                }`}
              >
                {isProcessingVehicleAction ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <span>
                      {vehicleActionModal.type === 'delete' && '🗑️ Confirm Permanent Delete'}
                      {vehicleActionModal.type === 'restrict' && (vehicleActionModal.vehicle.isRestricted ? 'Confirm Unrestrict' : 'Confirm Restrict')}
                      {vehicleActionModal.type === 'shadow_ban' && (vehicleActionModal.vehicle.isShadowBanned ? 'Remove Shadow Ban' : 'Confirm Shadow Ban')}
                      {vehicleActionModal.type === 'reject' && 'Confirm Reject'}
                      {vehicleActionModal.type === 'edit_reserve' && 'Update Price'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-app Modal for User Moderation Actions (Suspend, Unsuspend, Delete, Role, KYC) */}
      {userActionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden animate-scale-up border border-gray-100 flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className={`p-5 border-b flex items-center justify-between ${
              userActionModal.type === 'delete' ? 'bg-red-50/80 border-red-100' :
              userActionModal.type === 'suspend' ? 'bg-amber-50/80 border-amber-100' :
              userActionModal.type === 'unsuspend' ? 'bg-emerald-50/80 border-emerald-100' :
              'bg-gray-50 border-gray-100'
            }`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl bg-white shadow-xs">
                  {userActionModal.type === 'delete' && '🗑️'}
                  {userActionModal.type === 'suspend' && '⏸️'}
                  {userActionModal.type === 'unsuspend' && '▶️'}
                  {userActionModal.type === 'role' && '👑'}
                  {userActionModal.type === 'kyc' && '🛡️'}
                </div>
                <div>
                  <h3 className="font-extrabold text-gray-900 text-base">
                    {userActionModal.type === 'delete' && 'Permanently Delete User Account'}
                    {userActionModal.type === 'suspend' && 'Suspend User Account'}
                    {userActionModal.type === 'unsuspend' && 'Reactivate User Account'}
                    {userActionModal.type === 'role' && 'Change User Account Role'}
                    {userActionModal.type === 'kyc' && 'Toggle KYC Identity Verification'}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    User: <strong>@{userActionModal.user.username}</strong> ({userActionModal.user.email || userActionModal.user.phoneNumber || 'UID: ' + userActionModal.user.id.slice(0, 8)})
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setUserActionModal(null)}
                disabled={isProcessingUserAction}
                className="w-8 h-8 rounded-full bg-white hover:bg-gray-100 text-gray-500 flex items-center justify-center font-bold text-sm transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 overflow-y-auto text-xs text-gray-700">
              {userActionModal.type === 'delete' && (
                <div className="space-y-4">
                  <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-900 space-y-2">
                    <p className="font-bold text-sm flex items-center gap-1.5 text-red-950">
                      <span>⚠️</span> Irreversible Action
                    </p>
                    <p className="leading-relaxed">
                      You are about to permanently delete <strong>@{userActionModal.user.username}</strong> from the database. This account will no longer be able to log in.
                    </p>
                  </div>

                  <label className="flex items-start gap-3 p-3.5 bg-gray-50 rounded-xl border border-gray-200 cursor-pointer hover:bg-gray-100/60 transition">
                    <input
                      type="checkbox"
                      checked={deleteUserListingsToo}
                      onChange={e => setDeleteUserListingsToo(e.target.checked)}
                      className="w-4 h-4 text-red-600 rounded mt-0.5 focus:ring-red-500"
                    />
                    <div>
                      <span className="font-bold text-gray-900 block">
                        Delete all vehicle listings owned by this user
                      </span>
                      <span className="text-[11px] text-gray-500">
                        Removes all vehicle auction and direct sale posts created by @{userActionModal.user.username}.
                      </span>
                    </div>
                  </label>

                  <div>
                    <label className="block font-bold text-gray-800 mb-1">
                      Administrative Audit Note:
                    </label>
                    <textarea
                      rows={2}
                      value={userActionReason}
                      onChange={e => setUserActionReason(e.target.value)}
                      placeholder="Optional reason for permanent account deletion..."
                      className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                </div>
              )}

              {userActionModal.type === 'suspend' && (
                <div className="space-y-4">
                  <div>
                    <label className="block font-bold text-gray-800 mb-1.5">
                      Suspension Severity:
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setUserActionSuspensionType('temporary')}
                        className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                          userActionSuspensionType === 'temporary'
                            ? 'bg-amber-50 border-amber-300 text-amber-950 ring-2 ring-amber-400'
                            : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <span className="font-extrabold text-xs block mb-0.5">⏳ Temporary Suspension</span>
                        <span className="text-[10px] text-gray-500 block">Locks bidding & listings until staff review or appeal.</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setUserActionSuspensionType('permanent')}
                        className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                          userActionSuspensionType === 'permanent'
                            ? 'bg-red-50 border-red-300 text-red-950 ring-2 ring-red-400'
                            : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <span className="font-extrabold text-xs block mb-0.5">⛔ Permanent Ban</span>
                        <span className="text-[10px] text-gray-500 block">Indefinitely bans the account from the entire platform.</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-gray-800 mb-1">
                      Reason for Suspension (visible to user on login):
                    </label>
                    <textarea
                      rows={3}
                      value={userActionReason}
                      onChange={e => setUserActionReason(e.target.value)}
                      placeholder="Specify reason (e.g. Terms violation, unpaid winning bid, inappropriate conduct)..."
                      className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                </div>
              )}

              {userActionModal.type === 'unsuspend' && (
                <div className="space-y-3">
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-900">
                    <p className="font-bold text-sm mb-1 text-emerald-950">✓ Confirm Account Reactivation</p>
                    <p className="leading-relaxed">
                      Are you sure you want to restore full platform access for <strong>@{userActionModal.user.username}</strong>?
                      This will clear their suspension status and allow them to browse, bid on live auctions, and manage vehicles.
                    </p>
                  </div>
                </div>
              )}

              {userActionModal.type === 'role' && (
                <div className="space-y-3">
                  <label className="block font-bold text-gray-800 mb-1">
                    Select New System Role for @{userActionModal.user.username}:
                  </label>
                  <select
                    value={userActionNewRole}
                    onChange={e => setUserActionNewRole(e.target.value as UserRole)}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 capitalize"
                  >
                    {ROLES.map(r => (
                      <option key={r} value={r}>
                        {r === 'admin' ? 'Superadmin (Full Control)' :
                         r === 'finance' ? 'Finance Team (Payouts & Ledger)' :
                         r === 'support' ? 'Customer Support (Tickets & Chats)' :
                         r === 'accountant' ? 'Accountant (Audit & Reports)' :
                         r === 'employee' ? 'Employee (Moderation Assistant)' :
                         'Regular User (Buyer / Seller)'}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {userActionModal.type === 'kyc' && (
                <div className="space-y-3">
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl text-blue-900">
                    <p className="font-bold text-sm mb-1 text-blue-950">
                      {userActionModal.user.isVerified ? 'Revoke Verification' : 'Manually Verify User'}
                    </p>
                    <p className="leading-relaxed">
                      {userActionModal.user.isVerified
                        ? `Revoking verification will remove the verified badge from @${userActionModal.user.username}.`
                        : `Manually verifying @${userActionModal.user.username} will instantly grant full verified privileges without requiring manual document submission.`}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setUserActionModal(null)}
                disabled={isProcessingUserAction}
                className="px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-50 text-xs cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleExecuteUserAction}
                disabled={isProcessingUserAction}
                className={`px-5 py-2.5 rounded-xl font-bold text-white transition shadow-sm active:scale-98 disabled:opacity-50 text-xs flex items-center gap-1.5 cursor-pointer ${
                  userActionModal.type === 'delete' ? 'bg-red-600 hover:bg-red-700' :
                  userActionModal.type === 'suspend' ? (userActionSuspensionType === 'permanent' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700') :
                  userActionModal.type === 'unsuspend' ? 'bg-emerald-600 hover:bg-emerald-700' :
                  'bg-gray-900 hover:bg-black'
                }`}
              >
                {isProcessingUserAction ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <span>
                      {userActionModal.type === 'delete' && '🗑️ Confirm Permanent Delete'}
                      {userActionModal.type === 'suspend' && (userActionSuspensionType === 'permanent' ? '⛔ Confirm Permanent Ban' : '⏸️ Confirm Suspension')}
                      {userActionModal.type === 'unsuspend' && '▶️ Confirm Reactivation'}
                      {userActionModal.type === 'role' && 'Save New Role'}
                      {userActionModal.type === 'kyc' && (userActionModal.user.isVerified ? 'Revoke KYC' : 'Verify Account')}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audience Engagement Modal (Real Viewers, Likes, and Wishlist Saves) */}
      {audienceInspectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden animate-scale-up border border-gray-100 flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/80">
              <div className="flex items-center gap-2">
                <span className="text-xl">
                  {audienceInspectModal.type === 'views' ? '👁️' :
                   audienceInspectModal.type === 'likes' ? '❤️' : '🔖'}
                </span>
                <div>
                  <h3 className="font-extrabold text-gray-900 text-sm">{audienceInspectModal.title}</h3>
                  <p className="text-[11px] text-gray-500">
                    {audienceInspectModal.type === 'views' && `${audienceInspectModal.vehicle.views || 0} total authenticated & visitor views`}
                    {audienceInspectModal.type === 'likes' && `${audienceInspectModal.vehicle.likesCount || audienceInspectModal.vehicle.interestedCount || (audienceInspectModal.vehicle.likesList?.length) || 0} interested accounts`}
                    {audienceInspectModal.type === 'wishlist' && `${audienceInspectModal.vehicle.watchCount || (audienceInspectModal.vehicle.wishlistUsers?.length) || 0} watchlist saves`}
                  </p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setAudienceInspectModal(null)}
                className="w-7 h-7 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-700 flex items-center justify-center text-xs font-bold transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2 flex-1">
              {audienceInspectModal.users && audienceInspectModal.users.length > 0 ? (
                audienceInspectModal.users.map((u, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 transition border border-gray-100">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img 
                        src={u.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=100'} 
                        alt="" 
                        className="w-8 h-8 rounded-full object-cover shrink-0" 
                      />
                      <div className="min-w-0">
                        <span className="font-bold text-gray-900 text-xs block truncate">@{u.username}</span>
                        {u.fullName && <span className="text-[10px] text-gray-400 block truncate">{u.fullName}</span>}
                      </div>
                    </div>
                    {u.timestamp && (
                      <span className="text-[10px] text-gray-400 font-mono shrink-0">
                        {new Date(u.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <div className="py-12 text-center text-gray-400">
                  <div className="text-3xl mb-1.5">👥</div>
                  <p className="font-bold text-gray-700 text-xs">No Individual Profiles Captured Yet</p>
                  <p className="text-[11px] text-gray-400 mt-1 max-w-xs mx-auto">
                    Total count is recorded on the vehicle post, and registered users who interact will appear here automatically.
                  </p>
                </div>
              )}
            </div>

            <div className="p-3 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                type="button"
                onClick={() => setAudienceInspectModal(null)}
                className="px-4 py-2 bg-gray-900 hover:bg-black text-white font-bold text-xs rounded-xl transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🔐 Admin Withdrawal Email OTP Verification Modal */}
      {showWithdrawalOtpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden animate-scale-up border border-gray-100 flex flex-col">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-gray-950 via-gray-900 to-gray-800 text-white">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-amber-500 text-black flex items-center justify-center font-black text-lg">
                  🔐
                </span>
                <div>
                  <h3 className="font-extrabold text-sm sm:text-base">Withdrawal Authorization OTP</h3>
                  <p className="text-[11px] text-gray-300">Registered Sign-Up Email Clearance</p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => {
                  setShowWithdrawalOtpModal(false);
                  setWithdrawalOtpError(null);
                }}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs font-bold transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-2xl text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold text-amber-950">
                  <span>✉️</span>
                  <span>Registered Sign-Up Email:</span>
                </div>
                <div className="font-mono text-sm font-extrabold text-gray-900 break-all bg-white px-3 py-1.5 rounded-xl border border-amber-200">
                  {withdrawalOtpTargetEmail || currentUser?.email || 'mmwajnnd@gmail.com'}
                </div>
                <p className="text-[11px] text-amber-900 leading-relaxed pt-0.5">
                  A 6-digit one-time authorization code has been dispatched to this address. Enter it below to unlock and proceed with withdrawal payout actions.
                </p>
                {dispatchedOtpHint && (
                  <div className="pt-1.5 flex items-center justify-between text-[11px] bg-amber-100/90 text-amber-950 px-2.5 py-1 rounded-lg">
                    <span>Preview Code: <strong className="font-mono text-xs">{dispatchedOtpHint}</strong></span>
                    <button
                      type="button"
                      onClick={() => setWithdrawalOtpInput(dispatchedOtpHint)}
                      className="text-[10px] font-bold text-indigo-700 hover:text-indigo-900 underline cursor-pointer"
                    >
                      Fill In
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Enter 6-Digit OTP Code
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={withdrawalOtpInput}
                  onChange={e => {
                    const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                    setWithdrawalOtpInput(val);
                    if (withdrawalOtpError) setWithdrawalOtpError(null);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && withdrawalOtpInput.length === 6) {
                      handleVerifyWithdrawalOtp();
                    }
                  }}
                  autoFocus
                  placeholder="• • • • • •"
                  className="w-full text-center tracking-[0.5em] font-mono text-2xl font-black py-3 px-4 bg-gray-50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-gray-900 focus:bg-white text-gray-900 placeholder-gray-300"
                />
              </div>

              {withdrawalOtpError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-semibold flex items-center gap-2">
                  <span>⚠️</span>
                  <span>{withdrawalOtpError}</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-1 text-xs">
                <span className="text-gray-400">Didn't receive email?</span>
                <button
                  type="button"
                  disabled={withdrawalOtpCountdown > 0 || withdrawalOtpLoading}
                  onClick={() => handleTriggerWithdrawalOtp()}
                  className="font-bold text-indigo-600 hover:text-indigo-800 disabled:text-gray-400 disabled:cursor-not-allowed cursor-pointer"
                >
                  {withdrawalOtpLoading ? 'Sending...' : withdrawalOtpCountdown > 0 ? `Resend Code (${withdrawalOtpCountdown}s)` : 'Resend OTP'}
                </button>
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setShowWithdrawalOtpModal(false);
                  setWithdrawalOtpError(null);
                }}
                className="px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-bold hover:bg-gray-100 transition text-xs cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={withdrawalOtpInput.length !== 6 || withdrawalOtpLoading}
                onClick={handleVerifyWithdrawalOtp}
                className="px-5 py-2.5 rounded-xl font-bold text-white bg-gray-900 hover:bg-black transition shadow-sm disabled:opacity-50 text-xs flex items-center gap-2 cursor-pointer"
              >
                {withdrawalOtpLoading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <span>✓</span>
                    <span>Verify & Proceed</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 💼 In-App Withdrawal Action Execution Modal */}
      {withdrawalActionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden animate-scale-up border border-gray-100 flex flex-col">
            <div className={`p-5 border-b flex items-center justify-between text-white ${
              withdrawalActionModal.type === 'approve' ? 'bg-gradient-to-r from-emerald-700 to-green-600' :
              withdrawalActionModal.type === 'drown' ? 'bg-gradient-to-r from-purple-800 to-indigo-700' :
              'bg-gradient-to-r from-red-700 to-rose-600'
            }`}>
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-xs text-white flex items-center justify-center font-black text-lg">
                  {withdrawalActionModal.type === 'approve' ? '💸' :
                   withdrawalActionModal.type === 'drown' ? '🌊' : '↩️'}
                </span>
                <div>
                  <h3 className="font-extrabold text-sm sm:text-base">
                    {withdrawalActionModal.type === 'approve' && 'Approve & Disburse Payout'}
                    {withdrawalActionModal.type === 'drown' && 'Drown Payment (Hold in DP Collection)'}
                    {withdrawalActionModal.type === 'reject' && 'Reject Withdrawal & Refund to Wallet'}
                  </h3>
                  <p className="text-[11px] text-white/80">Authorized via Registered Email OTP</p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setWithdrawalActionModal(null)}
                disabled={isProcessingWithdrawalAction}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs font-bold transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">User Account</span>
                  <span className="font-extrabold text-gray-900 text-sm">@{withdrawalActionModal.withdrawal.username}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">Withdrawal Amount</span>
                  <span className="font-black text-2xl text-emerald-600">₹{withdrawalActionModal.withdrawal.amount.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-xs pt-1 border-t border-gray-200/60">
                  <span className="text-gray-500">Destination</span>
                  <span className="font-mono font-semibold text-gray-800">
                    {withdrawalActionModal.withdrawal.payoutMethod === 'upi'
                      ? `UPI: ${withdrawalActionModal.withdrawal.upiId || 'N/A'}`
                      : `Bank: ${withdrawalActionModal.withdrawal.accountNumber || 'N/A'} (${withdrawalActionModal.withdrawal.ifsc || 'N/A'})`}
                  </span>
                </div>
              </div>

              {withdrawalActionModal.type === 'approve' && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-950 text-xs leading-relaxed space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-emerald-900">
                    <span>✓</span> Automated Razorpay Signal
                  </div>
                  <p>
                    Approving will debit ₹{withdrawalActionModal.withdrawal.amount.toLocaleString()} from your CB Account (Company Balance Account) and mark the withdrawal request as fulfilled.
                  </p>
                </div>
              )}

              {withdrawalActionModal.type === 'drown' && (
                <div className="space-y-3">
                  <div className="p-3.5 bg-purple-50 border border-purple-200 rounded-xl text-purple-950 text-xs leading-relaxed space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-purple-900">
                      <span>🌊</span> Drown Protection Channel
                    </div>
                    <p>
                      Funds will be moved to the <strong>DP Collection (Frozen / Drowned Protection)</strong> channel. The payout will be held pending identity/AML verification.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                      Reason for Drowning Payment:
                    </label>
                    <input
                      type="text"
                      value={withdrawalActionReason}
                      onChange={e => setWithdrawalActionReason(e.target.value)}
                      placeholder="e.g. Verification needed, suspicious velocity, bank account mismatch..."
                      className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </div>
              )}

              {withdrawalActionModal.type === 'reject' && (
                <div className="space-y-3">
                  <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-950 text-xs leading-relaxed space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-rose-900">
                      <span>↩️</span> Automatic Refund to User Wallet
                    </div>
                    <p>
                      Rejecting will return ₹{withdrawalActionModal.withdrawal.amount.toLocaleString()} directly into @{withdrawalActionModal.withdrawal.username}'s virtual wallet and notify them with the reason specified below.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                      Reason for Rejection:
                    </label>
                    <input
                      type="text"
                      value={withdrawalActionReason}
                      onChange={e => setWithdrawalActionReason(e.target.value)}
                      placeholder="e.g. Details mismatch, bank details incorrect, KYC required..."
                      className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setWithdrawalActionModal(null)}
                disabled={isProcessingWithdrawalAction}
                className="px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-bold hover:bg-gray-100 transition text-xs disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleExecuteWithdrawalAction}
                disabled={isProcessingWithdrawalAction}
                className={`px-5 py-2.5 rounded-xl font-bold text-white transition shadow-sm text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50 ${
                  withdrawalActionModal.type === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' :
                  withdrawalActionModal.type === 'drown' ? 'bg-purple-700 hover:bg-purple-800' :
                  'bg-red-600 hover:bg-red-700'
                }`}
              >
                {isProcessingWithdrawalAction ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <span>
                      {withdrawalActionModal.type === 'approve' && '💸 Confirm & Disburse Payout'}
                      {withdrawalActionModal.type === 'drown' && '🌊 Confirm Drown Payment'}
                      {withdrawalActionModal.type === 'reject' && '↩️ Confirm Reject & Refund'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Receipt & Gateway Audit Modal */}
      <TransactionReceiptModal
        transaction={adminSelectedTxForReceipt}
        isOpen={Boolean(adminSelectedTxForReceipt)}
        onClose={() => setAdminSelectedTxForReceipt(null)}
        isAdmin={true}
      />
    </div>
  );
};
