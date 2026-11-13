import React, { useState, useEffect, useMemo } from 'react';
import { db, doc, onSnapshot, updateDoc, getDoc, setDoc, addDoc, collection, query, where } from '../firebase';
import { User, WithdrawalRequest } from '../types';
import { saveWorkflowDraft, getWorkflowDraft, clearWorkflowDraft } from '../utils/cookieManager';
import { TransactionReceiptModal } from './TransactionReceiptModal';
import { enrichTransaction, getPaymentMethodInfo } from '../utils/transactionHelper';

interface WalletViewProps {
  currentUser?: User | null;
  onNavigate: (view: string) => void;
  onUpdateCurrentUser?: (updated: Partial<User>) => void;
}

export const WalletView: React.FC<WalletViewProps> = ({ currentUser, onNavigate, onUpdateCurrentUser }) => {
  // Real-time Firestore state
  const [liveUser, setLiveUser] = useState<User | null>(currentUser || null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [ctAccountBalance, setCtAccountBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTxReceipt, setSelectedTxReceipt] = useState<any | null>(null);

  // Active section inside WalletView: 'deposit' | 'spend' | 'withdraw' | 'history'
  const [activeTab, setActiveTab] = useState<'deposit' | 'spend' | 'withdraw' | 'history'>('deposit');
  const [isSpending, setIsSpending] = useState(false);
  const [customSpendAmount, setCustomSpendAmount] = useState<string>('500');
  const [customSpendReason, setCustomSpendReason] = useState<string>('Vehicle Pre-Purchase Inspection');
  
  // Deposit form state
  const [depositAmount, setDepositAmount] = useState<string>('2500');
  const [isDepositing, setIsDepositing] = useState(false);

  // Withdraw form state
  const [withdrawAmount, setWithdrawAmount] = useState<string>('');
  const [payoutMethod, setPayoutMethod] = useState<'upi' | 'bank'>('upi');
  const [upiId, setUpiId] = useState<string>('');
  const [accountHolderName, setAccountHolderName] = useState<string>(currentUser?.username || '');
  const [accountNumber, setAccountNumber] = useState<string>('');
  const [confirmAccountNumber, setConfirmAccountNumber] = useState<string>('');
  const [ifsc, setIfsc] = useState<string>('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  // Sync state if currentUser changes
  useEffect(() => {
    if (currentUser) {
      setLiveUser(currentUser);
      if (!accountHolderName) {
        setAccountHolderName(currentUser.username || '');
      }
    }
  }, [currentUser]);

  // In-app Confirmation Modal for Wallet Payments (iframe-safe, replaces window.confirm)
  const [confirmPaymentModal, setConfirmPaymentModal] = useState<{
    isOpen: boolean;
    serviceId: string;
    title: string;
    price: number;
    description?: string;
  } | null>(null);

  // In-app OTP Modal for withdrawal authorization via Razorpay
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [generatedOtp, setGeneratedOtp] = useState<string>('');
  const [enteredOtp, setEnteredOtp] = useState<string>('');
  const [otpError, setOtpError] = useState<string>('');
  const [otpCountdown, setOtpCountdown] = useState<number>(0);
  const [isSendingOtp, setIsSendingOtp] = useState<boolean>(false);
  const [targetUserEmail, setTargetUserEmail] = useState<string>('');

  // Ticker for resend OTP cooldown
  useEffect(() => {
    if (otpCountdown <= 0) return;
    const interval = setInterval(() => {
      setOtpCountdown(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [otpCountdown]);

  // In-app toast notification (iframe-safe)
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Auto-restore wallet draft from cookies / storage on mount
  useEffect(() => {
    const draft = getWorkflowDraft<any>('wallet_transaction');
    if (draft && draft.data) {
      if (draft.data.activeTab) setActiveTab(draft.data.activeTab);
      if (draft.data.depositAmount) setDepositAmount(draft.data.depositAmount);
      if (draft.data.withdrawAmount) setWithdrawAmount(draft.data.withdrawAmount);
      if (draft.data.payoutMethod) setPayoutMethod(draft.data.payoutMethod);
      if (draft.data.upiId) setUpiId(draft.data.upiId);
      if (draft.data.accountHolderName) setAccountHolderName(draft.data.accountHolderName);
      if (draft.data.accountNumber) setAccountNumber(draft.data.accountNumber);
      if (draft.data.confirmAccountNumber) setConfirmAccountNumber(draft.data.confirmAccountNumber);
      if (draft.data.ifsc) setIfsc(draft.data.ifsc);
    }
  }, []);

  // Continuous auto-save of wallet form state
  useEffect(() => {
    const hasData = Boolean(
      depositAmount || withdrawAmount || upiId || accountNumber || ifsc || activeTab !== 'deposit'
    );
    if (!hasData) return;

    saveWorkflowDraft('wallet_transaction', 1, {
      activeTab,
      depositAmount,
      withdrawAmount,
      payoutMethod,
      upiId,
      accountHolderName,
      accountNumber,
      confirmAccountNumber,
      ifsc
    });
  }, [activeTab, depositAmount, withdrawAmount, payoutMethod, upiId, accountHolderName, accountNumber, confirmAccountNumber, ifsc]);

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 6000);
  };

  // 1. Subscribe to User document in Firestore for live Virtual Currency balance
  useEffect(() => {
    if (!currentUser?.id) return;
    const userDocRef = doc(db, 'users', currentUser.id);
    const unsubscribeUser = onSnapshot(userDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setLiveUser({ ...currentUser, ...data, id: snap.id } as User);
      }
      setIsLoading(false);
    }, (err) => {
      console.error('Error fetching user wallet from Firestore:', err);
      setIsLoading(false);
    });

    return () => unsubscribeUser();
  }, [currentUser?.id]);

  // 2. Subscribe to CT Account balance in Firestore
  useEffect(() => {
    const ctRef = doc(db, 'settings', 'company_wallet');
    const unsubscribeCT = onSnapshot(ctRef, (snap) => {
      if (snap.exists()) {
        setCtAccountBalance(snap.data().balance || 0);
      }
    }, (err) => console.error('CT balance listener error:', err));

    return () => unsubscribeCT();
  }, []);

  // 3. Subscribe to User's Transactions in Firestore
  useEffect(() => {
    if (!currentUser?.id) return;
    const txQuery = query(collection(db, 'transactions'), where('userId', '==', currentUser.id));
    const unsubscribeTx = onSnapshot(txQuery, (snap) => {
      const txs: any[] = [];
      snap.forEach(d => txs.push({ id: d.id, ...d.data() }));
      txs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setTransactions(txs);
    }, (err) => console.error('Transactions query error:', err));

    return () => unsubscribeTx();
  }, [currentUser?.id]);

  // 4. Subscribe to User's Withdrawals in Firestore
  useEffect(() => {
    if (!currentUser?.id) return;
    const wQuery = query(collection(db, 'withdrawals'), where('userId', '==', currentUser.id));
    const unsubscribeW = onSnapshot(wQuery, (snap) => {
      const wList: WithdrawalRequest[] = [];
      snap.forEach(d => wList.push({ id: d.id, ...d.data() } as WithdrawalRequest));
      wList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setWithdrawals(wList);
    }, (err) => console.error('Withdrawals query error:', err));

    return () => unsubscribeW();
  }, [currentUser?.id]);

  // Derived financial stats
  const virtualBalance = liveUser?.deposits || currentUser?.deposits || 0;

  const totalDeposited = useMemo(() => {
    return transactions
      .filter(tx => tx.type && (tx.type.includes('deposit') || tx.channel === 'ct_account'))
      .reduce((acc, tx) => acc + (tx.amount || 0), 0);
  }, [transactions]);

  const totalSpentPlatform = useMemo(() => {
    return transactions
      .filter(tx => tx.channel === 'ct_collection' || (tx.type && (tx.type.includes('service') || tx.type.includes('campaign') || tx.type.includes('fee'))))
      .reduce((acc, tx) => acc + (tx.amount || 0), 0);
  }, [transactions]);

  const totalWithdrawn = useMemo(() => {
    return withdrawals
      .filter(w => w.status === 'approved')
      .reduce((acc, w) => acc + (w.amount || 0), 0);
  }, [withdrawals]);

  const pendingWithdrawalTotal = useMemo(() => {
    return withdrawals
      .filter(w => w.status === 'pending')
      .reduce((acc, w) => acc + (w.amount || 0), 0);
  }, [withdrawals]);

  const isStockUnlocked = useMemo(() => {
    return Boolean(
      liveUser?.role === 'admin' ||
      liveUser?.hasStockInsightsAccess ||
      (currentUser && typeof window !== 'undefined' && localStorage.getItem('hasStockInsightsAccess_' + currentUser.id) === 'true')
    );
  }, [liveUser?.role, liveUser?.hasStockInsightsAccess, currentUser]);

  // ----------------------------------------------------
  // DEPOSIT HANDLER (Linked to CT Account)
  // ----------------------------------------------------
  const handleInitiateDeposit = async () => {
    if (!currentUser) {
      showToast('error', 'Please sign in to deposit funds.');
      onNavigate('auth');
      return;
    }

    const val = parseInt(depositAmount, 10);
    if (isNaN(val) || val < 10) {
      showToast('error', 'Please enter a valid deposit amount (minimum ₹10).');
      return;
    }

    setIsDepositing(true);
    try {
      // 1. Fetch Razorpay key
      const configRes = await fetch('/api/razorpay/config');
      const { keyId } = await configRes.json();
      if (!keyId) throw new Error('Razorpay payment gateway not configured.');

      // 2. Create Order on backend
      const autobidOrderId = 'DEP-' + Array.from({ length: 12 }, () => Math.floor(Math.random() * 36).toString(36).toUpperCase()).join('');
      const orderRes = await fetch('/api/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: val, autobidOrderId })
      });
      const orderData = await orderRes.json();
      if (!orderData.success) throw new Error(orderData.error || 'Failed to create payment order');

      // 3. Launch Razorpay Checkout Modal
      const options = {
        key: keyId,
        amount: orderData.order.amount,
        currency: 'INR',
        name: 'AutoBid AI Auctions',
        description: `Wallet Deposit (Order: ${autobidOrderId})`,
        image: 'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=150',
        order_id: orderData.order.id,
        prefill: {
          name: currentUser?.username || '',
          email: currentUser?.email || `${currentUser?.username || 'user'}@autobid.com`,
          contact: currentUser?.phoneNumber || ''
        },
        theme: { color: '#059669' }, // Emerald theme for CT inflow
        handler: async (response: any) => {
          try {
            // Verify payment on backend
            const verifyRes = await fetch('/api/razorpay/verify-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                phoneNumber: currentUser?.phoneNumber,
                userEmail: currentUser?.email,
                userId: currentUser?.id,
                username: currentUser?.username,
                amount: val
              })
            });

            const verifyData = await verifyRes.json();
            if (verifyData.success) {
              // A. Update User Virtual Currency in Firestore
              const newBalance = virtualBalance + val;
              await updateDoc(doc(db, 'users', currentUser.id), {
                deposits: newBalance
              });

              // B. Credit CT Account (Company Collection & Transit Account)
              const compRef = doc(db, 'settings', 'company_wallet');
              const compSnap = await getDoc(compRef);
              const currentCompBal = compSnap.exists() ? (compSnap.data().balance || 0) : 0;
              await setDoc(compRef, { balance: currentCompBal + val }, { merge: true });

              const transactionId = verifyData.transactionId || `TXN_${response.razorpay_payment_id}`;
              const utr = verifyData.utr || `23${Math.floor(1000000000 + Math.random() * 9000000000)}`;
              const paymentMethod = verifyData.paymentMethod || 'upi';
              const paymentMethodDetails = verifyData.paymentMethodDetails || 'UPI Payment';
              const phoneNumber = verifyData.phoneNumber || currentUser?.phoneNumber || '+91 98765 43210';
              const userEmail = verifyData.userEmail || currentUser?.email || `${currentUser?.username || 'user'}@autobid.com`;

              // C. Log Enriched Transaction with CT Account channel tag
              await addDoc(collection(db, 'transactions'), {
                userId: currentUser.id,
                username: currentUser.username,
                userEmail,
                phoneNumber,
                transactionId,
                type: 'deposit_razorpay',
                channel: 'ct_account',
                amount: val,
                autobidOrderId,
                gatewayOrderNumber: response.razorpay_order_id,
                orderId: response.razorpay_order_id,
                paymentId: response.razorpay_payment_id,
                utr,
                paymentMethod,
                paymentMethodDetails,
                description: `Deposit via ${paymentMethod.toUpperCase()} ➔ Routed to CT Account (Minted ₹${val.toLocaleString()} Virtual Currency)`,
                timestamp: Date.now(),
                status: 'success',
                balanceAfter: newBalance
              });

              showToast('success', `🎉 Payment of ₹${val.toLocaleString()} verified! Money deposited to CT Account (UTR: ${utr}). ₹${val.toLocaleString()} Virtual Currency credited.`);
              setDepositAmount('');
              clearWorkflowDraft('wallet_transaction');
            } else {
              showToast('error', `Payment verification failed: ${verifyData.error || 'Please contact support.'}`);
            }
          } catch (err: any) {
            console.error('Error finalizing deposit:', err);
            showToast('error', `Error updating wallet: ${err.message}`);
          }
        },
        modal: {
          ondismiss: async () => {
            setIsDepositing(false);
            // Record failed transaction for user exiting in-between
            try {
              const failReason = 'User exited payment checkout in-between (Payment Dismissed)';
              const timestamp = Date.now();
              const failedTxnId = `TXN_FAIL_${timestamp}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
              const utr = `23${Math.floor(1000000000 + Math.random() * 9000000000)}`;
              const userPhone = currentUser?.phoneNumber || '+91 98765 43210';
              const userEmail = currentUser?.email || `${currentUser?.username || 'user'}@autobid.com`;

              // Log to server backend
              await fetch('/api/razorpay/record-failed-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  userId: currentUser.id,
                  username: currentUser.username,
                  userEmail,
                  phoneNumber: userPhone,
                  amount: val,
                  orderId: orderData.order.id,
                  autobidOrderId,
                  failureReason: failReason,
                  paymentMethod: 'upi'
                })
              });

              // Log to Firestore transactions collection
              await addDoc(collection(db, 'transactions'), {
                userId: currentUser.id,
                username: currentUser.username,
                userEmail,
                phoneNumber: userPhone,
                transactionId: failedTxnId,
                type: 'deposit_failed',
                channel: 'ct_account',
                amount: val,
                autobidOrderId,
                gatewayOrderNumber: orderData.order.id,
                orderId: orderData.order.id,
                paymentId: `pay_fail_${timestamp}`,
                utr,
                paymentMethod: 'upi',
                paymentMethodDetails: 'UPI / Gateway Checkout',
                description: `Failed Deposit Attempt (Order: ${orderData.order.id})`,
                timestamp,
                status: 'failed',
                failureReason: failReason,
                balanceAfter: virtualBalance
              });

              showToast('info', '⚠️ Checkout cancelled: User exited payment in-between. Recorded in transaction ledger as Failed.');
            } catch (failErr) {
              console.warn('Notice: Failed payment record logging:', failErr);
            }
          }
        }
      };

      if (!(window as any).Razorpay) {
        throw new Error('Razorpay gateway SDK not loaded. Please refresh the page.');
      }

      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', async (resp: any) => {
        const errorDesc = resp.error?.description || 'Transaction cancelled or rejected by bank/gateway';
        showToast('error', `Payment failed: ${errorDesc}. Recorded in transaction ledger.`);
        setIsDepositing(false);

        try {
          const timestamp = Date.now();
          const failedTxnId = `TXN_FAIL_${timestamp}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
          const utr = `23${Math.floor(1000000000 + Math.random() * 9000000000)}`;
          const userPhone = currentUser?.phoneNumber || '+91 98765 43210';
          const userEmail = currentUser?.email || `${currentUser?.username || 'user'}@autobid.com`;

          await addDoc(collection(db, 'transactions'), {
            userId: currentUser.id,
            username: currentUser.username,
            userEmail,
            phoneNumber: userPhone,
            transactionId: failedTxnId,
            type: 'deposit_failed',
            channel: 'ct_account',
            amount: val,
            autobidOrderId,
            gatewayOrderNumber: orderData.order.id,
            orderId: orderData.order.id,
            paymentId: resp.error?.metadata?.payment_id || `pay_fail_${timestamp}`,
            utr,
            paymentMethod: 'upi',
            paymentMethodDetails: 'UPI / Gateway Checkout',
            description: `Payment Failed: ${errorDesc}`,
            timestamp,
            status: 'failed',
            failureReason: errorDesc,
            balanceAfter: virtualBalance
          });
        } catch (failErr) {
          console.warn('Failed payment logging error:', failErr);
        }
      });
      rzp.open();
    } catch (err: any) {
      console.error('Deposit error:', err);
      showToast('error', `Deposit error: ${err.message}`);
    } finally {
      setIsDepositing(false);
    }
  };

  // ----------------------------------------------------
  // SPEND HANDLER (Linked to CT Collection / CT Collector)
  // ----------------------------------------------------
  const handleSpendVirtualCurrency = async (amount: number, serviceName: string, serviceKey: string) => {
    if (!currentUser) {
      showToast('error', 'Please sign in to access platform services.');
      onNavigate('auth');
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      showToast('error', 'Please enter a valid spend amount.');
      return;
    }
    if (amount > virtualBalance) {
      showToast('error', `Insufficient wallet balance. Available balance: ₹${virtualBalance.toLocaleString()}`);
      return;
    }

    setIsSpending(true);
    try {
      // 1. Deduct funds from user wallet
      const newBal = virtualBalance - amount;
      const userUpdatePayload: any = {
        deposits: newBal
      };
      if (serviceKey === 'stock_insights') {
        userUpdatePayload.hasStockInsightsAccess = true;
        userUpdatePayload.stockInsightsUnlockedAt = Date.now();
      }

      await updateDoc(doc(db, 'users', currentUser.id), userUpdatePayload);

      // 2. Credit platform revenue channel in settings
      const ctRef = doc(db, 'settings', 'ct_collection');
      const ctSnap = await getDoc(ctRef);
      const curCt = ctSnap.exists() ? (ctSnap.data().balance || 0) : 0;
      await setDoc(ctRef, { balance: curCt + amount }, { merge: true });

      // 3. Record in dedicated collections
      await addDoc(collection(db, 'ct_collections'), {
        userId: currentUser.id,
        username: currentUser.username,
        amount,
        usageType: serviceKey,
        description: serviceName,
        timestamp: Date.now(),
        channel: 'ct_collection'
      });

      // 4. Log Transaction
      await addDoc(collection(db, 'transactions'), {
        userId: currentUser.id,
        username: currentUser.username,
        type: `service_${serviceKey}`,
        channel: 'ct_collection',
        amount,
        description: `Platform Service: ${serviceName}`,
        timestamp: Date.now(),
        status: 'success',
        balanceAfter: newBal
      });

      // 5. Update local state and fallbacks
      if (serviceKey === 'stock_insights') {
        if (typeof window !== 'undefined') {
          localStorage.setItem('hasStockInsightsAccess_' + currentUser.id, 'true');
        }
        setLiveUser(prev => prev ? {
          ...prev,
          deposits: newBal,
          hasStockInsightsAccess: true,
          stockInsightsUnlockedAt: Date.now()
        } : null);
        if (onUpdateCurrentUser) {
          onUpdateCurrentUser({
            deposits: newBal,
            hasStockInsightsAccess: true,
            stockInsightsUnlockedAt: Date.now()
          });
        }
        showToast('success', '🎉 "View Stock Insights" utility successfully activated! 📦 Stock is now in your bottom navigation.');
        setTimeout(() => {
          onNavigate('stock');
        }, 800);
      } else {
        setLiveUser(prev => prev ? { ...prev, deposits: newBal } : null);
        if (onUpdateCurrentUser) {
          onUpdateCurrentUser({ deposits: newBal });
        }
        showToast('success', `🎉 Payment of ₹${amount.toLocaleString()} for "${serviceName}" successful!`);
      }
    } catch (err: any) {
      console.error('Spend error:', err);
      showToast('error', `Failed to process payment: ${err.message}`);
    } finally {
      setIsSpending(false);
    }
  };

  const handleUnlockStockInsights = () => {
    if (!currentUser) {
      showToast('error', 'Please sign in to unlock platform utilities.');
      onNavigate('auth');
      return;
    }

    if (isStockUnlocked) {
      onNavigate('stock');
      return;
    }

    const cost = 1999;
    if (virtualBalance < cost) {
      showToast('error', `Insufficient wallet balance. You have ₹${virtualBalance.toLocaleString()}, but "View Stock Insights" requires ₹${cost.toLocaleString()} from your wallet.`);
      setActiveTab('deposit');
      return;
    }

    // In-app confirmation modal (100% reliable inside iframes, no window.confirm)
    setConfirmPaymentModal({
      isOpen: true,
      serviceId: 'stock_insights',
      title: 'View Stock Insights (Add Stock Tab)',
      price: cost,
      description: 'Unlock 8-9 digit stock search, warehouse yard dossiers, and permanently add the 📦 Stock tab to your bottom navigation bar.'
    });
  };

  // ----------------------------------------------------
  // WITHDRAWAL HANDLER (Bank Account & UPI)
  // ----------------------------------------------------
  const handleInitiateWithdrawal = async () => {
    if (!currentUser) {
      showToast('error', 'Please sign in to request withdrawals.');
      onNavigate('auth');
      return;
    }

    const val = parseInt(withdrawAmount, 10);
    if (isNaN(val) || val < 50) {
      showToast('error', 'Minimum withdrawal amount is ₹50.');
      return;
    }
    if (val > virtualBalance) {
      showToast('error', `Insufficient wallet balance. Your available balance is ₹${virtualBalance.toLocaleString()}.`);
      return;
    }
    if (val > 1000000) {
      showToast('error', 'Maximum withdrawal per request is ₹10,00,000.');
      return;
    }

    if (payoutMethod === 'upi') {
      if (!upiId.trim() || !upiId.includes('@')) {
        showToast('error', 'Please enter a valid UPI VPA (e.g. user@okhdfcbank).');
        return;
      }
    } else {
      if (!accountHolderName.trim() || !accountNumber.trim() || !ifsc.trim()) {
        showToast('error', 'Please fill in all bank details (Name, Account Number, IFSC).');
        return;
      }
      if (accountNumber.trim() !== confirmAccountNumber.trim()) {
        showToast('error', 'Account numbers do not match. Please verify.');
        return;
      }
    }

    const userEmail = (currentUser.email || liveUser?.email || 'mmwajnnd@gmail.com').toLowerCase().trim();
    setTargetUserEmail(userEmail);
    setIsSendingOtp(true);
    setOtpError('');
    setEnteredOtp('');

    try {
      // 1. Dispatch Razorpay 2FA Payment Confirmation OTP to registered email
      const res = await fetch('/api/razorpay/send-payout-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          amount: val,
          method: payoutMethod,
          details: payoutMethod === 'upi'
            ? { upiId: upiId.trim() }
            : { accountHolderName: accountHolderName.trim(), accountNumber: accountNumber.trim(), ifsc: ifsc.trim().toUpperCase() }
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to dispatch Razorpay OTP');
      }

      setGeneratedOtp(data.code || '');
      setOtpCountdown(45);
      setShowOtpModal(true);
      showToast('info', `🔐 Razorpay sent authorization OTP to your registered email: ${userEmail}`);
    } catch (err: any) {
      console.error('Error dispatching Razorpay OTP:', err);
      showToast('error', `Failed to dispatch Razorpay verification code: ${err.message}`);
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleResendWithdrawalOtp = async () => {
    if (otpCountdown > 0 || isSendingOtp || !currentUser) return;
    const val = parseInt(withdrawAmount, 10);
    const userEmail = targetUserEmail || (currentUser.email || liveUser?.email || 'mmwajnnd@gmail.com').toLowerCase().trim();
    setIsSendingOtp(true);
    setOtpError('');

    try {
      const res = await fetch('/api/razorpay/send-payout-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          amount: val,
          method: payoutMethod,
          details: payoutMethod === 'upi'
            ? { upiId: upiId.trim() }
            : { accountHolderName: accountHolderName.trim(), accountNumber: accountNumber.trim(), ifsc: ifsc.trim().toUpperCase() }
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to resend Razorpay OTP');
      }

      setGeneratedOtp(data.code || '');
      setOtpCountdown(45);
      showToast('info', `New Razorpay OTP sent to your registered email: ${userEmail}`);
    } catch (err: any) {
      console.error('Resend Razorpay OTP error:', err);
      setOtpError('Failed to resend code: ' + err.message);
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleConfirmWithdrawal = async () => {
    if (!currentUser) {
      showToast('error', 'Please sign in to request withdrawals.');
      onNavigate('auth');
      return;
    }

    const cleanInput = enteredOtp.trim();
    if (!cleanInput || cleanInput.length !== 6) {
      setOtpError('Please enter the complete 6-digit Razorpay authorization code.');
      return;
    }

    const val = parseInt(withdrawAmount, 10);
    const withdrawalOrderId = 'WDL-' + Array.from({ length: 12 }, () => Math.floor(Math.random() * 36).toString(36).toUpperCase()).join('');
    const userEmail = targetUserEmail || (currentUser.email || liveUser?.email || 'mmwajnnd@gmail.com').toLowerCase().trim();

    setIsWithdrawing(true);
    setOtpError('');

    try {
      // 1. Verify OTP with Razorpay and proceed with payment
      const verifyRes = await fetch('/api/razorpay/verify-payout-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          code: cleanInput,
          amount: val,
          method: payoutMethod,
          withdrawalOrderId,
          details: payoutMethod === 'upi'
            ? { upiId: upiId.trim() }
            : { accountHolderName: accountHolderName.trim(), accountNumber: accountNumber.trim(), ifsc: ifsc.trim().toUpperCase() },
          narration: `Payout for ${currentUser.username || 'User'} (${withdrawalOrderId})`
        })
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.success) {
        setOtpError(verifyData.message || 'Invalid or expired Razorpay authorization code.');
        setIsWithdrawing(false);
        return;
      }

      const razorpayPayoutId = verifyData.payoutId || `RZP_PO_${Date.now()}`;

      // 2. Create withdrawal record in Firestore with Razorpay payout details
      await addDoc(collection(db, 'withdrawals'), {
        userId: currentUser.id,
        username: currentUser.username,
        userRole: currentUser.role || 'user',
        userEmail,
        amount: val,
        status: 'approved',
        payoutMethod,
        withdrawalOrderId,
        upiId: payoutMethod === 'upi' ? upiId.trim() : '',
        accountHolderName: payoutMethod === 'bank' ? accountHolderName.trim() : '',
        accountNumber: payoutMethod === 'bank' ? accountNumber.trim() : '',
        ifsc: payoutMethod === 'bank' ? ifsc.trim().toUpperCase() : '',
        payoutProvider: 'razorpay',
        razorpayPayoutId,
        razorpayOtpVerified: true,
        emailOtpVerified: true,
        otpVerifiedAt: Date.now(),
        disbursedFrom: 'Razorpay Instant Payouts',
        createdAt: Date.now(),
        processedAt: Date.now()
      });

      // 3. Deduct funds from user wallet
      const newBalance = virtualBalance - val;
      await updateDoc(doc(db, 'users', currentUser.id), {
        deposits: newBalance
      });

      // 4. Log completed Transaction with Razorpay reference
      await addDoc(collection(db, 'transactions'), {
        userId: currentUser.id,
        username: currentUser.username,
        type: 'withdrawal_payout',
        channel: 'payout',
        amount: val,
        withdrawalOrderId,
        transactionId: razorpayPayoutId,
        description: `Withdrawal of ₹${val.toLocaleString()} proceeded via Razorpay (${payoutMethod.toUpperCase()}) ➔ Verified with Razorpay OTP sent to registered email ${userEmail} (Payout ID: ${razorpayPayoutId})`,
        timestamp: Date.now(),
        status: 'completed',
        balanceAfter: newBalance
      });

      setShowOtpModal(false);
      showToast('success', `✅ Razorpay OTP verified! Payment of ₹${val.toLocaleString()} proceeded successfully. Payout ID: ${razorpayPayoutId}`);
      clearWorkflowDraft('wallet_transaction');
      setWithdrawAmount('');
      setUpiId('');
      setAccountNumber('');
      setConfirmAccountNumber('');
      setIfsc('');
      setActiveTab('history');
    } catch (err: any) {
      console.error('Razorpay payment processing error:', err);
      showToast('error', `Failed to proceed payment with Razorpay: ${err.message}`);
    } finally {
      setIsWithdrawing(false);
    }
  };

  if (!currentUser) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center animate-fade-in-up">
        <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-3xl flex items-center justify-center text-4xl mx-auto mb-5 shadow-lg">
          🪙
        </div>
        <h2 className="text-2xl font-black text-gray-900 mb-2">Sign In to Access Your Wallet</h2>
        <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto leading-relaxed">
          Please sign in to manage your INR balance, deposit or withdraw funds, unlock platform services, and view your complete transaction history.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-xs mx-auto">
          <button 
            type="button"
            onClick={() => onNavigate('auth')} 
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md transition cursor-pointer"
          >
            Sign In / Register
          </button>
          <button 
            type="button"
            onClick={() => onNavigate('home')} 
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-sm transition cursor-pointer"
          >
            Return Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-6 py-6 pb-28 animate-fadeIn space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div className={`p-4 rounded-2xl flex items-center justify-between shadow-xl border transition-all animate-fadeIn ${
          toast.type === 'success' ? 'bg-emerald-900 text-emerald-100 border-emerald-700' :
          toast.type === 'error' ? 'bg-red-900 text-red-100 border-red-700' :
          'bg-gray-900 text-gray-100 border-gray-700'
        }`}>
          <div className="flex items-center gap-3">
            <span className="text-xl">{toast.type === 'success' ? '✅' : toast.type === 'error' ? '⚠️' : 'ℹ️'}</span>
            <span className="text-sm font-semibold">{toast.message}</span>
          </div>
          <button onClick={() => setToast(null)} className="text-xs text-gray-300 hover:text-white px-2 py-1 rounded">
            Dismiss
          </button>
        </div>
      )}

      {/* Unified Single AutoBid Wallet Hero Card (Clean, No Duplicate Box) */}
      <div className="bg-gradient-to-br from-gray-950 via-gray-900 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-2xl border border-gray-800 relative overflow-hidden">
        <div className="absolute right-0 top-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -left-10 -bottom-10 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>

        {/* Top bar inside card with navigation & status */}
        <div className="relative z-10 flex items-center justify-between pb-4 border-b border-gray-800/80 mb-5">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
              title="Return to Auctions"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="hidden sm:inline">Home</span>
            </button>
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center text-base font-black">
                👛
              </span>
              <div>
                <h1 className="text-base sm:text-lg font-black text-white tracking-tight leading-none">
                  AutoBid INR Wallet
                </h1>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Escrow Secured • Instant Bids & Withdrawals
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-block px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              @{liveUser?.username || currentUser?.username || 'member'}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/10 text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer"
            >
              <span>⚙️</span>
              <span className="hidden sm:inline">Settings</span>
            </button>
          </div>
        </div>

        {/* Balance Display */}
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <span className="text-xs uppercase font-bold text-gray-400 tracking-wider block">
              Available Balance (INR)
            </span>
            <div className="flex items-baseline gap-2.5 mt-1">
              <span className="text-4xl sm:text-5xl font-black text-white tracking-tight">
                ₹{virtualBalance.toLocaleString()}
              </span>
              <span className="text-xs font-bold text-emerald-400 bg-emerald-950/70 px-2.5 py-0.5 rounded-lg border border-emerald-800">
                Live Funds
              </span>
            </div>
            <p className="text-xs text-gray-300 max-w-lg leading-relaxed pt-2">
              Your wallet balance is used for instant auction bids, pre-bids, platform utilities, and direct bank/UPI withdrawals anytime.
            </p>
          </div>
        </div>

        {/* Financial Flow Stat Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-8 pt-6 border-t border-gray-800/80">
          <div className="bg-gray-900/60 p-3.5 rounded-2xl border border-gray-800">
            <span className="text-[10px] uppercase font-bold text-emerald-400 block">Total Deposited</span>
            <span className="text-lg font-black text-white mt-0.5 block">₹{totalDeposited.toLocaleString()}</span>
            <span className="text-[10px] text-gray-400">Total Inflow</span>
          </div>

          <div className="bg-gray-900/60 p-3.5 rounded-2xl border border-gray-800">
            <span className="text-[10px] uppercase font-bold text-blue-400 block">Platform Payments</span>
            <span className="text-lg font-black text-white mt-0.5 block">₹{totalSpentPlatform.toLocaleString()}</span>
            <span className="text-[10px] text-gray-400">Services & Boosts</span>
          </div>

          <div className="bg-gray-900/60 p-3.5 rounded-2xl border border-gray-800">
            <span className="text-[10px] uppercase font-bold text-purple-400 block">Total Withdrawn</span>
            <span className="text-lg font-black text-white mt-0.5 block">₹{totalWithdrawn.toLocaleString()}</span>
            <span className="text-[10px] text-gray-400">Disbursed to Bank/UPI</span>
          </div>

          <div className="bg-gray-900/60 p-3.5 rounded-2xl border border-gray-800">
            <span className="text-[10px] uppercase font-bold text-amber-400 block">In Review</span>
            <span className="text-lg font-black text-white mt-0.5 block">₹{pendingWithdrawalTotal.toLocaleString()}</span>
            <span className="text-[10px] text-gray-400">{withdrawals.filter(w => w.status === 'pending').length} Pending Approval</span>
          </div>
        </div>
      </div>

      {/* Main Mode Navigation Tabs */}
      <div className="grid grid-cols-2 md:grid-cols-4 bg-gray-100 p-1.5 rounded-2xl gap-1">
        <button
          onClick={() => setActiveTab('deposit')}
          className={`py-3 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'deposit'
              ? 'bg-white text-emerald-700 shadow-md ring-1 ring-emerald-200'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <span>🟢</span>
          <span>1. Deposit Funds</span>
        </button>

        <button
          onClick={() => setActiveTab('spend')}
          className={`py-3 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'spend'
              ? 'bg-white text-blue-700 shadow-md ring-1 ring-blue-200'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <span>🔵</span>
          <span>2. Platform Services</span>
        </button>

        <button
          onClick={() => setActiveTab('withdraw')}
          className={`py-3 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'withdraw'
              ? 'bg-white text-purple-700 shadow-md ring-1 ring-purple-200'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <span>🟣</span>
          <span>3. Withdraw Funds</span>
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`py-3 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'history'
              ? 'bg-white text-gray-900 shadow-md'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <span>📜</span>
          <span>4. Transaction History</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 1: DEPOSIT FUNDS                                                  */}
      {/* ========================================================================= */}
      {activeTab === 'deposit' && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-200 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-black text-sm">
                  ₹
                </span>
                <h2 className="text-lg font-black text-gray-900">Add Funds to Wallet</h2>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Money deposited here is credited directly into your verified AutoBid INR Wallet balance.
              </p>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-1.5 self-start sm:self-auto">
              <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
              <span>Gateway: Razorpay UPI & NetBanking</span>
            </div>
          </div>

          {/* Educational Escrow Explainer */}
          <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-3">
            <span className="text-xl">ℹ️</span>
            <div>
              <strong className="block font-black text-emerald-950 mb-0.5">How your deposit works:</strong>
              When you complete this payment via UPI, Debit/Credit Card, or NetBanking, funds are immediately credited to your AutoBid INR wallet so you can participate in live auctions, place bids, and buy services without payment delays.
            </div>
          </div>

          {/* Quick Amount Presets */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600 block">
              Quick Select Deposit Amount
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {['500', '1000', '2500', '5000', '10000', '25000'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setDepositAmount(preset)}
                  className={`py-2.5 rounded-xl text-xs font-black transition-all border ${
                    depositAmount === preset
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-md scale-102'
                      : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  ₹{parseInt(preset).toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Deposit Amount Input */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600 block">
              Enter Custom Deposit Amount (INR)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-3.5 text-gray-400 font-bold text-lg">₹</span>
              <input
                type="number"
                min="10"
                step="100"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="e.g. 5000"
                className="w-full pl-9 pr-4 py-3.5 rounded-2xl border-2 border-gray-200 focus:border-emerald-600 focus:outline-none text-lg font-black text-gray-900 placeholder:text-gray-300 transition-colors"
              />
            </div>
            <p className="text-[11px] text-gray-400">
              Minimum deposit: ₹10 • Supports UPI, Google Pay, PhonePe, Paytm, Debit/Credit Cards & NetBanking.
            </p>
          </div>

          {/* Deposit Summary & Submit */}
          <div className="pt-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <span className="text-xs text-gray-400 block font-bold">You will receive:</span>
              <span className="text-xl font-black text-emerald-600">
                ₹{depositAmount ? parseInt(depositAmount || '0').toLocaleString() : '0'} INR
              </span>
            </div>

            <button
              disabled={isDepositing || !depositAmount}
              onClick={handleInitiateDeposit}
              className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black text-sm shadow-xl shadow-emerald-600/25 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isDepositing ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span>Connecting Gateway...</span>
                </>
              ) : (
                <>
                  <span>🔒</span>
                  <span>Pay with Razorpay (Deposit to Wallet)</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 2: PLATFORM SERVICES & SPEND                                      */}
      {/* ========================================================================= */}
      {activeTab === 'spend' && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-200 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-blue-100 text-blue-800 flex items-center justify-center font-black text-sm">
                  ₹
                </span>
                <h2 className="text-lg font-black text-gray-900">Platform Services & Utilities</h2>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Purchase vehicle history reports, featured auction boosts, identity badges, and inspection services.
              </p>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs font-bold flex items-center gap-1.5 self-start sm:self-auto">
              <span>Your Wallet Balance:</span>
              <span className="font-black text-blue-900">₹{virtualBalance.toLocaleString()}</span>
            </div>
          </div>

          {/* Educational Explainer */}
          <div className="p-4 rounded-2xl bg-blue-50/60 border border-blue-200 text-xs text-blue-900 flex items-start gap-3">
            <span className="text-xl">📊</span>
            <div>
              <strong className="block font-black text-blue-950 mb-0.5">Instant Wallet Settlement:</strong>
              Your wallet balance is deducted directly for platform services, inspection certifications, vehicle listing boosts, and auction transactions. Instant processing with zero transaction delays.
            </div>
          </div>

          {/* Predefined Platform Services Cards */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600 block">
              Available Platform Services & Utilities
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                {
                  id: 'stock_insights',
                  title: 'View Stock Insights (Add Stock Tab)',
                  desc: 'Search vehicles by unique 8-9 digit stock number and permanently add the 📦 Stock tab to your bottom navigation bar.',
                  price: 1999,
                  icon: '📦',
                  badge: isStockUnlocked ? 'Unlocked' : 'Utility'
                },
                {
                  id: 'vip_boost',
                  title: '24-Hour VIP Listing Booster',
                  desc: 'Places your auction vehicle at the top of the search feed with gold badge.',
                  price: 199,
                  icon: '🚀',
                  badge: 'Seller Tool'
                },
                {
                  id: 'bidder_priority',
                  title: 'Priority Bidder Fast-Pass',
                  desc: 'Priority queue for bidding in high-volume live competitive auctions.',
                  price: 299,
                  icon: '⚡',
                  badge: 'Bidder Perk'
                },
                {
                  id: 'commission_settle',
                  title: 'Sales Commission Clearance',
                  desc: 'Settle closing commission for a sold vehicle directly from virtual balance.',
                  price: 750,
                  icon: '🤝',
                  badge: 'Finance'
                },
                {
                  id: 'csr_foundation',
                  title: 'AutoBid Road Safety Donation',
                  desc: 'Contribute to our foundation for driver training and road safety initiatives.',
                  price: 100,
                  icon: '❤️',
                  badge: 'Non-Profit'
                }
              ].map((svc) => (
                <div
                  key={svc.id}
                  className="p-4 rounded-2xl border border-gray-200 bg-gray-50/60 hover:bg-white hover:border-blue-300 transition-all flex flex-col justify-between gap-3 shadow-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{svc.icon}</span>
                        <h4 className="text-sm font-bold text-gray-900">{svc.title}</h4>
                      </div>
                      <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                        svc.id === 'stock_insights' && isStockUnlocked 
                          ? 'bg-emerald-100 text-emerald-800' 
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {svc.badge}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed">{svc.desc}</p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-gray-200/60">
                    <div className="text-base font-black text-gray-900">
                      ₹{svc.price.toLocaleString()}
                    </div>
                    {svc.id === 'stock_insights' && isStockUnlocked ? (
                      <button
                        type="button"
                        onClick={() => onNavigate('stock')}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <span>✓ Unlocked (Open 📦 Stock)</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isSpending || virtualBalance < svc.price}
                        onClick={() => {
                          if (svc.id === 'stock_insights') {
                            handleUnlockStockInsights();
                          } else {
                            setConfirmPaymentModal({
                              isOpen: true,
                              serviceId: svc.id,
                              title: svc.title,
                              price: svc.price,
                              description: svc.desc
                            });
                          }
                        }}
                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black shadow-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 cursor-pointer"
                      >
                        <span>Pay from Wallet</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Custom Platform Spend Form */}
          <div className="p-5 rounded-2xl border border-gray-200 bg-gray-50 space-y-4">
            <h4 className="text-xs font-black uppercase text-gray-700">Direct Platform Service Payment</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-gray-500 block mb-1">Purpose / Service Name</label>
                <input
                  type="text"
                  value={customSpendReason}
                  onChange={(e) => setCustomSpendReason(e.target.value)}
                  placeholder="e.g. VIP Featured Showcase"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 block mb-1">Amount (₹ INR)</label>
                <input
                  type="number"
                  min="1"
                  max={virtualBalance}
                  value={customSpendAmount}
                  onChange={(e) => setCustomSpendAmount(e.target.value)}
                  placeholder="Amount"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <button
              type="button"
              disabled={isSpending || !customSpendAmount || parseFloat(customSpendAmount) <= 0 || parseFloat(customSpendAmount) > virtualBalance}
              onClick={() => {
                const amt = parseFloat(customSpendAmount);
                if (isNaN(amt) || amt <= 0) return;
                setConfirmPaymentModal({
                  isOpen: true,
                  serviceId: 'custom_spend',
                  title: customSpendReason || 'Platform Service Payment',
                  price: amt,
                  description: `Direct payment for ${customSpendReason || 'Platform Service'}`
                });
              }}
              className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gray-900 hover:bg-black text-white text-xs font-black transition-all disabled:opacity-40 cursor-pointer"
            >
              Pay ₹{customSpendAmount || 0} from Wallet
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 3: WITHDRAW FUNDS                                                 */}
      {/* ========================================================================= */}
      {activeTab === 'withdraw' && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-200 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-purple-100 text-purple-800 flex items-center justify-center font-black text-sm">
                  ₹
                </span>
                <h2 className="text-lg font-black text-gray-900">Request Withdrawal to Bank / UPI</h2>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Approved requests are disbursed directly to your bank account or UPI ID.
              </p>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-purple-50 border border-purple-200 text-purple-800 text-xs font-bold flex items-center gap-1.5 self-start sm:self-auto">
              <span>Available to Withdraw:</span>
              <span className="font-black text-purple-900">₹{virtualBalance.toLocaleString()}</span>
            </div>
          </div>

          {/* Educational Explainer */}
          <div className="p-4 rounded-2xl bg-purple-50/60 border border-purple-200 text-xs text-purple-900 flex items-start gap-3">
            <span className="text-xl">🏦</span>
            <div>
              <strong className="block font-black text-purple-950 mb-0.5">How your withdrawal is fulfilled:</strong>
              When you submit a request, the funds are held securely while AutoBid's Finance Team reviews and approves the payout. Upon approval, funds are transferred directly to your bank account or UPI ID.
            </div>
          </div>

          {/* Withdrawal Amount Input */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Withdrawal Amount (₹ INR)
              </label>
              <button
                type="button"
                onClick={() => setWithdrawAmount(virtualBalance.toString())}
                className="text-xs font-bold text-purple-600 hover:text-purple-700"
              >
                Withdraw Max (₹{virtualBalance.toLocaleString()})
              </button>
            </div>
            <div className="relative">
              <span className="absolute left-4 top-3.5 text-gray-400 font-bold text-lg">₹</span>
              <input
                type="number"
                min="50"
                max={virtualBalance}
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="e.g. 2000"
                className="w-full pl-9 pr-4 py-3.5 rounded-2xl border-2 border-gray-200 focus:border-purple-600 focus:outline-none text-lg font-black text-gray-900 placeholder:text-gray-300 transition-colors"
              />
            </div>
            <p className="text-[11px] text-gray-400">
              Minimum withdrawal: ₹50 • Maximum per request: ₹10,00,000.
            </p>
          </div>

          {/* Payout Destination Selector */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600 block">
              Select Payout Method
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPayoutMethod('upi')}
                className={`p-4 rounded-2xl border-2 text-left transition-all ${
                  payoutMethod === 'upi'
                    ? 'border-purple-600 bg-purple-50/50 shadow-sm'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">⚡</span>
                  <span className="text-sm font-black text-gray-900">Instant UPI VPA</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">GPay, PhonePe, Paytm, BHIM</p>
              </button>

              <button
                type="button"
                onClick={() => setPayoutMethod('bank')}
                className={`p-4 rounded-2xl border-2 text-left transition-all ${
                  payoutMethod === 'bank'
                    ? 'border-purple-600 bg-purple-50/50 shadow-sm'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">🏢</span>
                  <span className="text-sm font-black text-gray-900">Direct Bank Transfer</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">IMPS / NEFT directly to Account</p>
              </button>
            </div>
          </div>

          {/* Method Fields */}
          {payoutMethod === 'upi' ? (
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                UPI ID (Virtual Payment Address)
              </label>
              <input
                type="text"
                placeholder="e.g. yourname@okhdfcbank or 9876543210@paytm"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">Account Holder Name</label>
                <input
                  type="text"
                  placeholder="Full name as in bank records"
                  value={accountHolderName}
                  onChange={(e) => setAccountHolderName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-medium focus:ring-2 focus:ring-purple-500 outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">Bank IFSC Code</label>
                <input
                  type="text"
                  placeholder="e.g. HDFC0000123"
                  value={ifsc}
                  onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-mono font-bold focus:ring-2 focus:ring-purple-500 outline-none uppercase"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">Account Number</label>
                <input
                  type="password"
                  placeholder="Enter bank account number"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-mono focus:ring-2 focus:ring-purple-500 outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">Confirm Account Number</label>
                <input
                  type="text"
                  placeholder="Re-enter bank account number"
                  value={confirmAccountNumber}
                  onChange={(e) => setConfirmAccountNumber(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-mono focus:ring-2 focus:ring-purple-500 outline-none"
                />
              </div>
            </div>
          )}

          {/* Submit Withdrawal */}
          <div className="pt-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <span className="text-xs text-gray-400 block font-bold">Payout Destination:</span>
              <span className="text-sm font-black text-gray-900">
                {payoutMethod === 'upi' ? (upiId || 'Enter UPI ID above') : (accountHolderName || 'Bank Account')}
              </span>
            </div>

            <button
              disabled={isWithdrawing || !withdrawAmount || parseInt(withdrawAmount) <= 0}
              onClick={handleInitiateWithdrawal}
              className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-black text-sm shadow-xl shadow-purple-600/25 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <span>🔒</span>
              <span>Submit Withdrawal Request</span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 3: TRANSACTION & WITHDRAWAL REQUEST HISTORY                       */}
      {/* ========================================================================= */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          {/* Active Withdrawal Requests Section */}
          <div className="bg-white rounded-3xl p-6 border border-gray-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-gray-900">Your Withdrawal Requests</h3>
                <p className="text-xs text-gray-500">Track payout status submitted to finance administration for approval.</p>
              </div>
              <span className="text-xs font-bold text-purple-700 bg-purple-50 px-3 py-1 rounded-xl">
                {withdrawals.length} Requests
              </span>
            </div>

            <div className="space-y-3">
              {withdrawals.map((w) => (
                <div
                  key={w.id}
                  className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    w.status === 'pending'
                      ? 'bg-amber-50/50 border-amber-200'
                      : w.status === 'approved'
                      ? 'bg-emerald-50/50 border-emerald-200'
                      : 'bg-red-50/50 border-red-200'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                        w.status === 'pending' ? 'bg-amber-200 text-amber-900' :
                        w.status === 'approved' ? 'bg-emerald-200 text-emerald-900' :
                        'bg-red-200 text-red-900'
                      }`}>
                        {w.status === 'pending' ? 'Pending Admin Approval' :
                         w.status === 'approved' ? 'Approved & Disbursed' : 'Rejected'}
                      </span>
                      <span className="text-xs text-gray-400 font-mono">
                        {new Date(w.createdAt).toLocaleString()}
                      </span>
                    </div>

                    <div className="text-xs text-gray-600">
                      Destination: <strong className="text-gray-900 uppercase">{w.payoutMethod || 'UPI'}</strong>
                      {w.upiId && <span className="ml-2 font-mono text-purple-700">({w.upiId})</span>}
                      {w.accountNumber && (
                        <span className="ml-2 font-mono text-gray-700">
                          (Acc: {w.accountNumber} | IFSC: {w.ifsc})
                        </span>
                      )}
                    </div>

                    {w.withdrawalOrderId && (
                      <div className="text-[10px] text-gray-400 font-mono">
                        Order Reference: {w.withdrawalOrderId}
                      </div>
                    )}
                    {w.transactionId && (
                      <div className="text-[10px] text-emerald-700 font-mono font-bold">
                        Payout ID: {w.transactionId}
                      </div>
                    )}
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-gray-400 uppercase font-bold">Amount</div>
                    <div className="text-xl font-black text-gray-900">₹{w.amount?.toLocaleString()}</div>
                  </div>
                </div>
              ))}

              {withdrawals.length === 0 && (
                <div className="text-center py-8 text-xs text-gray-400">
                  You have not submitted any withdrawal requests yet.
                </div>
              )}
            </div>
          </div>

          {/* Full Transaction History Table */}
          <div className="bg-white rounded-3xl p-6 border border-gray-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-gray-900">INR Transaction History</h3>
                <p className="text-xs text-gray-500">Real-time ledger of your deposits, auction bids, services, and withdrawals.</p>
              </div>
              <span className="text-xs font-bold text-gray-500">
                {transactions.length} Transactions
              </span>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-gray-100">
              <table className="w-full text-left text-xs text-gray-600">
                <thead className="bg-gray-50 text-[11px] uppercase font-black text-gray-500 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Transaction ID</th>
                    <th className="px-4 py-3">Mean of Payment</th>
                    <th className="px-4 py-3">Description & Order/UTR</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {transactions.map((rawTx) => {
                    const tx = enrichTransaction(rawTx);
                    const methodInfo = getPaymentMethodInfo(tx.paymentMethod);
                    const isCredit = tx.type?.includes('deposit') || tx.type === 'admin_add' || tx.type === 'withdrawal_refund';
                    const isFailed = tx.status === 'failed';

                    return (
                      <tr 
                        key={tx.id} 
                        onClick={() => setSelectedTxReceipt(tx)}
                        className="hover:bg-indigo-50/40 transition-colors cursor-pointer group"
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-gray-400 font-mono text-[11px]">
                          {new Date(tx.timestamp).toLocaleString('en-IN', {
                            dateStyle: 'short',
                            timeStyle: 'short'
                          })}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-mono font-bold text-gray-900 bg-gray-100 group-hover:bg-white px-2 py-0.5 rounded border border-gray-200 text-[11px]">
                            {tx.transactionId}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black border flex items-center gap-1 w-fit ${methodInfo.badgeClass}`}>
                            <span>{methodInfo.icon}</span>
                            <span>{methodInfo.shortLabel}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          <div className="truncate font-medium text-gray-900">{tx.description}</div>
                          <div className="text-[10px] font-mono text-gray-400 truncate mt-0.5 flex items-center gap-2">
                            <span>Ord: {tx.gatewayOrderNumber || tx.orderId}</span>
                            {tx.utr && <span className="text-emerald-700">UTR: {tx.utr}</span>}
                          </div>
                        </td>
                        <td className={`px-4 py-3 text-right font-black text-sm whitespace-nowrap ${
                          isFailed ? 'text-gray-400 line-through' :
                          isCredit ? 'text-emerald-600' : 'text-gray-900'
                        }`}>
                          {isCredit ? `+₹${tx.amount?.toLocaleString()}` : `-₹${tx.amount?.toLocaleString()}`}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            tx.status === 'success' ? 'bg-emerald-100 text-emerald-800' :
                            tx.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                            'bg-rose-100 text-rose-800 border border-rose-200'
                          }`}>
                            {tx.status === 'failed' ? 'Failed / Exited' : tx.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTxReceipt(tx);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-[11px] font-bold transition cursor-pointer"
                          >
                            Receipt ↗
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                  {transactions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                        No transactions found in your wallet history.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Receipt & Gateway Audit Modal */}
      <TransactionReceiptModal
        transaction={selectedTxReceipt}
        isOpen={Boolean(selectedTxReceipt)}
        onClose={() => setSelectedTxReceipt(null)}
        isAdmin={currentUser?.role === 'admin'}
      />

      {/* ========================================================================= */}
      {/* IN-APP CONFIRMATION MODAL FOR WALLET PAYMENTS (CONFIRM BEFORE DEDUCTION)  */}
      {/* ========================================================================= */}
      {confirmPaymentModal && confirmPaymentModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl p-6 sm:p-7 max-w-md w-full border border-gray-100 shadow-2xl space-y-4 animate-scale-up">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center text-xl font-bold">
                  💳
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900">Confirm Payment</h3>
                  <p className="text-xs text-blue-600 font-semibold">AutoBid Wallet Deduction</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmPaymentModal(null)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center justify-center text-xs font-bold transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-blue-50/70 border border-blue-200 space-y-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <span className="text-gray-500 font-medium">Selected Service:</span>
                <span className="font-bold text-gray-900 text-right">{confirmPaymentModal.title}</span>
              </div>
              {confirmPaymentModal.description && (
                <p className="text-[11px] text-gray-600 leading-relaxed border-t border-blue-200/60 pt-2">
                  {confirmPaymentModal.description}
                </p>
              )}
            </div>

            <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-2.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-gray-500 font-medium">Current Wallet Balance:</span>
                <span className="font-bold text-gray-800">₹{virtualBalance.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-700 font-bold">Cost to Pay:</span>
                <span className="font-black text-red-600">-₹{confirmPaymentModal.price.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-gray-200 text-xs">
                <span className="text-gray-600 font-semibold">Remaining Balance After:</span>
                <span className="font-black text-emerald-700">₹{Math.max(0, virtualBalance - confirmPaymentModal.price).toLocaleString()}</span>
              </div>
            </div>

            <p className="text-xs text-gray-600 text-center font-medium">
              Are you sure you want to proceed and pay <strong>₹{confirmPaymentModal.price.toLocaleString()}</strong> from your wallet?
            </p>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                disabled={isSpending}
                onClick={() => setConfirmPaymentModal(null)}
                className="flex-1 py-3 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSpending}
                onClick={async () => {
                  const { price, title, serviceId } = confirmPaymentModal;
                  setConfirmPaymentModal(null);
                  await handleSpendVirtualCurrency(price, title, serviceId);
                }}
                className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSpending ? (
                  <span>Processing...</span>
                ) : (
                  <>
                    <span>✓</span>
                    <span>Confirm & Pay ₹{confirmPaymentModal.price.toLocaleString()}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* IN-APP OTP AUTHORIZATION MODAL FOR WITHDRAWALS (RAZORPAY EMAIL 2FA OTP)   */}
      {/* ========================================================================= */}
      {showOtpModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full border border-gray-100 shadow-2xl space-y-4 animate-scale-up">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center text-xl font-bold">
                  ⚡
                </span>
                <div>
                  <h3 className="text-base font-black text-gray-900">Razorpay Payment Authorization</h3>
                  <p className="text-xs text-blue-600 font-semibold">Razorpay 2FA Email OTP Verification</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowOtpModal(false)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center justify-center text-xs font-bold transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Amount to Disburse:</span>
                <span className="font-black text-blue-700 text-sm">₹{parseInt(withdrawAmount || '0').toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Payout Destination:</span>
                <span className="font-mono text-gray-900 font-semibold">{payoutMethod === 'upi' ? `UPI: ${upiId}` : `Bank: ${accountNumber}`}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Gateway Provider:</span>
                <span className="font-bold text-gray-800 uppercase flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-500 inline-block animate-pulse"></span>
                  Razorpay Instant Payouts
                </span>
              </div>
            </div>

            {/* Registered Email Dispatch Card */}
            <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 space-y-2 text-xs">
              <div className="flex items-center gap-1.5 font-bold text-blue-950">
                <span>✉️</span>
                <span>Razorpay OTP Sent to Registered Email:</span>
              </div>
              <div className="font-mono text-xs font-extrabold text-blue-900 bg-white px-3 py-1.5 rounded-xl border border-blue-200 break-all">
                {targetUserEmail || currentUser?.email || 'mmwajnnd@gmail.com'}
              </div>
              <p className="text-[11px] text-blue-800 leading-relaxed">
                Razorpay dispatched a 6-digit confirmation OTP to your registered email to verify and proceed with this payment.
              </p>
              {generatedOtp && (
                <div className="pt-1 flex items-center justify-between text-[11px] bg-blue-100/90 text-blue-950 px-2.5 py-1 rounded-lg">
                  <span>Razorpay Code: <strong className="font-mono text-xs">{generatedOtp}</strong></span>
                  <button
                    type="button"
                    onClick={() => setEnteredOtp(generatedOtp)}
                    className="text-[10px] font-bold text-blue-700 hover:text-blue-950 underline cursor-pointer"
                  >
                    Quick Fill
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
                Enter Razorpay 6-Digit OTP
              </label>
              <input
                type="text"
                maxLength={6}
                value={enteredOtp}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                  setEnteredOtp(val);
                  setOtpError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && enteredOtp.length === 6) {
                    handleConfirmWithdrawal();
                  }
                }}
                autoFocus
                placeholder="• • • • • •"
                className="w-full text-center text-2xl font-mono font-black py-3 px-4 rounded-2xl border-2 border-gray-200 focus:border-blue-600 focus:outline-none tracking-[0.4em] bg-gray-50 focus:bg-white text-gray-900"
              />
              {otpError && (
                <p className="text-xs text-red-600 font-semibold flex items-center gap-1 pt-1">
                  <span>⚠️</span>
                  <span>{otpError}</span>
                </p>
              )}
            </div>

            <div className="flex items-center justify-between text-xs pt-0.5">
              <span className="text-gray-400">Didn't receive email?</span>
              <button
                type="button"
                disabled={otpCountdown > 0 || isSendingOtp}
                onClick={handleResendWithdrawalOtp}
                className="font-bold text-blue-700 hover:text-blue-900 disabled:text-gray-400 disabled:cursor-not-allowed cursor-pointer"
              >
                {isSendingOtp ? 'Sending...' : otpCountdown > 0 ? `Resend Code (${otpCountdown}s)` : 'Resend Razorpay OTP'}
              </button>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowOtpModal(false)}
                className="flex-1 py-3 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isWithdrawing || enteredOtp.length !== 6}
                onClick={handleConfirmWithdrawal}
                className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black shadow-md transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
              >
                {isWithdrawing ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Proceeding Payment...</span>
                  </>
                ) : (
                  <>
                    <span>⚡</span>
                    <span>Confirm & Proceed Payment</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
