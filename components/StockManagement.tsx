import React, { useState, useEffect, useMemo } from 'react';
import { Vehicle, User, StockRecord, StockCategory, VehicleStatus } from '../types';
import { db, collection, onSnapshot, doc, getDoc } from '../firebase';
import { buildStockRecord, saveStockRecordToFirestore, deleteStockRecordFromFirestore, getVehicleStockCategory } from '../utils/stockHelper';
import { logAdminAction } from './admin/adminAuditHelper';

interface StockManagementProps {
  vehicles: Vehicle[];
  allUsers: User[];
  currentUser?: User | null;
  onSelectVehicle: (vehicle: Vehicle) => void;
  onViewProfile?: (user: User) => void;
  onOpenChat?: (user: User) => void;
  onNavigate: (view: string) => void;
  initialStockQuery?: string;
  onDeleteVehicle?: (vehicleId: string, stockNumber?: string) => Promise<void> | void;
}

export const StockManagement: React.FC<StockManagementProps> = ({
  vehicles,
  allUsers,
  currentUser,
  onSelectVehicle,
  onViewProfile,
  onOpenChat,
  onNavigate,
  initialStockQuery = '',
  onDeleteVehicle
}) => {
  const [stockRecords, setStockRecords] = useState<StockRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'live' | 'sold' | 'upcoming' | 'manual'>('all');
  const [searchQuery, setSearchQuery] = useState(initialStockQuery);
  const [selectedRecord, setSelectedRecord] = useState<StockRecord | null>(null);
  const [copiedStock, setCopiedStock] = useState<string | null>(null);
  const [ownerDetailsModal, setOwnerDetailsModal] = useState<User | null>(null);

  // Admin deletion states
  const [recordToDelete, setRecordToDelete] = useState<StockRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  const isAdmin = Boolean(
    currentUser?.role === 'admin' ||
    currentUser?.email === 'tingurang931@gmail.com' ||
    currentUser?.email === 'mmwajnnd@gmail.com'
  );

  // 1. Listen to real-time 'stock' collection in Firestore
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'stock'), (snapshot) => {
      const records: StockRecord[] = [];
      snapshot.forEach(docSnap => {
        records.push({ id: docSnap.id, ...docSnap.data() } as StockRecord);
      });
      // Sort newest first
      records.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      setStockRecords(records);
      setIsLoading(false);
    }, (err) => {
      console.warn("Stock listener error:", err);
      setIsLoading(false);
    });

    return () => unsub();
  }, []);

  // 2. Self-healing database sync: Ensure all current vehicles exist in the 'stock' database
  useEffect(() => {
    if (vehicles.length === 0) return;

    vehicles.forEach(v => {
      if (deletedIds.has(v.id) || (v.stockNumber && deletedIds.has(v.stockNumber))) return;
      const existingInStock = stockRecords.find(r => r.vehicleId === v.id || r.stockNumber === v.stockNumber);
      if (!existingInStock) {
        const ownerUser = allUsers.find(u => u.id === v.ownerId || (u.username && u.username === v.ownerUsername));
        const record = buildStockRecord(v, ownerUser);
        saveStockRecordToFirestore(record);
      }
    });
  }, [vehicles, stockRecords, allUsers, deletedIds]);

  // Handle direct stock number search if initialStockQuery was passed
  useEffect(() => {
    if (initialStockQuery && stockRecords.length > 0) {
      const exactMatch = stockRecords.find(r => r.stockNumber === initialStockQuery.trim() || r.id === initialStockQuery.trim());
      if (exactMatch) {
        setSelectedRecord(exactMatch);
      }
    }
  }, [initialStockQuery, stockRecords]);

  // Combined records (from Firestore stock collection + fallback from live vehicles)
  const unifiedRecords: StockRecord[] = useMemo(() => {
    const map = new Map<string, StockRecord>();

    // Put firestore stock records
    stockRecords.forEach(r => {
      if (r.stockNumber && !deletedIds.has(r.stockNumber) && (!r.vehicleId || !deletedIds.has(r.vehicleId))) {
        map.set(r.stockNumber, r);
      }
    });

    // Merge or backfill any active vehicles
    vehicles.forEach(v => {
      if (deletedIds.has(v.id) || (v.stockNumber && deletedIds.has(v.stockNumber))) return;
      const sNum = v.stockNumber || (v.id ? v.id.slice(-8) : '');
      if (sNum && !map.has(sNum)) {
        const owner = allUsers.find(u => u.id === v.ownerId || (u.username && u.username === v.ownerUsername));
        map.set(sNum, buildStockRecord(v, owner));
      }
    });

    return Array.from(map.values()).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  }, [stockRecords, vehicles, allUsers, deletedIds]);

  // Handle admin deletion of livestock / stock records
  const handleConfirmDelete = async () => {
    if (!recordToDelete) return;
    setIsDeleting(true);
    const target = recordToDelete;
    try {
      // 1. Mark as deleted in local set immediately
      setDeletedIds(prev => {
        const next = new Set(prev);
        if (target.stockNumber) next.add(target.stockNumber);
        if (target.vehicleId) next.add(target.vehicleId);
        return next;
      });

      // 2. Perform deletion from Firestore and backend
      await deleteStockRecordFromFirestore(target.stockNumber, target.vehicleId);

      // 3. Log admin action for audit trail
      if (currentUser) {
        try {
          await logAdminAction(
            currentUser,
            'DELETE_LIVESTOCK_STOCK',
            'stock',
            target.stockNumber,
            `Admin deleted livestock #${target.stockNumber} (${target.year} ${target.make} ${target.model}, category: ${target.category})`
          );
        } catch (_) {}
      }

      // 4. Update local stock records state
      setStockRecords(prev => prev.filter(r => r.stockNumber !== target.stockNumber && r.vehicleId !== target.vehicleId));

      // 5. Notify parent App so vehicles state and live auctions remove it
      if (onDeleteVehicle) {
        await onDeleteVehicle(target.vehicleId, target.stockNumber);
      }

      // 6. Close dossier modal if the deleted item was open
      if (selectedRecord && (selectedRecord.stockNumber === target.stockNumber || selectedRecord.vehicleId === target.vehicleId)) {
        setSelectedRecord(null);
      }

      setDeleteNotice(`✅ Livestock #${target.stockNumber} (${target.year} ${target.make} ${target.model}) was permanently deleted from stock and live auctions.`);
      setTimeout(() => setDeleteNotice(null), 5000);
      setRecordToDelete(null);
    } catch (err: any) {
      console.error("Failed to delete livestock:", err);
      alert(`Error deleting livestock: ${err?.message || 'Please check permissions or network'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Counts for each category
  const categoryCounts = useMemo(() => {
    return {
      all: unifiedRecords.length,
      live: unifiedRecords.filter(r => r.category === 'live').length,
      sold: unifiedRecords.filter(r => r.category === 'sold').length,
      upcoming: unifiedRecords.filter(r => r.category === 'upcoming').length,
      manual: unifiedRecords.filter(r => r.category === 'manual').length,
    };
  }, [unifiedRecords]);

  // Filtered by tab and search
  const filteredRecords = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return unifiedRecords.filter(r => {
      // Tab filter
      if (activeTab !== 'all' && r.category !== activeTab) {
        return false;
      }

      // Search query (matches stock number, vehicle id, make, model, vin, owner username, phone)
      if (query) {
        const matchesStockNum = (r.stockNumber || '').toLowerCase().includes(query);
        const matchesVehicleId = (r.vehicleId || '').toLowerCase().includes(query);
        const matchesMake = (r.make || '').toLowerCase().includes(query);
        const matchesModel = (r.model || '').toLowerCase().includes(query);
        const matchesVin = (r.vin || '').toLowerCase().includes(query);
        const matchesOwner = (r.ownerUsername || '').toLowerCase().includes(query) || (r.ownerName || '').toLowerCase().includes(query);
        const matchesPhone = (r.ownerPhone || '').toLowerCase().includes(query);

        return matchesStockNum || matchesVehicleId || matchesMake || matchesModel || matchesVin || matchesOwner || matchesPhone;
      }

      return true;
    });
  }, [unifiedRecords, activeTab, searchQuery]);

  // Direct lookup handler
  const handlePerformStockLookup = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = searchQuery.trim();
    if (!clean) return;

    // Search exact or partial stock number
    const match = unifiedRecords.find(r => 
      r.stockNumber === clean || 
      r.stockNumber.toLowerCase() === clean.toLowerCase() ||
      r.vehicleId === clean
    );

    if (match) {
      setSelectedRecord(match);
    } else if (filteredRecords.length > 0) {
      setSelectedRecord(filteredRecords[0]);
    } else {
      alert(`No vehicle found with Stock Number "${clean}". Please verify the 8-9 digit stock ID.`);
    }
  };

  const handleCopyStockNumber = (num: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(num);
    setCopiedStock(num);
    setTimeout(() => setCopiedStock(null), 2500);
  };

  const resolveOwnerUser = (record: StockRecord): User => {
    const found = allUsers.find(u => (record.ownerId && u.id === record.ownerId) || (record.ownerUsername && (u.username || '').toLowerCase() === record.ownerUsername.toLowerCase()));
    if (found) return found;

    return {
      id: record.ownerId || 'user_' + (record.ownerUsername || 'unknown'),
      username: record.ownerUsername || 'owner',
      fullName: record.ownerName || record.ownerUsername || 'Vehicle Owner',
      avatarUrl: record.ownerAvatarUrl || `https://i.pravatar.cc/150?u=${record.ownerUsername || 'owner'}`,
      phoneNumber: record.ownerPhone || '',
      phoneVerified: record.ownerPhoneVerified || false,
      isVerified: record.ownerIsVerified || false,
      verificationStatus: record.ownerVerificationStatus || 'unverified',
      role: record.ownerRole || 'user',
      followers: 0,
      following: 0,
      bio: 'AutoBid Community Vehicle Seller',
      deposits: 0,
      createdAt: record.ownerCreatedAt || record.createdAt
    };
  };

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-5 sm:py-8">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-zinc-900 to-neutral-900 rounded-3xl p-5 sm:p-7 text-white shadow-xl mb-6 relative overflow-hidden border border-white/10">
        <div className="absolute -right-10 -bottom-10 opacity-10 text-9xl select-none pointer-events-none">
          📦
        </div>
        <div className="relative z-10">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2.5">
              <span className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-400/30 flex items-center justify-center text-xl font-bold shadow-inner">
                📦
              </span>
              <div>
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
                  <span>Stock Inventory Database</span>
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                    8-9 Digit Unique Tracking
                  </span>
                </h1>
                <p className="text-xs text-gray-400 mt-0.5">
                  Complete registry of all vehicles with persistent stock tracking, live status, and owner dossier verification.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isAdmin && (
                <span className="text-[10px] bg-red-500/20 text-red-300 border border-red-500/40 px-2.5 py-1 rounded-full font-bold flex items-center gap-1 shadow-xs">
                  <span>🛡️</span>
                  <span>Admin: Livestock Deletion Active</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => onNavigate('sell')}
                className="px-3.5 py-2 bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-700 hover:to-orange-600 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center gap-1.5 cursor-pointer"
              >
                <span>+</span>
                <span>Add Vehicle to Stock</span>
              </button>
            </div>
          </div>

          {/* Quick Stats Pill Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3 mt-4 pt-4 border-t border-white/10">
            <div 
              onClick={() => setActiveTab('all')}
              className={`p-2.5 rounded-xl border cursor-pointer transition ${
                activeTab === 'all' 
                  ? 'bg-white/15 border-amber-400/60 shadow-xs' 
                  : 'bg-white/5 border-white/10 hover:bg-white/10'
              }`}
            >
              <span className="text-[10px] text-gray-400 uppercase font-bold block">Total Stock</span>
              <span className="text-lg font-black text-white">{categoryCounts.all}</span>
            </div>

            <div 
              onClick={() => setActiveTab('live')}
              className={`p-2.5 rounded-xl border cursor-pointer transition ${
                activeTab === 'live' 
                  ? 'bg-red-500/20 border-red-400 shadow-xs' 
                  : 'bg-white/5 border-white/10 hover:bg-white/10'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-red-300 uppercase font-bold block">Livestock (Live)</span>
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
              </div>
              <span className="text-lg font-black text-red-400">{categoryCounts.live}</span>
            </div>

            <div 
              onClick={() => setActiveTab('sold')}
              className={`p-2.5 rounded-xl border cursor-pointer transition ${
                activeTab === 'sold' 
                  ? 'bg-zinc-700/50 border-gray-400 shadow-xs' 
                  : 'bg-white/5 border-white/10 hover:bg-white/10'
              }`}
            >
              <span className="text-[10px] text-gray-300 uppercase font-bold block">Sold Out Stock</span>
              <span className="text-lg font-black text-gray-200">{categoryCounts.sold}</span>
            </div>

            <div 
              onClick={() => setActiveTab('upcoming')}
              className={`p-2.5 rounded-xl border cursor-pointer transition ${
                activeTab === 'upcoming' 
                  ? 'bg-blue-500/20 border-blue-400 shadow-xs' 
                  : 'bg-white/5 border-white/10 hover:bg-white/10'
              }`}
            >
              <span className="text-[10px] text-blue-300 uppercase font-bold block">Upcoming Stock</span>
              <span className="text-lg font-black text-blue-400">{categoryCounts.upcoming}</span>
            </div>

            <div 
              onClick={() => setActiveTab('manual')}
              className={`p-2.5 rounded-xl border cursor-pointer transition col-span-2 sm:col-span-1 ${
                activeTab === 'manual' 
                  ? 'bg-emerald-500/20 border-emerald-400 shadow-xs' 
                  : 'bg-white/5 border-white/10 hover:bg-white/10'
              }`}
            >
              <span className="text-[10px] text-emerald-300 uppercase font-bold block">Manual Listed Stock</span>
              <span className="text-lg font-black text-emerald-400">{categoryCounts.manual}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Feedback Banner */}
      {deleteNotice && (
        <div className="mb-6 p-4 bg-red-950/90 border border-red-500/80 text-white rounded-2xl text-xs flex items-center justify-between shadow-lg animate-fade-in">
          <div className="flex items-center gap-3">
            <span className="text-xl">🗑️</span>
            <span className="font-semibold text-red-100">{deleteNotice}</span>
          </div>
          <button 
            type="button" 
            onClick={() => setDeleteNotice(null)} 
            className="text-red-300 hover:text-white font-bold ml-3 cursor-pointer text-sm"
          >
            ✕
          </button>
        </div>
      )}

      {/* Stock Number Dedicated Search Tool */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-200/90 shadow-sm mb-6">
        <form onSubmit={handlePerformStockLookup} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400 text-sm">
              🔍
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by 8-9 digit Stock Number, VIN, Make, Model, or Owner username..."
              className="w-full pl-10 pr-24 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs sm:text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-24 pr-2 flex items-center text-gray-400 hover:text-gray-600 text-xs"
              >
                ✕
              </button>
            )}
            <button
              type="submit"
              className="absolute right-1 top-1 bottom-1 px-4 bg-amber-500 hover:bg-amber-600 text-amber-950 font-black text-xs rounded-lg transition shadow-xs flex items-center gap-1 cursor-pointer"
            >
              <span>Lookup</span>
            </button>
          </div>

          {/* Quick Filter Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                activeTab === 'all' ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All Stock ({categoryCounts.all})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('live')}
              className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'live' ? 'bg-red-600 text-white shadow-xs' : 'bg-red-50 text-red-700 hover:bg-red-100'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-ping"></span>
              <span>Present Livestock ({categoryCounts.live})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sold')}
              className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                activeTab === 'sold' ? 'bg-gray-800 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Sold Out Stock ({categoryCounts.sold})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('upcoming')}
              className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                activeTab === 'upcoming' ? 'bg-blue-600 text-white shadow-xs' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
              }`}
            >
              Upcoming Stock ({categoryCounts.upcoming})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('manual')}
              className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                activeTab === 'manual' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
              }`}
            >
              Manual Listed ({categoryCounts.manual})
            </button>
          </div>
        </form>
      </div>

      {/* Grid of Stock Records */}
      {isLoading ? (
        <div className="py-20 text-center">
          <div className="animate-spin w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full mx-auto mb-3"></div>
          <p className="text-xs text-gray-500 font-semibold">Loading stock inventory database...</p>
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-gray-300 max-w-md mx-auto">
          <div className="text-4xl mb-3">📦</div>
          <h3 className="font-bold text-gray-900 text-base mb-1">No Matching Stock Records Found</h3>
          <p className="text-xs text-gray-500 mb-5 leading-relaxed">
            {searchQuery 
              ? `No stock item matched "${searchQuery}". Verify the 8-9 digit stock number.` 
              : `There are currently no items in the "${activeTab}" category.`}
          </p>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="px-4 py-2 bg-gray-900 text-white text-xs font-bold rounded-xl hover:bg-black transition cursor-pointer"
            >
              Clear Search Query
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRecords.map((record) => {
            const isLive = record.category === 'live';
            const isSold = record.category === 'sold';
            const isUpcoming = record.category === 'upcoming';
            const isManual = record.category === 'manual';

            return (
              <div
                key={record.id || record.stockNumber}
                onClick={() => setSelectedRecord(record)}
                className="bg-white rounded-2xl border border-gray-200/90 hover:border-amber-400 hover:shadow-lg transition-all duration-200 flex flex-col overflow-hidden cursor-pointer group"
              >
                {/* Top Image & Category Badges */}
                <div className="relative aspect-[16/10] bg-gray-900 overflow-hidden">
                  <img
                    src={record.images?.[record.coverImageIndex || 0] || `https://picsum.photos/seed/${record.vehicleId}/800/500`}
                    alt={`${record.year} ${record.make} ${record.model}`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30"></div>

                  {/* Stock Number Chip on Image */}
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                    <span 
                      onClick={(e) => handleCopyStockNumber(record.stockNumber, e)}
                      className="px-2.5 py-1 rounded-lg bg-amber-500/95 backdrop-blur-md text-amber-950 font-mono font-black text-xs shadow-md border border-amber-300 flex items-center gap-1 cursor-copy"
                      title="Click to copy Stock #"
                    >
                      <span>📦</span>
                      <span>#{record.stockNumber}</span>
                      {copiedStock === record.stockNumber && (
                        <span className="text-[9px] bg-black text-white px-1 rounded ml-0.5">Copied!</span>
                      )}
                    </span>
                  </div>

                  {/* Category Badge & Admin Delete Action on Right */}
                  <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRecordToDelete(record);
                        }}
                        className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-red-600/95 hover:bg-red-700 text-white border border-red-400/60 shadow-md backdrop-blur-md transition flex items-center gap-1 cursor-pointer hover:scale-105 active:scale-95"
                        title={isLive ? "Admin: Delete Present Livestock" : "Admin: Delete Stock Record"}
                      >
                        <span>🗑️</span>
                        <span>{isLive ? 'Delete Livestock' : 'Delete'}</span>
                      </button>
                    )}
                    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider backdrop-blur-md shadow-xs border ${
                      isLive ? 'bg-red-600/90 text-white border-red-400/40 animate-pulse' :
                      isSold ? 'bg-gray-800/90 text-gray-200 border-white/20' :
                      isUpcoming ? 'bg-blue-600/90 text-white border-blue-400/40' :
                      'bg-emerald-600/90 text-white border-emerald-400/40'
                    }`}>
                      {isLive ? '🔴 Present Livestock' :
                       isSold ? '🏁 Sold Out Stock' :
                       isUpcoming ? '📅 Upcoming Stock' :
                       '🏷️ Manual Listed Stock'}
                    </span>
                  </div>

                  {/* Pricing on Image Bottom */}
                  <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-end justify-between text-white">
                    <div>
                      <span className="text-[10px] text-gray-300 font-semibold block uppercase">
                        {isManual ? 'Direct Fixed Price' : isSold ? 'Final Sold Amount' : isUpcoming ? 'Asking Price' : 'Current Bid'}
                      </span>
                      <span className="text-base sm:text-lg font-black text-white">
                        ₹{(record.finalSoldPrice || record.directPrice || record.currentBid || record.startingPrice || 0).toLocaleString()}
                      </span>
                    </div>
                    <span className="text-[11px] text-gray-300 font-mono bg-black/60 px-2 py-0.5 rounded backdrop-blur-xs">
                      {(record.odometer || 0).toLocaleString()} km
                    </span>
                  </div>
                </div>

                {/* Card Content */}
                <div className="p-3.5 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm group-hover:text-amber-600 transition truncate mb-1">
                      {record.year} {record.make} {record.model}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-2.5">
                      <span className="font-mono text-[11px]">VIN: {record.vin}</span>
                      <span>•</span>
                      <span>{record.transmission || 'Automatic'}</span>
                      <span>•</span>
                      <span>{record.fuelType || 'Petrol'}</span>
                    </div>

                    {/* Owner Summary Strip */}
                    <div className="bg-gray-50 rounded-xl p-2.5 border border-gray-100 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <img
                          src={record.ownerAvatarUrl || `https://i.pravatar.cc/150?u=${record.ownerUsername || 'owner'}`}
                          alt={record.ownerUsername || 'owner'}
                          className="w-7 h-7 rounded-full object-cover border border-gray-200 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="font-bold text-gray-900 text-xs truncate">
                              {record.ownerName || `@${record.ownerUsername || 'seller'}`}
                            </span>
                            {record.ownerIsVerified && (
                              <span className="text-emerald-600 text-[11px]" title="ID Verified">🛡️</span>
                            )}
                          </div>
                          <span className="text-[10px] text-gray-500 block truncate">
                            {record.ownerPhone ? `📞 ${record.ownerPhone}` : `@${record.ownerUsername || 'user'}`}
                          </span>
                        </div>
                      </div>

                      <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg shrink-0">
                        View Dossier →
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-500">
                    <span>Location: <strong>{record.location || 'India'}</strong></span>
                    <div className="flex items-center gap-2">
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRecordToDelete(record);
                          }}
                          className="px-2 py-0.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 font-bold border border-red-200 text-[10px] flex items-center gap-1 transition cursor-pointer"
                        >
                          <span>🗑️</span>
                          <span>{isLive ? 'Delete Livestock' : 'Delete Stock'}</span>
                        </button>
                      )}
                      <span className="font-mono text-[10px] text-gray-400">
                        ID: {record.vehicleId}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* COMPREHENSIVE STOCK & OWNER DOSSIER MODAL */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md animate-fade-in">
          <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-scale-up border border-gray-100">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-transparent border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-amber-500 text-amber-950 font-black text-xl flex items-center justify-center shadow-md">
                  📦
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base sm:text-lg font-black font-mono text-gray-900 tracking-wider">
                      Stock #{selectedRecord.stockNumber}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyStockNumber(selectedRecord.stockNumber)}
                      className="px-2 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded text-[10px] font-bold transition cursor-pointer"
                    >
                      {copiedStock === selectedRecord.stockNumber ? 'Copied! ✓' : 'Copy Stock #'}
                    </button>
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-gray-900 text-white">
                      {selectedRecord.category.toUpperCase()} STOCK
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Official database record for {selectedRecord.year} {selectedRecord.make} {selectedRecord.model}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center justify-center text-sm font-bold transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
              
              {/* Top Highlights Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Vehicle Main Image */}
                <div className="sm:col-span-1 rounded-2xl overflow-hidden aspect-[4/3] bg-gray-900 relative shadow-inner">
                  <img
                    src={selectedRecord.images?.[selectedRecord.coverImageIndex || 0] || `https://picsum.photos/seed/${selectedRecord.vehicleId}/600/450`}
                    alt={selectedRecord.model}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-xs text-white text-[10px] font-bold px-2 py-0.5 rounded">
                    {selectedRecord.images?.length || 1} Photo(s)
                  </div>
                </div>

                {/* Primary Stats Panel */}
                <div className="sm:col-span-2 bg-gray-50 rounded-2xl p-4 border border-gray-200/80 flex flex-col justify-between">
                  <div>
                    <h2 className="text-lg font-black text-gray-900 mb-1 leading-snug">
                      {selectedRecord.year} {selectedRecord.make} {selectedRecord.model}
                    </h2>
                    <p className="text-xs text-gray-500 mb-3 font-mono">
                      VIN: <strong className="text-gray-800">{selectedRecord.vin}</strong> • Vehicle ID: {selectedRecord.vehicleId}
                    </p>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-white p-2 rounded-xl border border-gray-100">
                        <span className="text-[10px] text-gray-400 block uppercase font-bold">Category</span>
                        <strong className="text-gray-900">
                          {selectedRecord.category === 'live' ? '🔴 Livestock (Active Auction)' :
                           selectedRecord.category === 'sold' ? '🏁 Sold Out Stock' :
                           selectedRecord.category === 'upcoming' ? '📅 Upcoming Stock' :
                           '🏷️ Manual Listed Stock'}
                        </strong>
                      </div>

                      <div className="bg-white p-2 rounded-xl border border-gray-100">
                        <span className="text-[10px] text-gray-400 block uppercase font-bold">Pricing</span>
                        <strong className="text-amber-800 text-sm">
                          ₹{(selectedRecord.finalSoldPrice || selectedRecord.directPrice || selectedRecord.currentBid || selectedRecord.startingPrice || 0).toLocaleString()}
                        </strong>
                      </div>

                      <div className="bg-white p-2 rounded-xl border border-gray-100">
                        <span className="text-[10px] text-gray-400 block uppercase font-bold">Odometer</span>
                        <strong className="text-gray-900">{(selectedRecord.odometer || 0).toLocaleString()} km</strong>
                      </div>

                      <div className="bg-white p-2 rounded-xl border border-gray-100">
                        <span className="text-[10px] text-gray-400 block uppercase font-bold">Location</span>
                        <strong className="text-gray-900 truncate block">{selectedRecord.location || 'India'}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-gray-200 flex items-center justify-between text-xs">
                    <span className="text-gray-500">
                      Listing Status: <strong className="text-gray-900">{selectedRecord.status}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const targetV = vehicles.find(v => v.id === selectedRecord.vehicleId || v.stockNumber === selectedRecord.stockNumber);
                        if (targetV) {
                          setSelectedRecord(null);
                          onSelectVehicle(targetV);
                        } else {
                          // Assemble vehicle on the fly
                          setSelectedRecord(null);
                          onSelectVehicle({
                            ...selectedRecord,
                            id: selectedRecord.vehicleId,
                            status: selectedRecord.status as VehicleStatus,
                            primaryDamage: selectedRecord.primaryDamage as any,
                            imageSeed: selectedRecord.imageSeed || 100,
                            endTime: selectedRecord.endTime || Date.now() + 7 * 86400000,
                            watchCount: selectedRecord.watchCount || 0,
                            hasKeys: selectedRecord.hasKeys ?? true,
                            engine: selectedRecord.engine || 'N/A',
                            transmission: selectedRecord.transmission || 'Automatic',
                            drive: selectedRecord.drive || 'FWD'
                          });
                        }
                      }}
                      className="px-3 py-1 bg-gray-900 hover:bg-black text-white font-bold rounded-lg text-xs transition cursor-pointer"
                    >
                      Open Full Vehicle Page →
                    </button>
                  </div>
                </div>
              </div>

              {/* COMPLETE OWNER INFORMATION SECTION */}
              <div className="bg-gradient-to-br from-indigo-50/70 via-blue-50/40 to-white rounded-2xl p-4 sm:p-5 border border-indigo-200/80 shadow-xs">
                <div className="flex items-center justify-between mb-3 border-b border-indigo-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">👤</span>
                    <div>
                      <h3 className="font-bold text-gray-900 text-sm">Complete Owner Information</h3>
                      <p className="text-[11px] text-gray-500">Registered owner & verification details linked to Stock #{selectedRecord.stockNumber}</p>
                    </div>
                  </div>

                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                    selectedRecord.ownerIsVerified || selectedRecord.ownerVerificationStatus === 'verified'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : 'bg-amber-100 text-amber-800 border border-amber-300'
                  }`}>
                    {selectedRecord.ownerIsVerified || selectedRecord.ownerVerificationStatus === 'verified' ? '🛡️ ID Verified Seller' : '⚠️ Pending Verification'}
                  </span>
                </div>

                {/* Owner Info Grid */}
                {(() => {
                  const resolvedUser = resolveOwnerUser(selectedRecord);

                  return (
                    <div className="space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-indigo-100">
                        <div className="flex items-center gap-3">
                          <img
                            src={resolvedUser.avatarUrl || `https://i.pravatar.cc/150?u=${resolvedUser.username}`}
                            alt={resolvedUser.username}
                            className="w-12 h-12 rounded-full object-cover border-2 border-indigo-200 shrink-0"
                          />
                          <div>
                            <div className="flex items-center gap-1.5">
                              <h4 className="font-black text-gray-900 text-sm">
                                {resolvedUser.fullName || resolvedUser.username}
                              </h4>
                              <span className="text-xs text-indigo-600 font-bold">@{resolvedUser.username}</span>
                              {resolvedUser.isVerified && (
                                <span className="text-emerald-600 font-bold text-xs" title="Verified Badge">✓</span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Role: <span className="capitalize font-semibold text-gray-800">{resolvedUser.role || 'user'}</span> • Member since {resolvedUser.createdAt ? new Date(resolvedUser.createdAt).toLocaleDateString() : 'Active Member'}
                            </p>
                          </div>
                        </div>

                        {/* Direct Action Buttons for Owner */}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRecord(null);
                              if (onOpenChat) onOpenChat(resolvedUser);
                            }}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1 cursor-pointer"
                          >
                            <span>💬</span>
                            <span>Message Seller</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRecord(null);
                              if (onViewProfile) onViewProfile(resolvedUser);
                            }}
                            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xs rounded-xl transition cursor-pointer"
                          >
                            View Profile
                          </button>
                        </div>
                      </div>

                      {/* Detailed Contact Dossier */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 text-xs">
                        {/* Phone Number with Verification Badge */}
                        <div className="bg-white p-3 rounded-xl border border-indigo-100">
                          <span className="text-[10px] font-bold uppercase text-gray-400 block mb-1">
                            Mobile Phone Number
                          </span>
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-bold text-gray-900 text-xs">
                              {resolvedUser.phoneNumber || selectedRecord.ownerPhone || 'Not Provided'}
                            </span>
                            {(resolvedUser.phoneVerified || selectedRecord.ownerPhoneVerified) ? (
                              <span className="text-[9px] bg-emerald-50 text-emerald-800 font-bold px-1.5 py-0.5 rounded border border-emerald-200 flex items-center gap-0.5">
                                <span>✓</span> OTP Verified
                              </span>
                            ) : (
                              <span className="text-[9px] bg-gray-100 text-gray-500 font-medium px-1.5 py-0.5 rounded">
                                Unverified
                              </span>
                            )}
                          </div>
                          {(resolvedUser.phoneNumber || selectedRecord.ownerPhone) && (
                            <button
                              type="button"
                              onClick={() => {
                                const ph = resolvedUser.phoneNumber || selectedRecord.ownerPhone || '';
                                navigator.clipboard.writeText(ph);
                                alert(`Phone number ${ph} copied to clipboard!`);
                              }}
                              className="text-[10px] text-blue-600 font-bold hover:underline mt-1.5 block cursor-pointer"
                            >
                              Copy Phone Number
                            </button>
                          )}
                        </div>

                        {/* Email Address */}
                        <div className="bg-white p-3 rounded-xl border border-indigo-100">
                          <span className="text-[10px] font-bold uppercase text-gray-400 block mb-1">
                            Email Address
                          </span>
                          <span className="font-mono font-medium text-gray-800 text-xs truncate block">
                            {resolvedUser.email || selectedRecord.ownerEmail || 'private@autobid.com'}
                          </span>
                          <span className="text-[10px] text-gray-400 mt-1.5 block">
                            Account ID: {resolvedUser.id}
                          </span>
                        </div>

                        {/* ID Verification Document Type */}
                        <div className="bg-white p-3 rounded-xl border border-indigo-100">
                          <span className="text-[10px] font-bold uppercase text-gray-400 block mb-1">
                            Identity Verification
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className={`text-xs font-bold ${resolvedUser.isVerified ? 'text-emerald-700' : 'text-amber-700'}`}>
                              {resolvedUser.isVerified ? 'Officially Verified' : 'Standard Account'}
                            </span>
                          </div>
                          <span className="text-[10px] text-gray-500 mt-1 block">
                            Doc: {resolvedUser.idDocumentType ? resolvedUser.idDocumentType.replace('_', ' ').toUpperCase() : 'Government ID'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Complete Vehicle Specifications Table */}
              <div className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-200/90 shadow-xs">
                <h3 className="font-bold text-gray-900 text-sm mb-3 flex items-center gap-2">
                  <span>⚙️</span>
                  <span>Complete Vehicle Specifications</span>
                </h3>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5 text-xs">
                  <div className="border-b border-gray-100 pb-1.5">
                    <span className="text-[10px] text-gray-400 uppercase font-semibold block">Stock Number</span>
                    <strong className="font-mono text-amber-950 font-black">#{selectedRecord.stockNumber}</strong>
                  </div>

                  <div className="border-b border-gray-100 pb-1.5">
                    <span className="text-[10px] text-gray-400 uppercase font-semibold block">Vehicle Number</span>
                    <strong className="text-gray-900">{selectedRecord.vehicleNumber || 'N/A'}</strong>
                  </div>

                  <div className="border-b border-gray-100 pb-1.5">
                    <span className="text-[10px] text-gray-400 uppercase font-semibold block">VIN / Chassis</span>
                    <strong className="font-mono text-gray-900">{selectedRecord.vin}</strong>
                  </div>

                  <div className="border-b border-gray-100 pb-1.5">
                    <span className="text-[10px] text-gray-400 uppercase font-semibold block">Engine</span>
                    <strong className="text-gray-900">{selectedRecord.engine || 'N/A'}</strong>
                  </div>

                  <div className="border-b border-gray-100 pb-1.5">
                    <span className="text-[10px] text-gray-400 uppercase font-semibold block">Transmission</span>
                    <strong className="text-gray-900">{selectedRecord.transmission || 'Automatic'}</strong>
                  </div>

                  <div className="border-b border-gray-100 pb-1.5">
                    <span className="text-[10px] text-gray-400 uppercase font-semibold block">Fuel Type</span>
                    <strong className="text-gray-900">{selectedRecord.fuelType || 'Petrol'}</strong>
                  </div>

                  <div className="border-b border-gray-100 pb-1.5">
                    <span className="text-[10px] text-gray-400 uppercase font-semibold block">Registration Card (RC)</span>
                    <strong className={selectedRecord.hasRegistrationCard ? 'text-emerald-700' : 'text-gray-500'}>
                      {selectedRecord.hasRegistrationCard ? `Available ${selectedRecord.rcCardNumber ? `(${selectedRecord.rcCardNumber})` : ''}` : 'Not Available'}
                    </strong>
                  </div>

                  <div className="border-b border-gray-100 pb-1.5">
                    <span className="text-[10px] text-gray-400 uppercase font-semibold block">Damage Condition</span>
                    <strong className="text-gray-900">{selectedRecord.primaryDamage || 'Normal Wear'}</strong>
                  </div>

                  <div className="border-b border-gray-100 pb-1.5">
                    <span className="text-[10px] text-gray-400 uppercase font-semibold block">Insurance Status</span>
                    <strong className={selectedRecord.isUnderInsurance ? 'text-emerald-700' : 'text-gray-500'}>
                      {selectedRecord.isUnderInsurance ? 'Active Insurance' : 'Not Insured'}
                    </strong>
                  </div>
                </div>

                {selectedRecord.description && (
                  <div className="mt-3.5 pt-3 border-t border-gray-100">
                    <span className="text-[10px] text-gray-400 uppercase font-semibold block mb-1">Seller Notes & Description</span>
                    <p className="text-xs text-gray-600 bg-gray-50 p-2.5 rounded-xl border border-gray-100 leading-relaxed">
                      {selectedRecord.description}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">
                  Stock ID: <strong className="font-mono text-gray-800">#{selectedRecord.stockNumber}</strong>
                </span>
              </div>

              <div className="flex items-center gap-2">
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setRecordToDelete(selectedRecord)}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-md transition cursor-pointer flex items-center gap-1.5"
                  >
                    <span>🗑️</span>
                    <span>{selectedRecord.category === 'live' ? 'Delete Present Livestock' : 'Delete Stock Item'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedRecord(null)}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-bold rounded-xl transition cursor-pointer"
                >
                  Close Dossier
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const targetV = vehicles.find(v => v.id === selectedRecord.vehicleId || v.stockNumber === selectedRecord.stockNumber);
                    setSelectedRecord(null);
                    if (targetV) {
                      onSelectVehicle(targetV);
                    }
                  }}
                  className="px-5 py-2 bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-700 hover:to-orange-600 text-white text-xs font-bold rounded-xl shadow-md transition cursor-pointer"
                >
                  View Vehicle Detail
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ADMIN DELETE CONFIRMATION MODAL */}
      {recordToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-red-200 animate-scale-up">
            <div className="w-14 h-14 rounded-2xl bg-red-100 text-red-600 text-2xl flex items-center justify-center mx-auto mb-4 shadow-inner">
              🗑️
            </div>
            <h3 className="text-xl font-black text-gray-950 text-center mb-1">
              {recordToDelete.category === 'live' ? 'Delete Present Livestock?' : 'Delete Stock Record?'}
            </h3>
            <p className="text-xs text-gray-500 text-center mb-5 leading-relaxed">
              You are about to permanently remove this vehicle from the stock inventory, live auctions, search index, and database. This action is irreversible.
            </p>

            <div className="bg-red-50/70 border border-red-200/80 rounded-2xl p-4 mb-5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 font-medium">Stock Number:</span>
                <span className="font-mono font-black text-red-950">#{recordToDelete.stockNumber}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 font-medium">Vehicle:</span>
                <span className="font-bold text-gray-900">{recordToDelete.year} {recordToDelete.make} {recordToDelete.model}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 font-medium">Category:</span>
                <span className="font-bold text-red-700">
                  {recordToDelete.category === 'live' ? '🔴 Present Livestock (Live Auction)' : recordToDelete.category.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 font-medium">VIN:</span>
                <span className="font-mono text-gray-700">{recordToDelete.vin || 'N/A'}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 font-medium">Listed By:</span>
                <span className="font-medium text-gray-800">@{recordToDelete.ownerUsername || 'seller'}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setRecordToDelete(null)}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl transition cursor-pointer disabled:opacity-50"
              >
                Cancel / Keep
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-red-600/30 transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <span>🗑️ Confirm Delete</span>
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
