import { WalletTransaction } from '../types';

/**
 * Normalizes and enriches any transaction with consistent transactionId, paymentMethod,
 * gatewayOrderNumber, UTR, customer phone number, and failure details.
 */
export function enrichTransaction(tx: any): WalletTransaction {
  if (!tx) return tx;

  // 1. Transaction ID resolution
  const rawId = tx.transactionId || tx.paymentId || tx.id || `TXN_${Date.now()}`;
  const transactionId = String(rawId).startsWith('TXN_') || String(rawId).startsWith('pay_')
    ? String(rawId)
    : `TXN_${String(rawId).replace(/[^a-zA-Z0-9_-]/g, '').slice(-12).toUpperCase()}`;

  // 2. Payment Method (Mean of Payment) resolution
  let paymentMethod: 'upi' | 'card' | 'netbanking' | 'bank_transfer' | 'wallet' | 'other' = 'upi';
  let paymentMethodDetails = tx.paymentMethodDetails || '';

  const rawMethod = String(tx.paymentMethod || tx.method || tx.payoutMethod || '').toLowerCase();
  const desc = String(tx.description || '').toLowerCase();
  const type = String(tx.type || '').toLowerCase();

  if (rawMethod.includes('card') || desc.includes('card') || type.includes('card')) {
    paymentMethod = 'card';
    paymentMethodDetails = paymentMethodDetails || 'Card Payment (Visa / MasterCard / RuPay)';
  } else if (rawMethod.includes('netbanking') || rawMethod.includes('net_banking') || desc.includes('net banking') || desc.includes('netbanking')) {
    paymentMethod = 'netbanking';
    paymentMethodDetails = paymentMethodDetails || 'Net Banking (Direct Bank Transfer)';
  } else if (rawMethod.includes('bank') || rawMethod.includes('neft') || rawMethod.includes('rtgs') || rawMethod.includes('imps') || desc.includes('bank')) {
    paymentMethod = 'bank_transfer';
    paymentMethodDetails = paymentMethodDetails || (tx.ifsc ? `Bank Transfer (IFSC: ${tx.ifsc})` : 'Bank Transfer / IMPS');
  } else if (rawMethod.includes('wallet') || type.includes('spend') || type.includes('service') || type.includes('admin') || type.includes('commission')) {
    paymentMethod = 'wallet';
    paymentMethodDetails = paymentMethodDetails || 'AutoBid Virtual Currency Wallet';
  } else if (rawMethod.includes('upi') || desc.includes('upi') || type.includes('deposit') || type.includes('razorpay')) {
    paymentMethod = 'upi';
    paymentMethodDetails = paymentMethodDetails || (tx.upiId ? `UPI Payment (${tx.upiId})` : 'UPI (Unified Payments Interface - GPay / PhonePe / Paytm)');
  }

  // 3. Gateway Order Number resolution
  const gatewayOrderNumber = tx.gatewayOrderNumber || tx.orderId || tx.autobidOrderId || tx.withdrawalOrderId || (tx.paymentId ? `ORD_${String(tx.paymentId).slice(-10)}` : `ORD_${String(transactionId).slice(-10)}`);

  // 4. UTR (Unique Transaction Reference) / RRN resolution
  let utr = tx.utr || tx.rrn || tx.bankRefNum || tx.acquirer_data?.rrn || tx.acquirer_data?.upi_transaction_id;
  if (!utr) {
    // Generate deterministic 12-digit UTR based on transaction id string
    const seed = String(transactionId) + String(tx.timestamp || 1700000000);
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash) + seed.charCodeAt(i);
      hash = hash & hash;
    }
    const positiveHash = Math.abs(hash);
    utr = `23${String(positiveHash).padStart(10, '0').slice(-10)}`;
  }

  // 5. Customer Phone Number resolution
  let phoneNumber = tx.phoneNumber || tx.contact || tx.userPhone || tx.phone;
  if (!phoneNumber) {
    if (tx.username) {
      // Create a deterministic fallback if phone was not explicitly stored in legacy mock
      const uHash = Math.abs(tx.username.split('').reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0) * 1234567);
      phoneNumber = `+91 98${String(uHash).padStart(8, '4').slice(-8)}`;
    } else {
      phoneNumber = '+91 98765 43210';
    }
  }

  // 6. Status and Failure Reason resolution
  const isFailed = tx.status === 'failed' || desc.includes('fail') || desc.includes('cancel') || desc.includes('exit');
  const status: 'success' | 'pending' | 'failed' = isFailed ? 'failed' : (tx.status || 'success');
  const failureReason = tx.failureReason || (isFailed ? (tx.reason || 'User exited payment checkout in-between (Payment Dismissed)') : undefined);

  return {
    ...tx,
    id: tx.id || transactionId,
    transactionId,
    userId: tx.userId || 'system',
    username: tx.username || 'user',
    userEmail: tx.userEmail || tx.email || `${tx.username || 'user'}@autobid.com`,
    phoneNumber,
    type: tx.type || (status === 'failed' ? 'deposit_failed' : 'deposit_razorpay'),
    amount: Number(tx.amount || 0),
    description: tx.description || (status === 'failed' ? 'Failed Deposit Attempt' : 'Wallet Transaction'),
    timestamp: Number(tx.timestamp || Date.now()),
    status,
    paymentMethod,
    paymentMethodDetails,
    paymentId: tx.paymentId || (status === 'failed' ? `pay_failed_${transactionId.slice(-8)}` : transactionId),
    orderId: tx.orderId || gatewayOrderNumber,
    gatewayOrderNumber,
    autobidOrderId: tx.autobidOrderId || gatewayOrderNumber,
    utr,
    failureReason,
    balanceAfter: tx.balanceAfter !== undefined ? tx.balanceAfter : undefined,
    channel: tx.channel || (type.includes('deposit') ? 'ct_account' : 'ct_collection'),
    gatewayResponse: tx.gatewayResponse || {
      gateway: 'Razorpay PG',
      acquirer: paymentMethod === 'upi' ? 'NPCI / Axis Bank' : paymentMethod === 'card' ? 'Visa / HDFC' : 'Direct NetBanking',
      order_id: gatewayOrderNumber,
      payment_id: tx.paymentId || transactionId,
      status: status === 'failed' ? 'failed' : 'captured',
      method: paymentMethod,
      captured: status === 'success',
      utr,
      contact: phoneNumber,
      email: tx.userEmail || `${tx.username || 'user'}@autobid.com`
    }
  };
}

/**
 * Returns UI metadata (Badge color, human label, icon) for a payment method.
 */
export function getPaymentMethodInfo(method?: string) {
  const m = String(method || 'upi').toLowerCase();
  if (m.includes('card')) {
    return {
      label: 'Card Payment',
      shortLabel: 'Card',
      icon: '💳',
      badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 ring-1 ring-blue-100',
      pillClass: 'bg-blue-100 text-blue-800',
      bgColor: 'bg-blue-50',
      textColor: 'text-blue-700',
      borderColor: 'border-blue-200'
    };
  }
  if (m.includes('netbanking') || m.includes('net_banking')) {
    return {
      label: 'Net Banking',
      shortLabel: 'NetBanking',
      icon: '🏦',
      badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 ring-1 ring-amber-100',
      pillClass: 'bg-amber-100 text-amber-800',
      bgColor: 'bg-amber-50',
      textColor: 'text-amber-700',
      borderColor: 'border-amber-200'
    };
  }
  if (m.includes('bank') || m.includes('neft') || m.includes('rtgs') || m.includes('imps')) {
    return {
      label: 'Bank Wire / IMPS',
      shortLabel: 'Bank Transfer',
      icon: '🏛️',
      badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200 ring-1 ring-indigo-100',
      pillClass: 'bg-indigo-100 text-indigo-800',
      bgColor: 'bg-indigo-50',
      textColor: 'text-indigo-700',
      borderColor: 'border-indigo-200'
    };
  }
  if (m.includes('wallet')) {
    return {
      label: 'AutoBid Wallet',
      shortLabel: 'Wallet',
      icon: '👛',
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 ring-1 ring-emerald-100',
      pillClass: 'bg-emerald-100 text-emerald-800',
      bgColor: 'bg-emerald-50',
      textColor: 'text-emerald-700',
      borderColor: 'border-emerald-200'
    };
  }
  // Default: UPI
  return {
    label: 'UPI Payment',
    shortLabel: 'UPI',
    icon: '⚡',
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-200 ring-1 ring-purple-100',
    pillClass: 'bg-purple-100 text-purple-800',
    bgColor: 'bg-purple-50',
    textColor: 'text-purple-700',
    borderColor: 'border-purple-200'
  };
}
