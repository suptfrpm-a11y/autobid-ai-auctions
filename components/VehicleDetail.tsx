import React, { useState, useEffect, useRef } from 'react';
import { Vehicle, User } from '../types';
import { generateVehicleAnalysis } from '../services/geminiService';
import { IdentityVerificationModal } from './IdentityVerificationModal';
import { playBidClickSound, playUserBidPlacedSound } from '../utils/soundEffects';
import { db, doc, updateDoc, getDoc } from '../firebase';

interface VehicleDetailProps {
  vehicle: Vehicle;
  onBack: () => void;
  onPlaceBid: (amount: number) => void;
  onPlaceUpcomingBid?: () => void;
  onMarkSold?: () => void;
  onConvertToDirectSale?: (vehicleId: string, directPrice: number) => void;
  currentUser?: User;
  t: any;
  onViewProfile?: (user: User) => void;
  onFollowToggle?: (user: User) => void;
  allUsers?: User[];
  isFollowLoading?: boolean;
  onOpenChat?: (user: User) => void;
  onMessageSeller?: (sellerUsername: string) => void;
  onUpdateVehicle?: (patch: Partial<Vehicle>) => void;
}

export const VehicleDetail: React.FC<VehicleDetailProps> = ({ 
  vehicle, 
  onBack, 
  onPlaceBid, 
  onPlaceUpcomingBid,
  onMarkSold, 
  onConvertToDirectSale,
  currentUser, 
  t,
  onViewProfile,
  onFollowToggle,
  allUsers,
  isFollowLoading = false,
  onOpenChat,
  onMessageSeller,
  onUpdateVehicle
}) => {
  const formatPrice = (val: any): string => {
    const num = Number(val);
    return (isNaN(num) ? 0 : num).toLocaleString();
  };

  // Default 0.1% increase helper: makes the user the leading bidder with exactly 0.1% default increase
  const calculateDefaultIncrement = (currentBid: number = 0): number => {
    const base = Number(currentBid) || 0;
    return Math.max(1, Math.ceil(base * 0.001));
  };

  const calculateDefaultLeadingBid = (currentBid: number = 0): number => {
    const base = Number(currentBid) || 0;
    return base + calculateDefaultIncrement(base);
  };

  const [bidAmount, setBidAmount] = useState<number>(() => calculateDefaultLeadingBid(vehicle.currentBid || vehicle.startingPrice || 0));
  
  // 1-Click fast bidding state (bypasses confirmation modal)
  const [oneClickBidEnabled, setOneClickBidEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('autobid_one_click_bid') === 'true';
    } catch {
      return false;
    }
  });

  const [rememberOneClickInModal, setRememberOneClickInModal] = useState<boolean>(false);
  const prevBidRef = useRef<number>(vehicle.currentBid || vehicle.startingPrice || 0);

  const [analysis, setAnalysis] = useState<string | null>(null);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
  const [showBidModal, setShowBidModal] = useState(false);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [showDirectShiftModal, setShowDirectShiftModal] = useState(false);
  const [newDirectPrice, setNewDirectPrice] = useState<number>(
    vehicle.directPrice || vehicle.startingPrice || vehicle.currentBid || 100000
  );
  const [currentTimeLeft, setCurrentTimeLeft] = useState<string>('');
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [showRcModal, setShowRcModal] = useState(false);
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState<boolean>(false);
  const [likesList, setLikesList] = useState<any[]>(vehicle.likesList || []);
  const [wishlistUsers, setWishlistUsers] = useState<any[]>(vehicle.wishlistUsers || []);
  const [viewersList, setViewersList] = useState<any[]>(vehicle.viewersList || []);
  const [viewsCount, setViewsCount] = useState<number>(() => Math.max(vehicle.views || 0, (vehicle.viewersList || []).length));
  const [engagementModal, setEngagementModal] = useState<{ type: 'likes' | 'wishlist' | 'views' } | null>(null);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [likeHeartAnim, setLikeHeartAnim] = useState<boolean>(false);

  // Sync state whenever incoming vehicle prop changes from Firestore
  useEffect(() => {
    if (vehicle.likesList) setLikesList(vehicle.likesList);
    if (vehicle.wishlistUsers) setWishlistUsers(vehicle.wishlistUsers);
    if (vehicle.viewersList) setViewersList(vehicle.viewersList);
    if (typeof vehicle.views === 'number') {
      setViewsCount(prev => Math.max(prev, vehicle.views || 0));
    }
  }, [vehicle.id, vehicle.views, vehicle.likesCount, vehicle.interestedCount, vehicle.watchCount]);

  const isLiked = Boolean(currentUser?.id && likesList.some(u => u.userId === currentUser.id));
  const isWishlisted = Boolean(currentUser?.id && wishlistUsers.some(u => u.userId === currentUser.id));
  const likesCount = likesList.length || vehicle.likesCount || 0;
  const wishlistCount = wishlistUsers.length || vehicle.interestedCount || vehicle.watchCount || 0;

  // Real-time visit recording: when user visits any vehicle post, count increments and viewer is added
  useEffect(() => {
    if (!vehicle?.id) return;

    // Immediately increment local view count upon opening this vehicle post
    const baseViews = Math.max(vehicle.views || 0, (vehicle.viewersList || []).length);
    const nextViews = baseViews + 1;
    setViewsCount(nextViews);

    const viewerObj = {
      userId: currentUser?.id || `viewer_${Date.now()}`,
      username: currentUser?.username || 'Verified Member',
      fullName: currentUser?.fullName || currentUser?.username || 'AutoBid Member',
      avatarUrl: currentUser?.avatarUrl || '',
      timestamp: Date.now()
    };

    const existingList = vehicle.viewersList || viewersList || [];
    const nextViewers = [
      viewerObj,
      ...existingList.filter(u => currentUser?.id ? u.userId !== currentUser.id : true)
    ].slice(0, 100);

    setViewersList(nextViewers);

    if (onUpdateVehicle) {
      onUpdateVehicle({
        views: nextViews,
        viewersList: nextViewers
      });
    }

    const persistRealView = async () => {
      try {
        const vRef = doc(db, 'vehicles', vehicle.id);
        const vSnap = await getDoc(vRef);
        let finalViews = nextViews;
        let finalViewers = nextViewers;
        if (vSnap.exists()) {
          const d = vSnap.data();
          finalViews = Math.max((d.views || 0) + 1, nextViews);
          const currentDbViewers = d.viewersList || [];
          finalViewers = [
            viewerObj,
            ...currentDbViewers.filter((u: any) => currentUser?.id ? u.userId !== currentUser.id : true)
          ].slice(0, 100);
        }
        await updateDoc(vRef, {
          views: finalViews,
          viewersList: finalViewers
        });
      } catch (err) {
        console.warn("View record warn:", err);
      }
    };

    persistRealView();
  }, [vehicle.id]);

  const handleToggleLike = async () => {
    if (!currentUser?.id) {
      alert("Please sign in to like this vehicle post.");
      return;
    }
    const alreadyLiked = likesList.some(u => u.userId === currentUser.id);
    let nextList: any[];
    if (alreadyLiked) {
      nextList = likesList.filter(u => u.userId !== currentUser.id);
    } else {
      setLikeHeartAnim(true);
      setTimeout(() => setLikeHeartAnim(false), 400);
      nextList = [
        {
          userId: currentUser.id,
          username: currentUser.username,
          fullName: currentUser.fullName || currentUser.username,
          avatarUrl: currentUser.avatarUrl || '',
          timestamp: Date.now()
        },
        ...likesList.filter(u => u.userId !== currentUser.id)
      ];
    }
    setLikesList(nextList);
    if (onUpdateVehicle) {
      onUpdateVehicle({
        likesList: nextList,
        likesCount: nextList.length
      });
    }
    try {
      await updateDoc(doc(db, 'vehicles', vehicle.id), {
        likesList: nextList.slice(0, 150),
        likesCount: nextList.length
      });
    } catch (err) {
      console.warn("Error updating likes:", err);
    }
  };

  const handleToggleWishlist = async () => {
    if (!currentUser?.id) {
      alert("Please sign in to save this vehicle to your wishlist.");
      return;
    }
    const alreadySaved = wishlistUsers.some(u => u.userId === currentUser.id);
    let nextList: any[];
    if (alreadySaved) {
      nextList = wishlistUsers.filter(u => u.userId !== currentUser.id);
    } else {
      nextList = [
        {
          userId: currentUser.id,
          username: currentUser.username,
          fullName: currentUser.fullName || currentUser.username,
          avatarUrl: currentUser.avatarUrl || '',
          timestamp: Date.now()
        },
        ...wishlistUsers.filter(u => u.userId !== currentUser.id)
      ];
    }
    setWishlistUsers(nextList);
    if (onUpdateVehicle) {
      onUpdateVehicle({
        wishlistUsers: nextList,
        watchCount: nextList.length,
        interestedCount: nextList.length
      });
    }
    try {
      await updateDoc(doc(db, 'vehicles', vehicle.id), {
        wishlistUsers: nextList.slice(0, 150),
        watchCount: nextList.length,
        interestedCount: nextList.length
      });
    } catch (err) {
      console.warn("Error updating wishlist:", err);
    }
  };

  const handleSharePost = async () => {
    const shareTitle = `${vehicle.year} ${vehicle.make} ${vehicle.model} on AutoBid`;
    const shareText = `Check out this ${vehicle.year} ${vehicle.make} ${vehicle.model} on AutoBid! Current Bid: ₹${(vehicle.currentBid || vehicle.startingPrice || 0).toLocaleString()}`;
    const shareUrl = window.location.href;

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl
        });
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareToast("Vehicle post link copied to clipboard!");
      setTimeout(() => setShareToast(null), 2500);
    } catch {
      alert(`Vehicle post URL: ${shareUrl}`);
    }
  };

  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const thumbnailContainerRef = useRef<HTMLDivElement | null>(null);
  const thumbnailRefs = useRef<(HTMLDivElement | null)[]>([]);

  const now = Date.now();
  const isDirectSale = vehicle.listingType === 'direct' || vehicle.status === 'Direct Sale' || (vehicle.status as any) === 'Direct Sale';
  const isBlacklisted = vehicle.status === 'Blacklisted' || vehicle.isBlacklisted;
  const isUpcoming = !isDirectSale && ((vehicle.startTime && vehicle.startTime > now) || vehicle.status === 'Upcoming');
  const isEnded = !isDirectSale && (vehicle.status === 'Sold' || (!isUpcoming && vehicle.endTime <= now));
  const isLive = !isDirectSale && !isUpcoming && !isEnded;
  const isOwner = Boolean(currentUser && currentUser.id && vehicle.ownerId === currentUser.id);
  const isUnsoldAuction = !isDirectSale && isEnded && vehicle.status !== 'Sold' && (!vehicle.winningUserId || vehicle.currentBid === vehicle.startingPrice);

  const sellerUser: User | undefined = allUsers?.find(u => 
    (vehicle.ownerId && u.id === vehicle.ownerId) || 
    (vehicle.ownerUsername && (u.username || '').toLowerCase() === vehicle.ownerUsername.toLowerCase())
  );

  const isFollowingSeller = Boolean(
    currentUser?.followingIds && (
      (vehicle.ownerId && currentUser.followingIds.includes(vehicle.ownerId)) ||
      (sellerUser?.id && currentUser.followingIds.includes(sellerUser.id))
    )
  );

  const sellerFollowsMe = Boolean(
    (sellerUser?.followingIds && currentUser?.id && sellerUser.followingIds.includes(currentUser.id)) ||
    (currentUser?.followersIds && (
      (vehicle.ownerId && currentUser.followersIds.includes(vehicle.ownerId)) ||
      (sellerUser?.id && currentUser.followersIds.includes(sellerUser.id))
    ))
  );

  const resolvedSeller: User = sellerUser || {
    id: vehicle.ownerId || 'seller_' + (vehicle.ownerUsername || 'user'),
    username: vehicle.ownerUsername || 'seller',
    fullName: vehicle.ownerUsername ? `@${vehicle.ownerUsername}` : 'Vehicle Seller',
    avatarUrl: `https://i.pravatar.cc/150?u=${vehicle.ownerUsername || vehicle.ownerId || 'seller'}`,
    followers: 0,
    following: 0,
    bio: 'Vehicle Seller on AutoBid'
  };

  const askingPrice = vehicle.startingPrice || vehicle.currentBid || 0;
  const upcomingBids = vehicle.upcomingBids || [];
  const lastPreBidder = upcomingBids.length > 0 ? upcomingBids[upcomingBids.length - 1] : null;
  const hasUserPreBid = currentUser ? upcomingBids.some(b => b.userId === currentUser.id) : false;
  const isUserLeadingPreBid = lastPreBidder && currentUser && lastPreBidder.userId === currentUser.id;

  const galleryImages = (vehicle.images && vehicle.images.length > 0)
    ? vehicle.images
    : [0, 1, 2, 3].map((i) => `https://picsum.photos/id/${vehicle.imageSeed + i}/1200/800`);

  const initialCover = (vehicle.images && vehicle.images.length > 0)
    ? (vehicle.coverImageIndex !== undefined && vehicle.images[vehicle.coverImageIndex] ? vehicle.images[vehicle.coverImageIndex] : vehicle.images[0])
    : galleryImages[0];

  const [mainImage, setMainImage] = useState<string>(initialCover);

  useEffect(() => {
    const cover = (vehicle.images && vehicle.images.length > 0)
      ? (vehicle.coverImageIndex !== undefined && vehicle.images[vehicle.coverImageIndex] ? vehicle.images[vehicle.coverImageIndex] : vehicle.images[0])
      : `https://picsum.photos/id/${vehicle.imageSeed}/1200/800`;
    setMainImage(cover);
    setBidAmount(calculateDefaultLeadingBid(vehicle.currentBid || vehicle.startingPrice || 0));
  }, [vehicle]);

  const currentImageIndex = Math.max(0, galleryImages.indexOf(mainImage));

  const handlePrevImage = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const nextIdx = (currentImageIndex - 1 + galleryImages.length) % galleryImages.length;
    setMainImage(galleryImages[nextIdx]);
  };

  const handleNextImage = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const nextIdx = (currentImageIndex + 1) % galleryImages.length;
    setMainImage(galleryImages[nextIdx]);
  };

  // Auto right-to-left slide interval (advances smoothly every 3.8s when not paused)
  useEffect(() => {
    if (galleryImages.length <= 1 || isAutoScrollPaused || isLightboxOpen) return;
    const interval = setInterval(() => {
      setMainImage((prev) => {
        const idx = galleryImages.indexOf(prev);
        const nextIdx = (idx + 1) % galleryImages.length;
        return galleryImages[nextIdx];
      });
    }, 3800);
    return () => clearInterval(interval);
  }, [galleryImages, isAutoScrollPaused, isLightboxOpen]);

  // Auto-scroll only the horizontal thumbnail container without altering the window's vertical scroll position
  useEffect(() => {
    const activeThumb = thumbnailRefs.current[currentImageIndex];
    const container = thumbnailContainerRef.current;
    if (activeThumb && container) {
      const targetLeft = activeThumb.offsetLeft - (container.clientWidth / 2) + (activeThumb.clientWidth / 2);
      container.scrollTo({
        left: targetLeft,
        behavior: 'smooth'
      });
    }
  }, [currentImageIndex]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
    setIsAutoScrollPaused(true);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current !== null && touchStartYRef.current !== null) {
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const diffX = touchStartXRef.current - touchEndX;
      const diffY = touchStartYRef.current - touchEndY;
      
      // Only trigger horizontal swipe if movement is predominantly horizontal
      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 35) {
        if (diffX > 0) {
          // Swipe right-to-left -> Next image
          const nextIdx = (currentImageIndex + 1) % galleryImages.length;
          setMainImage(galleryImages[nextIdx]);
        } else {
          // Swipe left-to-right -> Prev image
          const prevIdx = (currentImageIndex - 1 + galleryImages.length) % galleryImages.length;
          setMainImage(galleryImages[prevIdx]);
        }
      }
    }
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    // Resume auto-scroll after user interaction pauses
    const resumeTimer = setTimeout(() => {
      setIsAutoScrollPaused(false);
    }, 4500);
    return () => clearTimeout(resumeTimer);
  };

  useEffect(() => {
    const formatDiff = (diffMs: number) => {
      if (diffMs <= 0) return '0m 0s';
      const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
      const pad = (n: number) => n.toString().padStart(2, '0');

      if (days > 0) return `${days}d ${hours}h ${pad(minutes)}m`;
      if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
      return `${pad(minutes)}m ${pad(seconds)}s`;
    };

    const updateTimer = () => {
      const currentNow = Date.now();
      if (isEnded) {
        setCurrentTimeLeft('Auction Ended');
      } else if (isUpcoming) {
        const diff = (vehicle.startTime || currentNow) - currentNow;
        setCurrentTimeLeft(diff > 0 ? `Starts in ${formatDiff(diff)}` : 'Starting now...');
      } else {
        const diff = vehicle.endTime - currentNow;
        setCurrentTimeLeft(diff > 0 ? formatDiff(diff) : 'Ended');
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [vehicle, isUpcoming, isEnded]);

  // 1. Trigger crisp mechanical click sound whenever vehicle currentBid updates (from any user in real-time)
  useEffect(() => {
    const cur = vehicle.currentBid || vehicle.startingPrice || 0;
    if (prevBidRef.current !== undefined && cur > prevBidRef.current) {
      playBidClickSound();
      // Auto-recalculate suggested bidAmount with default 0.1% increase (makes user leading bidder)
      setBidAmount(calculateDefaultLeadingBid(cur));
    }
    prevBidRef.current = cur;
  }, [vehicle.currentBid, vehicle.startingPrice]);

  // 2. Set default 0.1% leading bid
  const handleSetDefaultLeadingBid = () => {
    setBidAmount(calculateDefaultLeadingBid(vehicle.currentBid || vehicle.startingPrice || 0));
  };

  // 3. Quick percentage stake increase
  const handleQuickPercentBoost = (pct: number) => {
    const base = vehicle.currentBid || vehicle.startingPrice || 0;
    const boost = Math.max(1, Math.ceil(base * pct));
    setBidAmount(base + boost);
  };

  // 4. Random stake boost: Generates an unpredictable random bump (+0.2% to +2.0%) to outbid competitors
  const handleRandomBoost = () => {
    const base = vehicle.currentBid || vehicle.startingPrice || 0;
    const baseIncrement = calculateDefaultIncrement(base);
    // Random factor between 2x and 18x the 0.1% minimum (approx 0.2% - 1.8% boost)
    const factor = 2 + Math.floor(Math.random() * 16);
    let boost = baseIncrement * factor;
    // Pretty rounding
    if (boost > 500) {
      boost = Math.round(boost / 50) * 50;
    } else if (boost > 50) {
      boost = Math.round(boost / 10) * 10;
    }
    const finalBoost = Math.max(baseIncrement + 1, boost);
    setBidAmount(base + finalBoost);
  };

  const toggleOneClickBid = (enabled: boolean) => {
    setOneClickBidEnabled(enabled);
    try {
      localStorage.setItem('autobid_one_click_bid', enabled ? 'true' : 'false');
    } catch {}
  };

  const handleGenerateAnalysis = async () => {
    setIsLoadingAnalysis(true);
    const result = await generateVehicleAnalysis(vehicle);
    setAnalysis(result);
    setIsLoadingAnalysis(false);
  };

  const executeBid = (targetAmount: number) => {
    const currBid = vehicle.currentBid || vehicle.startingPrice || 0;
    if (targetAmount <= currBid) {
      alert(`Your bid must be higher than the current bid of ₹${formatPrice(currBid)}`);
      return;
    }
    if (currentUser && vehicle.ownerId && vehicle.ownerId === currentUser.id) {
      alert("You cannot place bids on your own vehicle listing.");
      return;
    }
    if (currentUser && !currentUser.isVerified) {
      setShowVerificationModal(true);
      return;
    }

    // Instantly prepare next +0.1% leading stake so rapid repeated taps/clicks execute in milliseconds without waiting
    const nextInc = Math.max(1, Math.ceil(targetAmount * 0.001));
    setBidAmount(targetAmount + nextInc);

    onPlaceBid(targetAmount);
  };

  const handleBidSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const currBid = vehicle.currentBid || vehicle.startingPrice || 0;
    if (bidAmount <= currBid) {
      alert(`Your bid must be higher than the current bid of ₹${formatPrice(currBid)}`);
      return;
    }
    if (currentUser && vehicle.ownerId && vehicle.ownerId === currentUser.id) {
      alert("You cannot place bids on your own vehicle listing.");
      return;
    }
    if (currentUser && !currentUser.isVerified) {
      setShowVerificationModal(true);
      return;
    }

    // 1-Click Fast Bidding bypasses confirmation modal
    if (oneClickBidEnabled) {
      executeBid(bidAmount);
    } else {
      setShowBidModal(true);
    }
  };

  const handleConfirmBid = () => {
    if (rememberOneClickInModal) {
      toggleOneClickBid(true);
    }
    setShowBidModal(false);
    executeBid(bidAmount);
  };

  const handleUpcomingBidClick = () => {
    if (currentUser && vehicle.ownerId && vehicle.ownerId === currentUser.id) {
      alert("You cannot place bids on your own vehicle listing.");
      return;
    }
    if (currentUser && !currentUser.isVerified) {
      setShowVerificationModal(true);
      return;
    }
    if (onPlaceUpcomingBid) {
      onPlaceUpcomingBid();
    }
  };

  const renderBiddingCard = () => (
    <div className={`glass-panel p-4 sm:p-5 rounded-xl lg:sticky lg:top-20 border-t-4 ${
      isDirectSale ? 'border-t-emerald-500' :
      isUpcoming ? 'border-t-blue-500' :
      isEnded ? 'border-t-gray-500' : 'border-t-red-500'
    }`}>
      <h1 className="text-lg sm:text-xl font-bold text-gray-900 mb-1.5 leading-snug">
        {vehicle.year} {vehicle.make} {vehicle.model}
      </h1>
      
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500 mb-4">
        <span className={`font-bold px-2 py-0.5 rounded text-[10px] border ${
          isDirectSale ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
          isUpcoming ? 'bg-blue-50 text-blue-700 border-blue-200' :
          isEnded ? 'bg-gray-100 text-gray-700 border-gray-200' :
          'bg-red-50 text-red-700 border-red-200'
        }`}>
          {isDirectSale ? '🏷️ Vehicles For Sale (Direct)' : isUpcoming ? '📅 Upcoming Auction' : isEnded ? '🏁 Auction Concluded' : '🔴 Live Auction'}
        </span>
        <span className="px-2 py-0.5 bg-amber-50 text-amber-900 border border-amber-300 font-mono font-bold rounded text-[10px] flex items-center gap-1 shadow-2xs" title="Unique 8-9 Digit Stock Inventory Number">
          <span>📦 Stock #:</span>
          <span className="font-black">{vehicle.stockNumber || (vehicle.id ? vehicle.id.slice(-8) : 'N/A')}</span>
        </span>
        <span className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px]">Lot #: {vehicle.id}</span>
        <span className="font-mono text-gray-500 text-[10px] ml-auto">
          {isDirectSale ? '3 Months Valid' : currentTimeLeft}
        </span>
      </div>

      {/* Price Display */}
      <div className="bg-gray-50/80 p-3.5 rounded-xl mb-4 border border-gray-100">
          <div className="flex justify-between items-baseline mb-1">
           <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
             {isDirectSale ? 'Fixed Asking Price' : isUpcoming ? 'Asking Price' : t.currentBid}
           </span>
           <span className="text-2xl font-black text-gray-900 tracking-tight">
             ₹{formatPrice(isDirectSale ? (vehicle.directPrice || vehicle.startingPrice || vehicle.currentBid) : isUpcoming ? askingPrice : (vehicle.currentBid || vehicle.startingPrice))}
           </span>
         </div>
         {vehicle.buyNowPrice && !isDirectSale && (
            <div className="flex justify-between items-center text-xs mt-2 pt-2 border-t border-gray-200">
              <span className="text-gray-500 font-medium">{t.buyNow}</span>
              <span className="font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">₹{formatPrice(vehicle.buyNowPrice)}</span>
            </div>
         )}
         {isLive && vehicle.winningUsername && (
            <div className="flex justify-between items-center text-xs mt-2 pt-2 border-t border-gray-200">
              <span className="text-gray-500 font-medium">Leading Bidder</span>
              <span className="font-semibold text-indigo-600">@{vehicle.winningUsername}</span>
            </div>
         )}
         {vehicle.firstBidderUsername && !isDirectSale && (
            <div className="flex justify-between items-center text-xs mt-1 text-gray-500">
              <span>1st Bidder (from Upcoming)</span>
              <span className="font-medium text-emerald-600">@{vehicle.firstBidderUsername}</span>
            </div>
         )}
      </div>

      {/* RESTRICTION NOTICE IF RESTRICTED */}
      {vehicle.isRestricted ? (
        <div className="p-4 rounded-xl bg-amber-50 border-2 border-amber-300 text-amber-900 text-center space-y-2 my-2 shadow-xs">
          <div className="w-10 h-10 rounded-full bg-amber-100 border border-amber-300 flex items-center justify-center mx-auto text-xl shadow-2xs">
            🔒
          </div>
          <h4 className="font-black text-xs text-amber-950 uppercase tracking-wider">
            Listing Temporarily Restricted
          </h4>
          <p className="text-[11px] text-amber-800 leading-relaxed">
            {vehicle.restrictionReason || 'Bidding, direct buying, and pre-stakes are locked by administrative moderation pending review.'}
          </p>
        </div>
      ) : (
        <>
      {/* DIRECT SALE FLOW */}
      {isDirectSale && (
        <div className="space-y-3.5">
          <div className="bg-emerald-50/80 border border-emerald-200/80 rounded-xl p-3 text-xs text-emerald-900 leading-relaxed">
            <div className="flex items-center gap-1.5 font-bold mb-1 text-emerald-950">
              <span>🏷️</span>
              <span>Sell Without Auction • Direct Fixed Price</span>
            </div>
            <p className="text-[11px] text-emerald-800">
              This vehicle is listed directly at fixed price <strong>₹{formatPrice(vehicle.directPrice || vehicle.startingPrice || vehicle.currentBid)}</strong> with no bidding countdown.
            </p>
            <p className="text-[11px] text-emerald-700 mt-1">
              Listed for a total of 3 months. Contact seller or express purchase interest below.
            </p>
          </div>

          {!isOwner ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  alert(`Your purchase request for ${vehicle.year} ${vehicle.make} ${vehicle.model} at ₹${formatPrice(vehicle.directPrice || vehicle.startingPrice || vehicle.currentBid)} has been sent to the seller @${vehicle.ownerUsername || 'Seller'}!`);
                }}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-lg text-xs sm:text-sm shadow-md transition"
              >
                Buy Now at Fixed Price (₹{formatPrice(vehicle.directPrice || vehicle.startingPrice || vehicle.currentBid)})
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onOpenChat) {
                    onOpenChat(resolvedSeller);
                  } else if (onMessageSeller && vehicle.ownerUsername) {
                    onMessageSeller(vehicle.ownerUsername);
                  }
                }}
                className="w-full bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold py-2.5 rounded-lg text-xs border border-blue-200 transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
              >
                <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <span>Message Seller @{vehicle.ownerUsername || 'Owner'}</span>
              </button>
            </div>
          ) : (
            <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-center text-xs text-gray-600">
              <p className="font-bold text-gray-800 mb-1">You own this Direct Sale listing</p>
              <p className="text-[11px] text-gray-500">
                Listed in 'Vehicles For Sale'. Automatically active for 3 months.
              </p>
            </div>
          )}
        </div>
      )}

      {/* UPCOMING AUCTION FLOW */}
      {isUpcoming && (
        <div className="space-y-3.5">
          <div className="bg-blue-50/80 border border-blue-200/80 rounded-xl p-3 text-xs text-blue-900 leading-relaxed">
            <div className="flex items-center gap-1.5 font-bold mb-1 text-blue-950">
              <span>🎯</span>
              <span>Upcoming Pre-Bidding Active</span>
            </div>
            <p className="text-[11px] text-blue-800">
              Everyone can participate at the same asking price of <strong>₹{formatPrice(askingPrice)}</strong>.
            </p>
            <p className="text-[11px] text-blue-800 mt-1">
              🔔 <strong>Live Alerts:</strong> When this auction goes LIVE, all participating and interested users receive instant notifications and email alerts that bidding is open!
            </p>
            <p className="text-[11px] text-blue-800 mt-1">
              The last user to register holds the <strong>1st Bidder Priority</strong>. Once live, bidding enters real competition: highest bidder wins, and outbid bidders lose.
            </p>
          </div>

          {/* Joined Pre-Bidders List */}
          <div className="bg-gray-50/90 rounded-xl p-3 border border-gray-200/80">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-800">Participants ({upcomingBids.length})</span>
              <span className="text-[10px] text-gray-500">Same Asking Price</span>
            </div>

            {upcomingBids.length === 0 ? (
              <p className="text-xs text-gray-400 italic text-center py-2">No pre-bids yet. Be the first to join!</p>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {upcomingBids.map((b, idx) => {
                  const isLast = idx === upcomingBids.length - 1;
                  const isMe = currentUser && b.userId === currentUser.id;
                  return (
                    <div 
                      key={b.userId + idx} 
                      className={`flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                        isLast 
                          ? 'bg-amber-50/90 border-amber-300 text-amber-950 font-semibold' 
                          : 'bg-white border-gray-100 text-gray-600'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] text-gray-400">#{idx + 1}</span>
                        <span>@{b.username}</span>
                        {isMe && <span className="text-[9px] bg-indigo-100 text-indigo-700 px-1 rounded font-bold">You</span>}
                      </div>
                      {isLast ? (
                        <span className="text-[9.5px] bg-amber-200 text-amber-900 font-bold px-1.5 py-0.5 rounded shadow-xs flex items-center gap-1">
                          <span>🌟</span> 1st Bidder Priority
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-400">Registered</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Status & Actions for Current User */}
          {currentUser && !currentUser.isVerified && (
            <div 
              onClick={() => setShowVerificationModal(true)}
              className="cursor-pointer p-2.5 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl flex items-center gap-2.5 transition shadow-xs"
            >
              <span className="text-lg">🛡️</span>
              <div className="flex-1 text-left">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-amber-900">ID Verification Required</p>
                  <span className="text-[9px] bg-amber-200 text-amber-900 font-bold px-1.5 py-0.2 rounded">Verify Now</span>
                </div>
                <p className="text-[10px] text-amber-700">Verify your ID to participate in auctions.</p>
              </div>
            </div>
          )}

          {hasUserPreBid && isUserLeadingPreBid && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-xs text-emerald-800">
              <span className="text-base">🌟</span>
              <div>
                <p className="font-bold text-emerald-900">You hold the 1st Bidder Priority!</p>
                <p className="text-[10px] text-emerald-700">When this auction begins, you will hold the 1st leading bid of ₹{formatPrice(askingPrice)}.</p>
              </div>
            </div>
          )}

          {hasUserPreBid && !isUserLeadingPreBid && (
            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-xs text-amber-800">
              <span className="text-base">⚠️</span>
              <div className="flex-1">
                <p className="font-bold text-amber-900">Priority Shifted</p>
                <p className="text-[10px] text-amber-700">@{lastPreBidder?.username} joined after you. Re-stake below to reclaim 1st Bidder priority!</p>
              </div>
            </div>
          )}

          <button 
            type="button"
            onClick={handleUpcomingBidClick}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-2.5 rounded-lg active:scale-[0.99] transition-all text-xs sm:text-sm shadow-md"
          >
            {!hasUserPreBid 
              ? `Join Upcoming Auction at Asking Price (₹${formatPrice(askingPrice)})`
              : isUserLeadingPreBid
              ? `Re-Confirm 1st Bidder Priority (₹${formatPrice(askingPrice)})`
              : `Re-Stake 1st Bidder Priority (₹${formatPrice(askingPrice)})`
            }
          </button>
          <p className="text-[10px] text-gray-400 text-center">
            Joining upcoming auction pre-bidding notifies you when live. You only risk losing once you participate in live competition.
          </p>
        </div>
      )}

      {/* LIVE AUCTION FLOW */}
      {isLive && (
        <form onSubmit={handleBidSubmit} className="space-y-3.5">
           <div className="bg-red-50/90 border border-red-200 rounded-xl p-2.5 text-xs text-red-900">
             <div className="font-bold flex items-center justify-between text-red-950 mb-0.5">
               <span className="flex items-center gap-1.5">
                 <span className="inline-block w-2 h-2 rounded-full bg-red-600 animate-ping"></span>
                 <span>Live Auction • Real Competition</span>
               </span>
               <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">
                 High-Speed Bidding Active
               </span>
             </div>
             <p className="text-[11px] text-red-800">
               Real competition is active! Highest stake atomically wins at millisecond resolution. Outbid bidders lose when auction ends.
             </p>
           </div>
           {/* Bid Amount Manual Input & 0.1% Leading Bid Overview */}
           <div className="space-y-2">
             <div className="flex items-center justify-between">
               <label className="block text-xs font-bold text-gray-800">
                 Enter Bid Price (₹)
               </label>
               <span className="text-[11px] text-gray-500 font-medium">
                 Current Highest: <strong className="text-gray-900 font-mono">₹{formatPrice(vehicle.currentBid || vehicle.startingPrice)}</strong>
               </span>
             </div>

             {/* Direct Manual Input */}
             <div className="relative group">
               <span className="absolute left-3.5 top-2.5 text-gray-400 font-bold text-sm">₹</span>
               <input 
                  type="number"
                  value={bidAmount || ''}
                  onChange={(e) => setBidAmount(parseInt(e.target.value) || 0)}
                  min={(vehicle.currentBid || vehicle.startingPrice || 0) + 1}
                  placeholder={`Enter bid amount (e.g. ₹${formatPrice(calculateDefaultLeadingBid(vehicle.currentBid || vehicle.startingPrice || 0))})`}
                  className="w-full pl-8 pr-3 py-2.5 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-200 focus:border-red-500 outline-none text-base font-black text-gray-900 transition-all tracking-tight"
               />
             </div>

             <div className="flex items-center justify-between text-[10.5px] px-1 text-gray-500">
               <span>
                 {bidAmount > (vehicle.currentBid || vehicle.startingPrice || 0) ? (
                   <span className="text-emerald-700 font-semibold">
                     +₹{formatPrice(bidAmount - (vehicle.currentBid || vehicle.startingPrice || 0))} ({(((bidAmount - (vehicle.currentBid || vehicle.startingPrice || 0)) / ((vehicle.currentBid || vehicle.startingPrice) || 1)) * 100).toFixed(2)}% increase)
                   </span>
                 ) : (
                   <span className="text-amber-600 font-medium">Must be higher than ₹{formatPrice(vehicle.currentBid || vehicle.startingPrice)}</span>
                 )}
               </span>
               <span className="text-gray-400">
                 Default 0.1% bump: +₹{formatPrice(calculateDefaultIncrement(vehicle.currentBid || vehicle.startingPrice || 0))}
               </span>
             </div>

             {/* Fast Boost & Leading Bidder Options */}
             <div className="pt-1 space-y-1.5">
               <div className="flex items-center justify-between">
                 <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Quick Stake Actions:</span>
               </div>
               <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                 {/* 0.1% Default Leading Bidder Button */}
                 <button
                   type="button"
                   onClick={handleSetDefaultLeadingBid}
                   className={`col-span-2 py-1.5 px-2 rounded-lg border text-xs font-bold transition flex items-center justify-center gap-1 ${
                     bidAmount === calculateDefaultLeadingBid(vehicle.currentBid || vehicle.startingPrice || 0)
                       ? 'bg-red-600 text-white border-red-600 shadow-xs'
                       : 'bg-red-50/70 hover:bg-red-100/80 text-red-700 border-red-200'
                   }`}
                 >
                   <span>👑</span>
                   <span>+0.1% Leading: ₹{formatPrice(calculateDefaultLeadingBid(vehicle.currentBid || vehicle.startingPrice || 0))}</span>
                 </button>

                 {/* +0.5% Quick Stake */}
                 <button
                   type="button"
                   onClick={() => handleQuickPercentBoost(0.005)}
                   className="py-1.5 px-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold transition text-center"
                 >
                   +0.5%
                 </button>

                 {/* Random Stake Boost */}
                 <button
                   type="button"
                   onClick={handleRandomBoost}
                   title="Random unpredictable increase to outbid competitors"
                   className="py-1.5 px-2 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-bold transition flex items-center justify-center gap-1"
                 >
                   <span>🎲</span>
                   <span>Random Boost</span>
                 </button>
               </div>
             </div>
           </div>

           {/* 1-Click Fast Bidding Mode Toggle (Ignore Confirmation Modal) */}
           <div className="bg-amber-50/70 border border-amber-200/90 rounded-xl p-2.5 flex items-center justify-between gap-2.5">
             <div className="flex items-center gap-2">
               <span className="text-base">⚡</span>
               <div>
                 <div className="flex items-center gap-1.5">
                   <span className="text-xs font-bold text-gray-900">1-Click Fast Bidding</span>
                   {oneClickBidEnabled && (
                     <span className="text-[9px] bg-amber-500 text-white font-extrabold px-1.5 py-0.2 rounded-full uppercase tracking-wider animate-pulse">
                       Active
                     </span>
                   )}
                 </div>
                 <p className="text-[10px] text-gray-600 leading-tight">
                   Skip confirmation popup to bid instantly at millisecond speed
                 </p>
               </div>
             </div>
             <label className="relative inline-flex items-center cursor-pointer shrink-0">
               <input
                 type="checkbox"
                 checked={oneClickBidEnabled}
                 onChange={(e) => toggleOneClickBid(e.target.checked)}
                 className="sr-only peer"
               />
               <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
             </label>
           </div>
            
           {currentUser && !currentUser.isVerified && (
             <div 
               onClick={() => setShowVerificationModal(true)}
               className="cursor-pointer mb-2 p-2.5 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl flex items-center gap-2.5 transition shadow-xs"
             >
               <span className="text-lg">🛡️</span>
               <div className="flex-1 text-left">
                 <div className="flex items-center justify-between">
                   <p className="text-xs font-bold text-amber-900">ID Verification Required</p>
                   <span className="text-[9px] bg-amber-200 text-amber-900 font-bold px-1.5 py-0.2 rounded">Verify Now</span>
                 </div>
                 <p className="text-[10px] text-amber-700">Verify your PAN or National ID to place bids.</p>
               </div>
             </div>
           )}

           {currentUser && currentUser.isVerified && (
             <div className="mb-2 px-2.5 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-1.5 text-xs text-emerald-800 font-medium">
               <span>🛡️</span>
               <span className="text-[11px]">Verified Bidder — Live bidding authorized</span>
             </div>
           )}

           {oneClickBidEnabled ? (
             <button 
               type="button"
               onClick={() => handleBidSubmit()}
               className="w-full bg-gradient-to-r from-amber-600 via-red-600 to-red-500 hover:from-amber-700 hover:to-red-600 text-white font-extrabold py-3 rounded-xl shadow-lg shadow-red-500/25 active:scale-[0.98] transition-all text-xs sm:text-sm flex items-center justify-center gap-2"
             >
               <span className="text-base">⚡</span>
               <span>Place 1-Click Fast Bid: ₹{formatPrice(bidAmount)}</span>
             </button>
           ) : (
             <button 
               type="submit"
               className="w-full bg-gradient-to-r from-red-600 to-red-500 text-white font-bold py-2.5 rounded-lg hover:brightness-105 active:scale-[0.99] transition-all text-xs sm:text-sm shadow-sm flex items-center justify-center gap-1.5"
             >
               <span>{t.placeBid}: ₹{formatPrice(bidAmount)}</span>
             </button>
           )}
           <p className="text-[10px] text-gray-400 text-center">
             {oneClickBidEnabled 
               ? "⚡ 1-Click is ON: Bids are placed atomically with instant mechanical click feedback." 
               : "Placing a live bid enters you into the real competition."}
           </p>
        </form>
      )}

      {/* CONCLUDED / SOLD FLOW */}
      {isEnded && (
        <div className="space-y-3">
          <div className="bg-gray-100 p-4 rounded-xl text-center space-y-2">
             <div className="text-sm font-bold text-gray-800">This Auction Has Concluded</div>
             {vehicle.winningUsername ? (
               <div className="text-xs text-emerald-700 font-semibold">
                 Won by @{vehicle.winningUsername} for ₹{formatPrice(vehicle.currentBid || vehicle.startingPrice)}
               </div>
             ) : (
               <div className="text-xs text-gray-500">Ended without winning bidder</div>
             )}
             {currentUser && vehicle.winningUserId === currentUser.id && (
               <div className="mt-2 bg-emerald-600 text-white text-xs font-bold py-1.5 px-3 rounded-lg shadow-xs flex items-center justify-center gap-1.5">
                 <span>🏆</span> You Won This Auction!
               </div>
             )}
             {currentUser && vehicle.winningUserId && vehicle.winningUserId !== currentUser.id && (vehicle.liveParticipants || []).includes(currentUser.id) && (
               <div className="mt-2 bg-rose-100 text-rose-800 text-xs font-bold py-1.5 px-3 rounded-lg border border-rose-200 flex items-center justify-center gap-1.5">
                 <span>✕</span> You Were Outbid (Auction Lost)
               </div>
             )}
          </div>

          {/* Shift Unsold Auction Vehicle to Direct Sale (Process 2) */}
          {isOwner && isUnsoldAuction && onConvertToDirectSale && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 space-y-2.5 text-left animate-fade-in shadow-xs">
              <div className="flex items-center gap-2">
                <span className="text-xl">🏷️</span>
                <div>
                  <h4 className="text-xs font-bold text-emerald-950">Unsold in Auction? Give It a 2nd Chance!</h4>
                  <p className="text-[10px] text-emerald-700 leading-tight">
                    Shift this vehicle to "Sell Without Auction" at a fixed price and leave it listed for 3 months.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDirectShiftModal(true)}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-3 rounded-lg text-xs shadow-xs transition flex items-center justify-center gap-1.5"
              >
                <span>🏷️</span>
                <span>Shift to Sell Without Auction (Direct Sale) →</span>
              </button>
            </div>
          )}
        </div>
      )}
      </>
      )}

      <div className="mt-5 pt-4 border-t border-gray-100">
         <h4 className="font-bold text-gray-800 text-xs mb-2.5 uppercase tracking-wider">{t.saleStatus}</h4>
         <div className="space-y-2 text-xs bg-gray-50/70 p-3 rounded-lg border border-gray-100">
           <div className="flex justify-between">
             <span className="text-gray-500">{t.saleDate}</span>
             <span className="text-gray-900 font-medium">{isUpcoming ? 'Scheduled Upcoming' : 'Active'}</span>
           </div>
           <div className="flex justify-between">
             <span className="text-gray-500">{isUpcoming ? 'Auction Starts' : t.timeLeft}</span>
             <span className={`font-bold ${isUpcoming ? 'text-blue-600' : isEnded ? 'text-gray-500' : 'text-red-500 animate-pulse'}`}>
               {currentTimeLeft}
             </span>
           </div>
           <div className="flex justify-between">
             <span className="text-gray-500">Location</span>
             <span className="text-gray-900 font-medium">{vehicle.location}</span>
           </div>
         </div>
         {currentUser && onMarkSold && vehicle.status !== 'Sold' && (currentUser.role === 'admin' || currentUser.id === vehicle.ownerId) && (
             <button 
               onClick={onMarkSold}
               className="mt-3 w-full bg-gray-900 text-white font-bold py-2 rounded-lg hover:bg-black transition-all text-xs shadow-xs"
             >
               Close Auction & Mark as Sold
             </button>
         )}
      </div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
      {/* Top Header Row: Back to search on left, Share button on opposite side */}
      <div className="flex items-center justify-between mb-4 gap-3">
        <button onClick={onBack} className="group flex items-center text-gray-600 hover:text-red-600 font-semibold text-xs transition-colors bg-white/80 hover:bg-white px-3.5 py-2 rounded-xl border border-gray-200/80 backdrop-blur-sm hover:shadow-xs cursor-pointer">
          <span className="mr-1.5 group-hover:-translate-x-1 transition-transform">←</span> {t.backToSearch}
        </button>

        <button 
          type="button"
          onClick={handleSharePost}
          className="flex items-center gap-1.5 text-gray-700 hover:text-indigo-600 font-bold text-xs bg-white/80 hover:bg-white px-3.5 py-2 rounded-xl border border-gray-200/80 shadow-xs backdrop-blur-sm transition-all cursor-pointer"
          title="Share vehicle post"
        >
          <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          <span>Share Post</span>
        </button>
      </div>

      {shareToast && (
        <div className="mb-3 px-4 py-2 bg-indigo-600 text-white font-bold text-xs rounded-xl shadow-md flex items-center justify-between animate-fade-in">
          <span>{shareToast}</span>
          <span className="text-[10px] opacity-80">Link ready to paste</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        
        {/* Left Column: Images & Details */}
        <div className="lg:col-span-2 space-y-4">
          
          {/* Main Gallery with Auto Right-to-Left Scroll */}
          <div 
            className="glass-panel p-2.5 rounded-2xl bg-white shadow-sm border border-gray-200/80"
            onMouseEnter={() => setIsAutoScrollPaused(true)}
            onMouseLeave={() => setIsAutoScrollPaused(false)}
          >
            <div 
              className="relative w-full aspect-[16/10] sm:aspect-[16/9] min-h-[300px] sm:min-h-[420px] bg-slate-950 rounded-xl overflow-hidden shadow-inner flex items-center justify-center group select-none touch-pan-y"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              {/* Soft ambient blur backdrop so letterboxing on non-standard aspect ratios is sleek */}
              <img 
                src={mainImage} 
                alt="Ambient vehicle backdrop" 
                className="absolute inset-0 w-full h-full object-cover blur-2xl opacity-35 scale-110 pointer-events-none transition-all duration-700" 
              />

              {/* Main Image: animated right-to-left transition */}
              <img 
                key={mainImage}
                src={mainImage} 
                className={`relative z-10 w-full h-full transition-all duration-300 cursor-pointer animate-fade-in ${
                  fitMode === 'contain' ? 'object-contain' : 'object-cover object-center'
                }`} 
                alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`} 
                onClick={() => setIsLightboxOpen(true)}
              />

              {/* Top Controls Overlay */}
              <div className="absolute top-2.5 left-2.5 right-2.5 z-20 flex items-center justify-between pointer-events-none">
                <div className="pointer-events-auto flex items-center gap-1.5">
                  <span className="bg-black/60 backdrop-blur-md text-white text-[11px] font-bold px-2.5 py-1 rounded-lg border border-white/10 shadow-xs">
                    {currentImageIndex + 1} / {galleryImages.length} Photos
                  </span>
                  {galleryImages.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setIsAutoScrollPaused(!isAutoScrollPaused)}
                      title={isAutoScrollPaused ? "Resume auto right-to-left slide" : "Pause auto slide"}
                      className="bg-black/60 hover:bg-black/85 backdrop-blur-md text-white text-[10px] font-semibold px-2 py-1 rounded-lg border border-white/10 transition flex items-center gap-1 shadow-xs cursor-pointer"
                    >
                      <span>{isAutoScrollPaused ? '▶ Play' : '⏸ Auto'}</span>
                    </button>
                  )}
                </div>
                <div className="pointer-events-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setFitMode(fitMode === 'contain' ? 'cover' : 'contain')}
                    title={fitMode === 'contain' ? 'Fill screen' : 'Show full uncropped image'}
                    className="bg-black/60 hover:bg-black/85 backdrop-blur-md text-white text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-white/15 transition flex items-center gap-1 shadow-xs cursor-pointer"
                  >
                    {fitMode === 'contain' ? (
                      <>
                        <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                        </svg>
                        <span>Fit (100% Full)</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 9h6m-6 6h6m-3-9v12" />
                        </svg>
                        <span>Fill View</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsLightboxOpen(true)}
                    title="Open Fullscreen Lightbox"
                    className="bg-black/60 hover:bg-black/85 backdrop-blur-md text-white text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-white/15 transition flex items-center gap-1 shadow-xs cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
                    </svg>
                    <span>Enlarge</span>
                  </button>
                </div>
              </div>

              {/* Prev / Next Arrows */}
              {galleryImages.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={handlePrevImage}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-black/55 hover:bg-black/85 backdrop-blur-sm text-white flex items-center justify-center transition border border-white/15 shadow-md opacity-80 hover:opacity-100 cursor-pointer"
                    aria-label="Previous Image"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={handleNextImage}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-black/55 hover:bg-black/85 backdrop-blur-sm text-white flex items-center justify-center transition border border-white/15 shadow-md opacity-80 hover:opacity-100 cursor-pointer"
                    aria-label="Next Image"
                  >
                    ›
                  </button>
                </>
              )}
            </div>

            {/* Thumbnails Row: Auto-scrollable right-to-left */}
            <div 
              ref={thumbnailContainerRef}
              className="flex gap-2 mt-2.5 overflow-x-auto p-0.5 pb-1 scroll-smooth"
            >
              {galleryImages.map((imgUrl, i) => (
                <div
                  key={i}
                  ref={(el) => { thumbnailRefs.current[i] = el; }}
                  onClick={() => {
                    setMainImage(imgUrl);
                    setIsAutoScrollPaused(true);
                    setTimeout(() => setIsAutoScrollPaused(false), 5000);
                  }}
                  className={`relative h-16 w-24 rounded-lg overflow-hidden border-2 cursor-pointer transition-all shadow-xs shrink-0 bg-slate-900 ${
                    mainImage === imgUrl ? 'border-red-500 ring-2 ring-red-400/40 opacity-100 scale-102' : 'border-transparent opacity-75 hover:opacity-100 hover:border-gray-400'
                  }`}
                >
                  <img 
                    src={imgUrl} 
                    className="w-full h-full object-cover" 
                    alt={`Thumbnail ${i + 1}`} 
                  />
                  <span className="absolute bottom-0.5 right-0.5 bg-black/70 text-white text-[8px] font-bold px-1 rounded">
                    {i + 1}
                  </span>
                </div>
              ))}

              {/* If vehicle has an uploaded RC Card, show a dedicated inspectable thumbnail */}
              {vehicle.rcCardUrl && (
                <div
                  onClick={() => setShowRcModal(true)}
                  className="relative h-16 w-24 rounded-lg overflow-hidden border-2 border-emerald-500/70 bg-emerald-950/20 cursor-pointer transition-all shadow-xs shrink-0 group hover:ring-2 hover:ring-emerald-400"
                  title="View Registration Card"
                >
                  <img 
                    src={vehicle.rcCardUrl} 
                    className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition" 
                    alt="RC Card Thumbnail" 
                  />
                  <div className="absolute inset-0 bg-emerald-950/40 flex items-center justify-center">
                    <span className="bg-emerald-600 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded shadow-xs flex items-center gap-0.5">
                      <span>📄</span> RC
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Action Bar: Instagram-style Unified Likes, Saves & Real-Time Viewers */}
          <div className="glass-panel p-2.5 sm:p-3 rounded-2xl bg-white border border-gray-200/90 shadow-xs flex items-center justify-between gap-2.5 flex-wrap">
            <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
              {/* Instagram Like Button System (Single unified button container) */}
              <div className={`inline-flex items-center rounded-xl border transition-all duration-200 overflow-hidden shadow-2xs ${
                isLiked
                  ? 'bg-rose-50/90 border-rose-300 text-rose-700 ring-2 ring-rose-400/20'
                  : 'bg-gray-50/90 hover:bg-gray-100/90 border-gray-200 text-gray-700'
              }`}>
                <button
                  type="button"
                  onClick={handleToggleLike}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold group cursor-pointer active:scale-90 transition-transform"
                  title={isLiked ? "Unlike this vehicle post" : "Like this vehicle post (Instagram style)"}
                >
                  <svg 
                    className={`w-4 h-4 transition-transform duration-200 ${
                      isLiked 
                        ? 'text-rose-600 fill-rose-600 scale-110 drop-shadow-xs' 
                        : 'text-gray-500 group-hover:text-rose-500 group-hover:scale-110'
                    } ${likeHeartAnim ? 'animate-heart-pop' : ''}`} 
                    fill={isLiked ? "currentColor" : "none"} 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                  <span>{isLiked ? 'Liked' : 'Like'}</span>
                </button>
                
                <button
                  type="button"
                  onClick={() => setEngagementModal({ type: 'likes' })}
                  className={`px-2.5 py-2 text-xs font-black border-l transition cursor-pointer hover:underline ${
                    isLiked 
                      ? 'border-rose-200 bg-rose-100/60 text-rose-800 hover:bg-rose-100' 
                      : 'border-gray-200 bg-white/70 text-gray-700 hover:bg-white'
                  }`}
                  title="View original users who liked this post"
                >
                  <span>{likesCount}</span>
                </button>
              </div>

              {/* Instagram Save / Wishlist Button System (Single unified button container) */}
              <div className={`inline-flex items-center rounded-xl border transition-all duration-200 overflow-hidden shadow-2xs ${
                isWishlisted
                  ? 'bg-amber-50/90 border-amber-300 text-amber-900 ring-2 ring-amber-400/20'
                  : 'bg-gray-50/90 hover:bg-gray-100/90 border-gray-200 text-gray-700'
              }`}>
                <button
                  type="button"
                  onClick={handleToggleWishlist}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold group cursor-pointer active:scale-90 transition-transform"
                  title={isWishlisted ? "Remove from saved wishlist" : "Save to wishlist"}
                >
                  <svg 
                    className={`w-4 h-4 transition-transform duration-200 ${
                      isWishlisted 
                        ? 'text-amber-600 fill-amber-600 scale-110' 
                        : 'text-gray-500 group-hover:text-amber-600 group-hover:scale-110'
                    }`} 
                    fill={isWishlisted ? "currentColor" : "none"} 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                  <span>{isWishlisted ? 'Saved' : 'Save'}</span>
                </button>
                
                <button
                  type="button"
                  onClick={() => setEngagementModal({ type: 'wishlist' })}
                  className={`px-2.5 py-2 text-xs font-black border-l transition cursor-pointer hover:underline ${
                    isWishlisted 
                      ? 'border-amber-200 bg-amber-100/60 text-amber-900 hover:bg-amber-100' 
                      : 'border-gray-200 bg-white/70 text-gray-700 hover:bg-white'
                  }`}
                  title="View original users who added to wishlist"
                >
                  <span>{wishlistCount}</span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Real-Time Views Indicator */}
              <button
                type="button"
                onClick={() => setEngagementModal({ type: 'views' })}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-700 bg-gray-50/90 hover:bg-indigo-50/90 px-3 py-2 rounded-xl border border-gray-200 hover:border-indigo-200 transition-all cursor-pointer shadow-2xs group"
                title="View original users who viewed this vehicle listing"
              >
                <svg className="w-4 h-4 text-indigo-500 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                <span className="font-black text-gray-900">{viewsCount}</span>
                <span className="text-[10px] text-gray-500 font-semibold group-hover:text-indigo-600 underline">views</span>
              </button>
            </div>
          </div>

          {/* Restriction Notice if vehicle isRestricted */}
          {vehicle.isRestricted && (
            <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-300 text-amber-900 flex items-start gap-3 shadow-xs">
              <span className="text-2xl">⚠️</span>
              <div>
                <strong className="block font-black text-amber-950 text-sm">Listing Restricted by Platform Admin</strong>
                <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                  {vehicle.restrictionReason || 'This listing has been placed under administrative restriction pending inspection or document verification. Bidding and direct sales are locked.'}
                </p>
              </div>
            </div>
          )}

          {/* MOBILE ONLY: Auction & Bidding Box placed directly in between Gallery/Likes and Seller Profile */}
          <div className="block lg:hidden">
            {renderBiddingCard()}
          </div>

          {/* Seller / Lister Profile Banner */}
          {vehicle.ownerUsername && (
            <div className="glass-panel rounded-xl p-4 flex items-center justify-between gap-3 border border-indigo-100 bg-gradient-to-r from-white via-indigo-50/30 to-blue-50/20 shadow-xs">
              <div 
                onClick={() => onViewProfile && onViewProfile(resolvedSeller)}
                className="flex items-center gap-3 cursor-pointer group flex-1 min-w-0"
              >
                <img 
                  src={resolvedSeller.avatarUrl} 
                  alt={vehicle.ownerUsername}
                  className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-xs group-hover:scale-105 transition-transform shrink-0" 
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs sm:text-sm font-bold text-gray-900 group-hover:text-indigo-600 transition-colors truncate">
                      @{vehicle.ownerUsername}
                    </span>
                    {resolvedSeller.isVerified && (
                      <svg className="w-3.5 h-3.5 text-blue-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    )}
                    {sellerFollowsMe && (
                      <span className="text-[9px] bg-blue-100/80 text-blue-700 font-semibold px-1.5 py-0.5 rounded-md border border-blue-200">
                        Follows you
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 truncate">
                    {resolvedSeller.fullName} • {resolvedSeller.followers || 0} followers
                  </p>
                  <span className="text-[10px] text-indigo-600 font-semibold group-hover:underline flex items-center gap-1 mt-0.5">
                    View profile & listed vehicles →
                  </span>
                </div>
              </div>

              {/* Action Buttons: Message Seller & Follow */}
              {!isOwner && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (onOpenChat) {
                        onOpenChat(resolvedSeller);
                      } else if (onMessageSeller && vehicle.ownerUsername) {
                        onMessageSeller(vehicle.ownerUsername);
                      }
                    }}
                    className="text-xs font-bold px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition shadow-xs flex items-center gap-1 cursor-pointer"
                    title="Direct Message seller"
                  >
                    <svg className="w-3.5 h-3.5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <span>Chat</span>
                  </button>

                  {onFollowToggle && (
                    <button
                      type="button"
                      onClick={() => onFollowToggle(resolvedSeller)}
                      disabled={isFollowLoading}
                      className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-all shadow-xs flex items-center gap-1 ${
                        isFollowingSeller
                          ? 'bg-gray-100 hover:bg-red-50 text-gray-700 hover:text-red-600 border border-gray-200'
                          : sellerFollowsMe
                          ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-blue-200 ring-2 ring-blue-400/20'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      {isFollowingSeller ? (
                        'Following'
                      ) : sellerFollowsMe ? (
                        <>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
                          </svg>
                          <span>Follow Back</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
                          </svg>
                          <span>Follow</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Vehicle Information */}
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="bg-white/60 px-5 py-3 border-b border-gray-100 backdrop-blur-sm">
              <h2 className="text-sm font-bold text-gray-900">{t.vehicleSpecs}</h2>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-xs">
              <div className="flex justify-between border-b border-gray-100 pb-1.5 items-center">
                <span className="text-gray-500 font-medium">Stock Number</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-black text-amber-950 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded text-[11px] tracking-wider">
                    #{vehicle.stockNumber || (vehicle.id ? vehicle.id.slice(-8) : 'N/A')}
                  </span>
                  {vehicle.stockNumber && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(vehicle.stockNumber!);
                        alert(`Stock #${vehicle.stockNumber} copied to clipboard!`);
                      }}
                      className="text-[10px] text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-1.5 py-0.5 rounded transition cursor-pointer"
                      title="Copy Stock ID"
                    >
                      Copy
                    </button>
                  )}
                </div>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-1.5">
                <span className="text-gray-500 font-medium">{t.vin}</span>
                <span className="font-mono text-gray-900 bg-gray-100 px-1.5 py-0.5 rounded text-[11px]">{vehicle.vin}</span>
              </div>
              {vehicle.ownerUsername && (
                <div 
                  className="flex justify-between border-b border-gray-100 pb-1.5 cursor-pointer hover:bg-indigo-50/50 rounded px-1 -mx-1 transition"
                  onClick={() => onViewProfile && onViewProfile(resolvedSeller)}
                  title="Click to view seller profile"
                >
                  <span className="text-gray-500 font-medium">Listed By</span>
                  <span className="font-semibold text-indigo-600 flex items-center gap-1">
                    @{vehicle.ownerUsername}
                    <span className="text-[10px] text-gray-400">↗</span>
                  </span>
                </div>
              )}
              <div className="flex justify-between border-b border-gray-100 pb-1.5">
                <span className="text-gray-500 font-medium">{t.odometer}</span>
                <span className="font-semibold text-gray-900">{(vehicle.odometer || 0).toLocaleString()} mi</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-1.5">
                <span className="text-gray-500 font-medium">{t.primaryDamage}</span>
                <span className="font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded text-[11px]">{vehicle.primaryDamage}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-1.5">
                <span className="text-gray-500 font-medium">{t.secondaryDamage}</span>
                <span className="font-medium text-gray-900">{vehicle.secondaryDamage || 'N/A'}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-1.5">
                <span className="text-gray-500 font-medium">{t.engine}</span>
                <span className="font-medium text-gray-900">{vehicle.engine}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-1.5">
                <span className="text-gray-500 font-medium">{t.topSpeed}</span>
                <span className="font-medium text-gray-900">{vehicle.topSpeed || 'N/A'}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-1.5">
                <span className="text-gray-500 font-medium">{t.mpg}</span>
                <span className="font-medium text-gray-900">{vehicle.mpg || 'N/A'}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-1.5">
                <span className="text-gray-500 font-medium">Drive</span>
                <span className="font-medium text-gray-900">{vehicle.drive}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-1.5">
                <span className="text-gray-500 font-medium">Transmission</span>
                <span className="font-medium text-gray-900">{vehicle.transmission}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-1.5">
                <span className="text-gray-500 font-medium">{t.keys}</span>
                <span className={`font-bold ${vehicle.hasKeys ? 'text-green-600' : 'text-red-600'}`}>
                  {vehicle.hasKeys ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-1.5 items-center">
                <span className="text-gray-500 font-medium">Registration Card (RC)</span>
                {vehicle.hasRegistrationCard ? (
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded text-[11px] border border-emerald-200 flex items-center gap-1">
                      <span>✓</span> Available
                    </span>
                    {vehicle.rcCardUrl && (
                      <button
                        type="button"
                        onClick={() => setShowRcModal(true)}
                        className="text-[10px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200 transition flex items-center gap-0.5 cursor-pointer"
                      >
                        <span>View RC</span>
                        <span>↗</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="font-medium text-amber-800 bg-amber-50 px-2 py-0.5 rounded text-[11px] border border-amber-200">
                    Not Available
                  </span>
                )}
              </div>
              {vehicle.rcCardNumber && (
                <div className="flex justify-between border-b border-gray-100 pb-1.5">
                  <span className="text-gray-500 font-medium">RC Number</span>
                  <span className="font-mono font-bold text-gray-900 bg-gray-100 px-1.5 py-0.5 rounded text-[11px]">
                    {vehicle.rcCardNumber}
                  </span>
                </div>
              )}
            </div>
            
            {/* Description Section */}
            {vehicle.description && (
                <div className="px-5 pb-5 pt-0">
                    <h3 className="font-bold text-gray-800 mb-2 text-xs uppercase tracking-wide">{t.sellerDesc}</h3>
                    <div className="bg-gray-50/70 p-3.5 rounded-lg border border-gray-100 text-gray-700 text-xs leading-relaxed">
                        {vehicle.description}
                    </div>
                </div>
            )}
          </div>

          {/* AI Analysis Section */}
          <div className="relative overflow-hidden rounded-xl shadow-xs border border-indigo-100 bg-gradient-to-br from-indigo-50/80 to-white/90 backdrop-blur-xl">
             <div className="px-5 py-3.5 border-b border-indigo-100/50 flex justify-between items-center relative z-10">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-indigo-100/70 rounded-lg text-indigo-600">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                  </div>
                  <h2 className="text-sm font-bold text-indigo-950">{t.aiInsight}</h2>
                </div>
                {!analysis && (
                  <button 
                    onClick={handleGenerateAnalysis}
                    disabled={isLoadingAnalysis}
                    className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 shadow-sm text-white px-3.5 py-1.5 rounded-lg transition-all disabled:opacity-50"
                  >
                    {isLoadingAnalysis ? t.analyzing : t.generateReport}
                  </button>
                )}
             </div>
             <div className="p-5 relative z-10 text-xs">
                {!analysis && !isLoadingAnalysis && (
                  <p className="text-indigo-500 text-center py-3 font-medium">
                    Tap the button above to unlock AI-powered insights regarding potential hidden damages and repair complexity.
                  </p>
                )}
                {isLoadingAnalysis && (
                  <div className="animate-pulse space-y-2.5">
                    <div className="h-3 bg-indigo-200/50 rounded-md w-3/4"></div>
                    <div className="h-3 bg-indigo-200/50 rounded-md w-full"></div>
                    <div className="h-3 bg-indigo-200/50 rounded-md w-5/6"></div>
                  </div>
                )}
                {analysis && (
                   <div className="prose prose-xs prose-indigo text-gray-700 max-w-none bg-white/70 p-4 rounded-xl border border-indigo-50 leading-relaxed">
                     <div dangerouslySetInnerHTML={{ __html: analysis.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br />') }} />
                   </div>
                )}
             </div>
          </div>
        </div>

        {/* Right Column: Sticky Bidding Interface (Desktop only) */}
        <div className="hidden lg:block space-y-4">
           {renderBiddingCard()}
        </div>
      </div>

      {/* Bid Confirmation Modal */}
      {showBidModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-gray-100 transform transition-all animate-fade-in-up">
            <div className="flex items-center gap-3.5 mb-5">
              <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center text-red-600 shadow-sm shrink-0">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">Confirm Your Bid</h3>
                <p className="text-xs text-gray-500">Please review your bid before submitting</p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-2xl p-4 mb-5 space-y-3 border border-gray-100 text-sm">
              <div className="flex justify-between items-center pb-2 border-b border-gray-200/60">
                <span className="text-gray-500 font-medium">Vehicle</span>
                <span className="font-bold text-gray-900 text-right">{vehicle.year} {vehicle.make} {vehicle.model}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-gray-200/60">
                <span className="text-gray-500 font-medium">Current Bid</span>
                <span className="text-gray-700 font-bold">₹{formatPrice(vehicle.currentBid || vehicle.startingPrice)}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-gray-200/60 bg-red-50/80 p-2.5 rounded-xl border border-red-100">
                <span className="text-red-700 font-bold">Your New Bid</span>
                <span className="text-xl font-black text-red-600">₹{formatPrice(bidAmount)}</span>
              </div>
              <div className="flex justify-between items-center text-xs text-gray-500 px-1">
                <span>Bid Increase Above Current</span>
                <span className="font-semibold text-emerald-600">
                  +₹{formatPrice(bidAmount - (vehicle.currentBid || vehicle.startingPrice || 0))} ({(((bidAmount - (vehicle.currentBid || vehicle.startingPrice || 0)) / ((vehicle.currentBid || vehicle.startingPrice) || 1)) * 100).toFixed(2)}%)
                </span>
              </div>
              <div className="flex justify-between items-center text-xs text-gray-500 px-1 pt-2 border-t border-gray-200/40">
                <span>Available Wallet Balance</span>
                <span className="font-bold text-gray-800">₹{(currentUser?.deposits || 0).toLocaleString()}</span>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex gap-2.5 items-start text-xs text-amber-800">
              <span className="text-base leading-none shrink-0">⚠️</span>
              <p className="leading-snug">
                Are you sure you want to place this bid? All bids are legally binding commitments to purchase if you win this vehicle.
              </p>
            </div>

            {/* Ignore Confirmation in future (Enable 1-Click Fast Bidding) */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 mb-5 space-y-1.5">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberOneClickInModal}
                  onChange={(e) => setRememberOneClickInModal(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                />
                <div className="text-xs">
                  <span className="font-bold text-gray-900 flex items-center gap-1.5">
                    <span>⚡</span> Ignore this confirmation & enable 1-Click Fast Bidding
                  </span>
                  <p className="text-[10.5px] text-gray-500 mt-0.5 leading-snug">
                    Bypass this confirmation modal completely for future bids. Perfect for winning last-second bidding wars at millisecond speed.
                  </p>
                </div>
              </label>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={() => setShowBidModal(false)}
                className="py-3 px-4 rounded-xl border border-gray-200 font-bold text-gray-600 hover:bg-gray-100 transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBid}
                className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-red-600 to-red-500 text-white font-bold shadow-lg shadow-red-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all text-sm flex items-center justify-center gap-1.5"
              >
                <span>Confirm & Place Bid</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Direct Sale Shift Modal */}
      {showDirectShiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl p-5 sm:p-6 max-w-md w-full shadow-2xl border border-gray-100 animate-fade-in-up">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl shrink-0">
                🏷️
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-gray-900">Shift to Sell Without Auction</h3>
                <p className="text-xs text-gray-500">2nd chance direct sale listing</p>
              </div>
            </div>

            <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-3 mb-4 text-xs text-emerald-800 space-y-1">
              <p className="font-semibold text-emerald-950">How it works:</p>
              <p>• Your vehicle will be listed in <strong>Vehicles For Sale</strong> at your fixed asking price.</p>
              <p>• No auction or countdown pressure.</p>
              <p>• Stays active for <strong>3 months</strong>, then automatically blacklisted if unsold.</p>
            </div>

            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Fixed Asking Price (₹) *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-gray-400 font-bold text-sm">₹</span>
                  <input
                    type="number"
                    value={newDirectPrice}
                    onChange={(e) => setNewDirectPrice(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full pl-7 pr-3 py-2 bg-white border border-gray-300 rounded-lg font-bold text-sm text-gray-900 focus:ring-2 focus:ring-emerald-400 outline-none"
                    placeholder="Enter fixed price"
                  />
                </div>
                <p className="text-[10px] text-gray-500 mt-1">Previous starting bid was ₹{formatPrice(vehicle.startingPrice || vehicle.currentBid)}</p>
              </div>
            </div>

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setShowDirectShiftModal(false)}
                className="flex-1 py-2.5 rounded-lg border border-gray-200 font-bold text-gray-600 hover:bg-gray-100 text-xs transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!newDirectPrice || newDirectPrice <= 0) {
                    alert("Please enter a valid fixed selling price.");
                    return;
                  }
                  setShowDirectShiftModal(false);
                  if (onConvertToDirectSale) {
                    onConvertToDirectSale(vehicle.id, newDirectPrice);
                  }
                }}
                className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition"
              >
                Confirm & Shift (3 Months)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ID Verification Modal */}
      {showVerificationModal && currentUser && (
        <IdentityVerificationModal
          currentUser={currentUser}
          isOpen={true}
          gateReason="bid"
          onClose={() => setShowVerificationModal(false)}
          onVerificationSubmitted={() => {
            setShowVerificationModal(false);
            alert("Verification request submitted! Our verification team / admin will review your details shortly. Once approved, you can place bids.");
          }}
        />
      )}

      {/* Fullscreen HD Lightbox Modal (Guarantees Full, Uncropped Vehicle View) */}
      {isLightboxOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col items-center justify-between p-3 sm:p-6"
          onClick={() => setIsLightboxOpen(false)}
        >
          {/* Top Bar */}
          <div 
            className="w-full max-w-6xl flex items-center justify-between text-white z-10 py-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5">
              <span className="font-bold text-sm sm:text-base">
                {vehicle.year} {vehicle.make} {vehicle.model}
              </span>
              <span className="bg-white/15 px-2 py-0.5 rounded-full text-xs font-mono font-medium">
                {currentImageIndex + 1} of {galleryImages.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFitMode(fitMode === 'contain' ? 'cover' : 'contain')}
                className="bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-3 py-1.5 rounded-lg border border-white/20 transition cursor-pointer"
              >
                {fitMode === 'contain' ? 'Fit (100% Full View)' : 'Fill'}
              </button>
              <button
                type="button"
                onClick={() => setIsLightboxOpen(false)}
                className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/30 text-white font-bold text-lg flex items-center justify-center transition cursor-pointer"
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Centered High-Resolution Image Container */}
          <div 
            className="relative flex-1 w-full max-w-6xl flex items-center justify-center my-auto overflow-hidden p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <img 
              src={mainImage} 
              alt="Full Resolution View" 
              className={`max-h-[82vh] max-w-[95vw] rounded-lg shadow-2xl transition-all duration-200 ${
                fitMode === 'contain' ? 'object-contain' : 'object-cover'
              }`}
            />

            {/* Prev & Next Floating Buttons */}
            {galleryImages.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={handlePrevImage}
                  className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/60 hover:bg-black/90 text-white text-2xl flex items-center justify-center transition border border-white/20 shadow-lg cursor-pointer"
                  aria-label="Previous image"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={handleNextImage}
                  className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/60 hover:bg-black/90 text-white text-2xl flex items-center justify-center transition border border-white/20 shadow-lg cursor-pointer"
                  aria-label="Next image"
                >
                  ›
                </button>
              </>
            )}
          </div>

          {/* Bottom Thumbnails Strip */}
          <div 
            className="w-full max-w-4xl flex items-center justify-center gap-2 overflow-x-auto py-1 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            {galleryImages.map((img, i) => (
              <img
                key={i}
                src={img}
                alt={`thumb-${i}`}
                onClick={() => setMainImage(img)}
                className={`h-12 w-16 sm:h-14 sm:w-20 object-cover rounded-lg border-2 cursor-pointer transition ${
                  mainImage === img ? 'border-red-500 scale-105' : 'border-white/20 opacity-60 hover:opacity-100'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* RC Card Document Viewer Modal */}
      {showRcModal && vehicle.rcCardUrl && (
        <div 
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
          onClick={() => setShowRcModal(false)}
        >
          <div 
            className="bg-white rounded-2xl max-w-2xl w-full p-4 sm:p-5 shadow-2xl space-y-3.5 border border-gray-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center text-base">
                  📄
                </span>
                <div>
                  <h3 className="font-bold text-gray-900 text-sm sm:text-base">
                    Vehicle Registration Certificate (RC)
                  </h3>
                  <p className="text-[11px] text-gray-500">
                    Official document verified by AutoBid verification standards
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowRcModal(false)}
                className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold flex items-center justify-center text-xs transition"
              >
                ✕
              </button>
            </div>

            {/* Document Info Pills */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs bg-gray-50 p-2.5 rounded-xl border border-gray-100">
              <div>
                <span className="text-[10px] text-gray-400 block font-semibold">Vehicle</span>
                <strong className="text-gray-900">{vehicle.year} {vehicle.make} {vehicle.model}</strong>
              </div>
              <div>
                <span className="text-[10px] text-gray-400 block font-semibold">RC Status</span>
                <span className="text-emerald-700 font-bold flex items-center gap-1">
                  <span>✓</span> Verified & Uploaded
                </span>
              </div>
              {vehicle.rcCardNumber && (
                <div className="col-span-2 sm:col-span-1">
                  <span className="text-[10px] text-gray-400 block font-semibold">RC Number</span>
                  <span className="font-mono font-bold text-gray-900">{vehicle.rcCardNumber}</span>
                </div>
              )}
            </div>

            {/* Full High-Resolution RC Document View */}
            <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-slate-950 flex items-center justify-center max-h-[60vh]">
              <img 
                src={vehicle.rcCardUrl} 
                alt="RC Card Document" 
                className="max-h-[58vh] w-auto max-w-full object-contain"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-gray-400">
                🔒 Protected document display for authorized platform users
              </span>
              <button
                type="button"
                onClick={() => setShowRcModal(false)}
                className="bg-gray-900 hover:bg-black text-white text-xs font-bold px-4 py-2 rounded-xl transition"
              >
                Close Document
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Real Audience Engagement Modal (Likes, Wishlist, Views) */}
      {engagementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl border border-gray-100 flex flex-col max-h-[85vh]">
            <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center text-sm">
                  {engagementModal.type === 'views' ? '👁️' : engagementModal.type === 'wishlist' ? '🔖' : '❤️'}
                </div>
                <div>
                  <h3 className="text-sm font-black text-gray-900">
                    {engagementModal.type === 'views' && 'Original Viewers'}
                    {engagementModal.type === 'wishlist' && 'Wishlist Members'}
                    {engagementModal.type === 'likes' && 'Post Likes'}
                  </h3>
                  <p className="text-[11px] text-gray-500 font-medium">
                    Verified registered users on AutoBid
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEngagementModal(null)}
                className="w-8 h-8 rounded-full hover:bg-gray-200/70 flex items-center justify-center text-gray-500 hover:text-gray-900 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 divide-y divide-gray-100">
              {(() => {
                const list = engagementModal.type === 'views'
                  ? viewersList
                  : engagementModal.type === 'wishlist'
                  ? wishlistUsers
                  : likesList;

                if (!list || list.length === 0) {
                  return (
                    <div className="text-center py-10 px-4">
                      <div className="text-3xl mb-2">
                        {engagementModal.type === 'views' ? '👁️' : engagementModal.type === 'wishlist' ? '🔖' : '🤍'}
                      </div>
                      <p className="text-xs font-bold text-gray-700">No entries recorded yet</p>
                      <p className="text-[11px] text-gray-400 mt-1 max-w-xs mx-auto">
                        {engagementModal.type === 'views' && 'Original verified members who open this vehicle will appear here.'}
                        {engagementModal.type === 'wishlist' && 'Users who bookmark this vehicle to their watchlist will appear here.'}
                        {engagementModal.type === 'likes' && 'Members who like this vehicle listing will appear here.'}
                      </p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-2">
                    <div className="text-[10px] font-black uppercase tracking-wider text-gray-400 px-1 pt-1 pb-1">
                      {list.length} Verified Platform Member{list.length > 1 ? 's' : ''}
                    </div>
                    {list.map((u, i) => (
                      <div key={u.userId || i} className="flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-gray-50 transition">
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src={u.avatarUrl || `https://i.pravatar.cc/150?u=${u.userId || i}`}
                            alt={u.username || 'User'}
                            className="w-10 h-10 rounded-full object-cover border border-gray-200 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-gray-900 truncate">
                              {u.fullName || u.username || 'AutoBid Member'}
                            </div>
                            <div className="text-[11px] text-gray-500 truncate">
                              @{u.username || 'member'}
                            </div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-[10px] text-gray-500 font-semibold block">
                            {(() => {
                              if (!u.timestamp) return 'Recorded';
                              const diff = Date.now() - u.timestamp;
                              if (diff < 60000) return 'Just now';
                              if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
                              if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
                              return new Date(u.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                            })()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            <div className="p-3.5 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-2">
              <span className="text-[10px] text-gray-400">🛡️ Real-time transparent interaction records</span>
              <button
                type="button"
                onClick={() => setEngagementModal(null)}
                className="px-4 py-2 rounded-xl bg-gray-900 hover:bg-black text-white text-xs font-bold transition shadow-xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};