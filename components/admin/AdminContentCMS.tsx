import React, { useState, useEffect } from 'react';
import { db, collection, onSnapshot, doc, setDoc, deleteDoc, updateDoc, addDoc } from '../../firebase';
import { ContentBanner, CarouselSlide, User } from '../../types';
import { logAdminAction } from './adminAuditHelper';

interface AdminContentCMSProps {
  currentUser: User;
}

export const AdminContentCMS: React.FC<AdminContentCMSProps> = ({ currentUser }) => {
  const [banners, setBanners] = useState<ContentBanner[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [announcement, setAnnouncement] = useState({ text: '🔥 Mega Auto Auction Live: Zero Listing Fees This Weekend!', active: true });
  const [isSavingAnnouncement, setIsSavingAnnouncement] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  // Editing Banner & Carousel Slides state
  const [editingBanner, setEditingBanner] = useState<ContentBanner | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);
  const [editSlidePreviewIndex, setEditSlidePreviewIndex] = useState<number>(0);
  const [editActiveTab, setEditActiveTab] = useState<'slides' | 'banner'>('slides');
  const [showPresetPickerForSlide, setShowPresetPickerForSlide] = useState<number | null>(null);

  // Carousel slide preview state for cards in CMS
  const [activeSlideMap, setActiveSlideMap] = useState<Record<string, number>>({});

  const [newBanner, setNewBanner] = useState<{
    title: string;
    subtitle: string;
    imageUrl: string;
    targetUrl: string;
    position: 'hero' | 'top_bar' | 'footer' | 'popup';
    isActive: boolean;
    isCarousel: boolean;
    slides: CarouselSlide[];
  }>({
    title: '',
    subtitle: '',
    imageUrl: '',
    targetUrl: '/auctions',
    position: 'hero',
    isActive: true,
    isCarousel: false,
    slides: []
  });

  const serverBannersRef = React.useRef<Map<string, ContentBanner>>(new Map());
  const firestoreBannersRef = React.useRef<Map<string, ContentBanner>>(new Map());

  const syncMergedBanners = () => {
    const combined = new Map<string, ContentBanner>();
    // First Firestore banners
    firestoreBannersRef.current.forEach((b, k) => combined.set(k, b));
    // Server banners take priority / merge
    serverBannersRef.current.forEach((b, k) => combined.set(k, b));
    setBanners(Array.from(combined.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  };

  // Fetch all banners from server backend and sync with Firestore
  const fetchBanners = async () => {
    try {
      const res = await fetch('/api/banners');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.banners)) {
          serverBannersRef.current = new Map(data.banners.map((b: ContentBanner) => [b.id, b]));
          syncMergedBanners();
        }
      }
    } catch (err) {
      console.warn('Failed to fetch banners from API:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBanners();

    // Listen to Firestore content_banners
    let unsubBanners: (() => void) | null = null;
    try {
      unsubBanners = onSnapshot(collection(db, 'content_banners'), (snap) => {
        firestoreBannersRef.current.clear();
        snap.forEach(d => {
          firestoreBannersRef.current.set(d.id, { id: d.id, ...d.data() } as ContentBanner);
        });
        syncMergedBanners();
      }, () => {
        fetchBanners();
      });
    } catch {
      fetchBanners();
    }

    // Listen to Announcement Settings
    const unsubSettings = onSnapshot(doc(db, 'settings', 'announcement'), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setAnnouncement({ text: d.text || '', active: d.active ?? true });
      }
    }, () => {});

    const interval = setInterval(fetchBanners, 5000);

    return () => {
      if (unsubBanners) unsubBanners();
      unsubSettings();
      clearInterval(interval);
    };
  }, []);

  const handleSaveAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingAnnouncement(true);
    try {
      await setDoc(doc(db, 'settings', 'announcement'), {
        text: announcement.text,
        active: announcement.active,
        updatedAt: Date.now(),
        updatedBy: currentUser.email
      });
      await logAdminAction(currentUser, 'UPDATE_ANNOUNCEMENT_BAR', 'settings', 'announcement', `Set announcement text: ${announcement.text.slice(0, 30)}... active=${announcement.active}`);
      setActionSuccessMsg('✓ Global announcement bar updated live!');
      setTimeout(() => setActionSuccessMsg(null), 3500);
    } catch (err: any) {
      alert('Failed to update announcement: ' + err.message);
    } finally {
      setIsSavingAnnouncement(false);
    }
  };

  // Toggle Banner Active / Inactive (Publish / Unpublish)
  const handleToggleBanner = async (banner: ContentBanner) => {
    const nextState = !banner.isActive;

    // 1. Optimistic UI update immediately
    const updated = { ...banner, isActive: nextState };
    if (serverBannersRef.current.has(banner.id)) serverBannersRef.current.set(banner.id, updated);
    if (firestoreBannersRef.current.has(banner.id)) firestoreBannersRef.current.set(banner.id, updated);
    setBanners(prev => prev.map(b => b.id === banner.id ? updated : b));

    try {
      // 2. Call server toggle endpoint
      await fetch('/api/banners/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: banner.id, isActive: nextState })
      });

      // 3. Update Firestore doc if exists
      try {
        await updateDoc(doc(db, 'content_banners', banner.id), {
          isActive: nextState
        });
      } catch {}

      await logAdminAction(
        currentUser,
        'TOGGLE_BANNER',
        'content_banners',
        banner.id,
        `Set isActive=${nextState} for "${banner.title}"`
      );

      setActionSuccessMsg(`✓ Banner "${banner.title}" ${nextState ? 'published live' : 'deactivated'}.`);
      setTimeout(() => setActionSuccessMsg(null), 3500);
    } catch (err: any) {
      alert('Failed to toggle banner: ' + err.message);
      fetchBanners();
    }
  };

  // Delete Banner (Guaranteed Deletion from both Server and Firestore)
  const handleDeleteBanner = async (banner: ContentBanner) => {
    if (!window.confirm(`Delete banner "${banner.title}"? It will be permanently removed from the site.`)) return;

    // 1. Optimistic removal immediately so UI updates with zero delay
    serverBannersRef.current.delete(banner.id);
    firestoreBannersRef.current.delete(banner.id);
    setBanners(prev => prev.filter(b => b.id !== banner.id));

    try {
      // 2. Call server DELETE endpoint
      await fetch(`/api/banners/${banner.id}`, {
        method: 'DELETE'
      });

      // 3. Delete from Firestore collection
      try {
        await deleteDoc(doc(db, 'content_banners', banner.id));
      } catch (err) {
        console.warn('Firestore deleteDoc fallback:', err);
      }

      await logAdminAction(
        currentUser,
        'DELETE_BANNER',
        'content_banners',
        banner.id,
        `Deleted banner "${banner.title}"`
      );

      setActionSuccessMsg(`✓ Banner "${banner.title}" deleted permanently.`);
      setTimeout(() => setActionSuccessMsg(null), 3500);
    } catch (err: any) {
      alert('Failed to delete banner: ' + err.message);
      fetchBanners();
    }
  };

  // Curated High-Definition Automotive Carousel Presets
  const CAROUSEL_PRESETS = [
    {
      name: 'Supercar Drops',
      badge: '🔥 LIVE AUCTIONS DAILY',
      title: 'AutoBid Premier Live Auctions',
      subtitle: 'Bid on authenticated luxury supercars, verified salvage exotics, and daily drivers with real-time transparent bidding.',
      imageUrl: 'https://images.unsplash.com/photo-1617814076367-b759c7d7e738?auto=format&fit=crop&w=1600&q=80',
      targetUrl: '/auctions',
      ctaText: 'Explore Live Auctions →'
    },
    {
      name: 'Zero Seller Fees',
      badge: '⚡ SPECIAL PROMOTION',
      title: 'Zero Seller Listing Fees This Weekend',
      subtitle: 'List your sports car or trade vehicle with instant RC verification, professional HD video inspections, and verified buyer reach.',
      imageUrl: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1600&q=80',
      targetUrl: '/sell',
      ctaText: 'List Your Vehicle Free →'
    },
    {
      name: 'AI Stock Intel',
      badge: '🧠 AI STOCK INTEL',
      title: 'Unlock Stock Insights Analytics',
      subtitle: 'Gain algorithmic valuation predictions, historical bid velocity data, and market resale margins before placing your bids.',
      imageUrl: 'https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?auto=format&fit=crop&w=1600&q=80',
      targetUrl: '/wallet',
      ctaText: 'Unlock Analytics Intel →'
    },
    {
      name: 'Salvage Exotics',
      badge: '🛠️ SALVAGE & RESTO',
      title: 'High Margin Salvage & Builder Exotics',
      subtitle: 'Access clean-title repairable vehicles and track platforms with transparent damage disclosures and comprehensive damage reports.',
      imageUrl: 'https://images.unsplash.com/photo-1544829099-b9a0c07fad1a?auto=format&fit=crop&w=1600&q=80',
      targetUrl: '/auctions',
      ctaText: 'Browse Salvage Drops →'
    },
    {
      name: 'Collector Vault',
      badge: '💎 COLLECTOR VAULT',
      title: 'Vintage & Heritage Classic Collectibles',
      subtitle: 'Curated investment-grade classics with documented provenance, verified odometer records, and dedicated concierge transport.',
      imageUrl: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=1600&q=80',
      targetUrl: '/auctions',
      ctaText: 'Enter Collector Vault →'
    },
    {
      name: 'Electric Fleet',
      badge: '⚡ EV REVOLUTION',
      title: 'Next-Gen Performance Electric Fleet',
      subtitle: 'Certified battery state-of-health diagnostics, dual-motor performance trims, and instant pre-approval financing options.',
      imageUrl: 'https://images.unsplash.com/photo-1563720223185-11003d516935?auto=format&fit=crop&w=1600&q=80',
      targetUrl: '/inventory',
      ctaText: 'View Electric Fleet →'
    }
  ];

  const TARGET_LINK_PRESETS = [
    { label: 'Auctions Marketplace', path: '/auctions' },
    { label: 'Sell / List Car', path: '/sell' },
    { label: 'Wallet & Stock Intel', path: '/wallet' },
    { label: 'Vehicle Inventory', path: '/inventory' },
    { label: 'User Profile', path: '/profile' }
  ];

  const BADGE_PRESETS = [
    '🔥 LIVE AUCTIONS DAILY',
    '⚡ SPECIAL PROMOTION',
    '🧠 AI STOCK INTEL',
    '🛠️ SALVAGE & RESTO',
    '💎 COLLECTOR VAULT',
    '⚡ EV REVOLUTION',
    '📢 ANNOUNCEMENT'
  ];

  // Open Edit Modal for a Banner (Pre-populate with its slides or create default)
  const handleOpenEditModal = (banner: ContentBanner) => {
    const initialSlides: CarouselSlide[] = (banner.slides && banner.slides.length > 0)
      ? JSON.parse(JSON.stringify(banner.slides))
      : [
          {
            id: `slide_1`,
            title: banner.title || 'AutoBid Premier Live Auctions',
            subtitle: banner.subtitle || '',
            imageUrl: banner.imageUrl || 'https://images.unsplash.com/photo-1617814076367-b759c7d7e738?auto=format&fit=crop&w=1600&q=80',
            targetUrl: banner.targetUrl || '/auctions',
            badge: banner.badge || '🔥 FEATURED',
            ctaText: banner.ctaText || 'Learn More →'
          }
        ];

    setEditingBanner({
      ...banner,
      isCarousel: banner.isCarousel ?? (initialSlides.length > 1),
      slides: initialSlides
    });
    setEditSlidePreviewIndex(0);
    setEditActiveTab('slides');
    setShowPresetPickerForSlide(null);
  };

  // Add a new slide to the carousel
  const handleAddSlide = () => {
    if (!editingBanner) return;
    const currentSlides = editingBanner.slides || [];
    const presetIndex = currentSlides.length % CAROUSEL_PRESETS.length;
    const preset = CAROUSEL_PRESETS[presetIndex];

    const newSlide: CarouselSlide = {
      id: `slide_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title: `${preset.title} #${currentSlides.length + 1}`,
      subtitle: preset.subtitle,
      imageUrl: preset.imageUrl,
      targetUrl: preset.targetUrl,
      badge: preset.badge,
      ctaText: preset.ctaText
    };

    const nextSlides = [...currentSlides, newSlide];
    setEditingBanner({
      ...editingBanner,
      isCarousel: true,
      slides: nextSlides
    });
    setEditSlidePreviewIndex(nextSlides.length - 1);
  };

  // Remove a slide from the carousel
  const handleRemoveSlide = (slideIndex: number) => {
    if (!editingBanner) return;
    const currentSlides = editingBanner.slides || [];
    if (currentSlides.length <= 1) {
      alert('A carousel must contain at least one slide. You can edit this slide or change the banner image.');
      return;
    }

    const slideToRemove = currentSlides[slideIndex];
    if (!window.confirm(`Remove slide "${slideToRemove.title || `Slide #${slideIndex + 1}`}" from this carousel?`)) {
      return;
    }

    const nextSlides = currentSlides.filter((_, idx) => idx !== slideIndex);
    setEditingBanner({
      ...editingBanner,
      slides: nextSlides
    });
    setEditSlidePreviewIndex(prev => Math.min(prev, nextSlides.length - 1));
  };

  // Move slide up or down in sequence
  const handleMoveSlide = (slideIndex: number, direction: 'up' | 'down') => {
    if (!editingBanner) return;
    const currentSlides = [...(editingBanner.slides || [])];
    const targetIndex = direction === 'up' ? slideIndex - 1 : slideIndex + 1;
    if (targetIndex < 0 || targetIndex >= currentSlides.length) return;

    const temp = currentSlides[slideIndex];
    currentSlides[slideIndex] = currentSlides[targetIndex];
    currentSlides[targetIndex] = temp;

    setEditingBanner({
      ...editingBanner,
      slides: currentSlides
    });
    setEditSlidePreviewIndex(targetIndex);
  };

  // Update specific field on a slide
  const handleUpdateSlideField = (slideIndex: number, field: keyof CarouselSlide, value: string) => {
    if (!editingBanner) return;
    const currentSlides = [...(editingBanner.slides || [])];
    if (!currentSlides[slideIndex]) return;

    currentSlides[slideIndex] = {
      ...currentSlides[slideIndex],
      [field]: value
    };

    const updatedBanner: ContentBanner = {
      ...editingBanner,
      slides: currentSlides
    };

    // If updating first slide image or targetUrl, keep banner root fields in sync
    if (slideIndex === 0) {
      if (field === 'imageUrl') updatedBanner.imageUrl = value;
      if (field === 'targetUrl') updatedBanner.targetUrl = value;
    }

    setEditingBanner(updatedBanner);
  };

  // Apply a curated preset to an existing slide
  const handleApplyPresetToSlide = (slideIndex: number, preset: typeof CAROUSEL_PRESETS[0]) => {
    if (!editingBanner) return;
    const currentSlides = [...(editingBanner.slides || [])];
    if (!currentSlides[slideIndex]) return;

    currentSlides[slideIndex] = {
      ...currentSlides[slideIndex],
      title: preset.title,
      subtitle: preset.subtitle,
      imageUrl: preset.imageUrl,
      targetUrl: preset.targetUrl,
      badge: preset.badge,
      ctaText: preset.ctaText
    };

    const updatedBanner: ContentBanner = {
      ...editingBanner,
      slides: currentSlides
    };
    if (slideIndex === 0) {
      updatedBanner.imageUrl = preset.imageUrl;
      updatedBanner.targetUrl = preset.targetUrl;
    }

    setEditingBanner(updatedBanner);
    setShowPresetPickerForSlide(null);
  };

  // Save all carousel & banner edits live to server & Firestore
  const handleSaveEditedBanner = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!editingBanner) return;

    setIsSavingEdit(true);
    try {
      const bannerToSave: ContentBanner = {
        ...editingBanner,
        title: editingBanner.title.trim() || 'Promotional Banner',
        subtitle: editingBanner.subtitle?.trim() || '',
        imageUrl: editingBanner.slides?.[0]?.imageUrl || editingBanner.imageUrl || 'https://images.unsplash.com/photo-1617814076367-b759c7d7e738?auto=format&fit=crop&w=1600&q=80',
        targetUrl: editingBanner.slides?.[0]?.targetUrl || editingBanner.targetUrl || '/auctions',
        updatedAt: Date.now()
      };

      // 1. Optimistic update locally
      serverBannersRef.current.set(bannerToSave.id, bannerToSave);
      firestoreBannersRef.current.set(bannerToSave.id, bannerToSave);
      setBanners(prev => prev.map(b => b.id === bannerToSave.id ? bannerToSave : b));

      // 2. Save to server backend
      const res = await fetch('/api/banners/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banner: bannerToSave })
      });
      if (!res.ok) {
        throw new Error('Server returned HTTP ' + res.status);
      }

      // 3. Save to Firestore
      try {
        await setDoc(doc(db, 'content_banners', bannerToSave.id), bannerToSave);
      } catch (fErr) {
        console.warn('Firestore fallback on banner update:', fErr);
      }

      await logAdminAction(
        currentUser,
        'UPDATE_BANNER_SLIDES',
        'content_banners',
        bannerToSave.id,
        `Updated carousel banner "${bannerToSave.title}" with ${bannerToSave.slides?.length || 0} slides`
      );

      setActionSuccessMsg(`✓ Banner "${bannerToSave.title}" updated successfully with ${bannerToSave.slides?.length || 0} slides!`);
      setTimeout(() => setActionSuccessMsg(null), 4000);
      setEditingBanner(null);
    } catch (err: any) {
      alert('Failed to save banner updates: ' + err.message);
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Create Banner
  const handleCreateBanner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBanner.title.trim()) return;

    const bannerToSave: ContentBanner = {
      id: `banner_${Date.now()}`,
      title: newBanner.title.trim(),
      subtitle: newBanner.subtitle.trim(),
      imageUrl: newBanner.imageUrl.trim() || 'https://images.unsplash.com/photo-1617814076367-b759c7d7e738?auto=format&fit=crop&w=1600&q=80',
      targetUrl: newBanner.targetUrl.trim() || '/auctions',
      position: newBanner.position,
      isActive: newBanner.isActive,
      createdAt: Date.now(),
      isCarousel: newBanner.isCarousel,
      slides: newBanner.slides,
      publishedBy: currentUser.email
    };

    // Optimistic add
    setBanners(prev => [bannerToSave, ...prev]);
    setShowAddModal(false);

    try {
      // Save to server
      await fetch('/api/banners/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banner: bannerToSave })
      });

      // Save to Firestore
      try {
        await setDoc(doc(db, 'content_banners', bannerToSave.id), bannerToSave);
      } catch {}

      await logAdminAction(
        currentUser,
        'CREATE_BANNER',
        'content_banners',
        bannerToSave.id,
        `Created ${bannerToSave.position} banner: "${bannerToSave.title}"`
      );

      setNewBanner({
        title: '',
        subtitle: '',
        imageUrl: '',
        targetUrl: '/auctions',
        position: 'hero',
        isActive: true,
        isCarousel: false,
        slides: []
      });

      setActionSuccessMsg(`✓ Banner "${bannerToSave.title}" created successfully!`);
      setTimeout(() => setActionSuccessMsg(null), 3500);
    } catch (err: any) {
      alert('Failed to create banner: ' + err.message);
      fetchBanners();
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Toast Notification */}
      {actionSuccessMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-900 text-xs font-bold flex items-center justify-between shadow-xs animate-fade-in">
          <span className="flex items-center gap-2">
            <span>🎉</span>
            <span>{actionSuccessMsg}</span>
          </span>
          <button onClick={() => setActionSuccessMsg(null)} className="text-emerald-700 hover:text-emerald-900 font-bold cursor-pointer">✕</button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-2xl border border-gray-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></span>
            <h2 className="text-xl font-bold text-gray-900">Module 2: Content Management (CMS)</h2>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Manage all marketing hero carousels, multi-slide banners, and site announcements with real-time publish, deactivation, and deletion.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchBanners}
            className="px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-xs rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer transition"
          >
            🔄 Refresh Banners
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-700 hover:to-orange-600 text-white font-semibold text-xs rounded-xl shadow-xs flex items-center gap-2 cursor-pointer transition"
          >
            <span>+</span>
            <span>Add Promotional Banner</span>
          </button>
        </div>
      </div>

      {/* Global Announcement Bar Editor */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">📢</span>
            <h3 className="font-bold text-gray-900 text-sm">Global Top Announcement Bar</h3>
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-gray-700">
            <input
              type="checkbox"
              checked={announcement.active}
              onChange={(e) => setAnnouncement(prev => ({ ...prev, active: e.target.checked }))}
              className="w-4 h-4 rounded text-red-600 focus:ring-red-500 cursor-pointer"
            />
            Display Bar on Site
          </label>
        </div>

        <form onSubmit={handleSaveAnnouncement} className="space-y-3">
          <div>
            <input
              type="text"
              value={announcement.text}
              onChange={(e) => setAnnouncement(prev => ({ ...prev, text: e.target.value }))}
              placeholder="e.g. ⚡ Special Weekend Flash Auction: 100+ Verified Cars Ending Today!"
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-gray-900 outline-none"
              required
            />
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500 flex-wrap gap-2">
            <span>Preview: <span className="font-semibold text-red-600">{announcement.text || 'No text set'}</span></span>
            <button
              type="submit"
              disabled={isSavingAnnouncement}
              className="px-4 py-1.5 bg-gray-900 hover:bg-black text-white font-semibold rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isSavingAnnouncement ? 'Saving...' : 'Save & Publish Live'}
            </button>
          </div>
        </form>
      </div>

      {/* Banners Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
            <span>🖼️</span>
            <span>Active Marketing & Carousel Banners ({banners.length})</span>
          </h3>
          <span className="text-xs text-gray-400">
            {banners.filter(b => b.isActive).length} Active Live • {banners.filter(b => !b.isActive).length} Inactive
          </span>
        </div>

        {isLoading ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-gray-200 text-gray-400">
            <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
            <p className="text-xs font-bold text-gray-600">Loading Banners & Carousels...</p>
          </div>
        ) : banners.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-gray-200 text-gray-400">
            <span className="text-4xl mb-2 block">🖼️</span>
            <p className="font-bold text-sm text-gray-700">No promotional banners currently in database.</p>
            <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
              All banners have been deleted or none have been published. Click "Add Promotional Banner" or command the AI Brain to draft one.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {banners.map(banner => {
              const isCarousel = Boolean(banner.isCarousel && banner.slides && banner.slides.length > 0);
              const slides = banner.slides || [];
              const currentSlideIndex = activeSlideMap[banner.id] || 0;
              const currentSlide = isCarousel ? (slides[currentSlideIndex] || slides[0]) : null;

              return (
                <div key={banner.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-xs flex flex-col justify-between group hover:shadow-md transition">
                  {/* Visual Top Preview */}
                  {isCarousel ? (
                    <div className="h-44 bg-gray-950 overflow-hidden relative group">
                      <img
                        src={currentSlide?.imageUrl || banner.imageUrl}
                        alt={currentSlide?.title || banner.title}
                        className="w-full h-full object-cover object-center"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3 flex flex-col justify-between text-white">
                        <div className="flex items-center justify-between">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-purple-600 text-white shadow-xs">
                            🎠 Carousel ({slides.length} Slides)
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            banner.isActive ? 'bg-emerald-500 text-white' : 'bg-gray-500 text-white'
                          }`}>
                            {banner.isActive ? 'Live' : 'Inactive'}
                          </span>
                        </div>
                        <div>
                          {currentSlide?.badge && (
                            <span className="text-[9px] font-black text-red-400 uppercase tracking-wider block mb-0.5">
                              {currentSlide.badge}
                            </span>
                          )}
                          <h4 className="font-black text-xs text-white line-clamp-1">{currentSlide?.title || banner.title}</h4>
                          <span className="text-[10px] text-gray-300 font-mono block truncate">
                            Attached: {currentSlide?.targetUrl || banner.targetUrl || '/auctions'}
                          </span>
                        </div>
                      </div>

                      {/* Carousel Slide Switcher Arrows */}
                      {slides.length > 1 && (
                        <div className="absolute inset-y-0 inset-x-2 flex items-center justify-between pointer-events-none">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveSlideMap(prev => ({
                                ...prev,
                                [banner.id]: (currentSlideIndex - 1 + slides.length) % slides.length
                              }));
                            }}
                            className="pointer-events-auto w-7 h-7 rounded-full bg-black/60 hover:bg-black text-white text-xs flex items-center justify-center font-bold cursor-pointer"
                          >
                            ‹
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveSlideMap(prev => ({
                                ...prev,
                                [banner.id]: (currentSlideIndex + 1) % slides.length
                              }));
                            }}
                            className="pointer-events-auto w-7 h-7 rounded-full bg-black/60 hover:bg-black text-white text-xs flex items-center justify-center font-bold cursor-pointer"
                          >
                            ›
                          </button>
                        </div>
                      )}
                    </div>
                  ) : banner.imageUrl ? (
                    <div className="h-44 bg-gray-100 overflow-hidden relative">
                      <img src={banner.imageUrl} alt={banner.title} className="w-full h-full object-cover" />
                      <div className="absolute top-2 left-2 flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/70 text-white uppercase">
                          {banner.position}
                        </span>
                      </div>
                      <span className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-black ${banner.isActive ? 'bg-emerald-500 text-white' : 'bg-gray-400 text-white'}`}>
                        {banner.isActive ? 'Live' : 'Inactive'}
                      </span>
                    </div>
                  ) : (
                    <div className="h-32 bg-gradient-to-tr from-gray-900 to-gray-800 p-4 flex flex-col justify-between text-white">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{banner.position}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${banner.isActive ? 'bg-emerald-500 text-white' : 'bg-gray-500 text-white'}`}>
                          {banner.isActive ? 'Live' : 'Inactive'}
                        </span>
                      </div>
                      <h4 className="font-bold text-base truncate">{banner.title}</h4>
                    </div>
                  )}

                  {/* Body Details */}
                  <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <h4 className="font-black text-gray-900 text-sm">{banner.title}</h4>
                      </div>
                      {banner.subtitle && (
                        <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{banner.subtitle}</p>
                      )}

                      {/* Display Slides List if Carousel */}
                      {isCarousel && slides.length > 0 && (
                        <div className="mt-2.5 p-2 bg-gray-50 rounded-xl border border-gray-100 space-y-1">
                          <span className="text-[10px] font-bold uppercase text-gray-400 block">
                            Carousel Pages ({slides.length}):
                          </span>
                          <div className="space-y-1">
                            {slides.map((s, idx) => (
                              <div key={idx} className="flex items-center justify-between text-[11px]">
                                <span className="font-semibold text-gray-800 truncate max-w-[150px]">
                                  {idx + 1}. {s.title}
                                </span>
                                <span className="font-mono text-purple-700 text-[10px] bg-purple-50 px-1.5 py-0.2 rounded">
                                  {s.targetUrl || '/auctions'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {!isCarousel && banner.targetUrl && (
                        <div className="text-[11px] text-purple-700 font-mono truncate mt-1.5">
                          Attached Link: <span className="font-bold">{banner.targetUrl}</span>
                        </div>
                      )}
                    </div>

                    {/* Action Controls */}
                    <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(banner)}
                        className="px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 shadow-2xs hover:shadow-xs active:scale-95"
                      >
                        <span>✏️ Edit Slides</span>
                        {isCarousel && (
                          <span className="px-1.5 py-0.2 rounded-full bg-blue-200/70 text-[10px] text-blue-900 font-extrabold">
                            {slides.length}
                          </span>
                        )}
                      </button>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleToggleBanner(banner)}
                          className={`px-3 py-1.5 rounded-xl font-bold transition-colors cursor-pointer flex items-center gap-1 ${
                            banner.isActive 
                              ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200' 
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                          }`}
                        >
                          <span>{banner.isActive ? '⏸ Deactivate' : '🚀 Publish Live'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteBanner(banner)}
                          className="px-2.5 py-1.5 text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-xl font-bold transition-colors cursor-pointer border border-red-200"
                          title="Delete banner permanently"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Banner Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-gray-100">
            <div className="flex justify-between items-center">
              <h3 className="font-black text-gray-900 text-base">Create New Marketing Banner</h3>
              <button onClick={() => setShowAddModal(false)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center font-bold text-xs cursor-pointer">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateBanner} className="space-y-3 text-xs">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Banner Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Festival Season Luxury Vehicle Clearance"
                  value={newBanner.title}
                  onChange={(e) => setNewBanner(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Subtitle / Callout Text</label>
                <input
                  type="text"
                  placeholder="e.g. 50+ Verified Luxury Cars Starting With Zero Reserve"
                  value={newBanner.subtitle}
                  onChange={(e) => setNewBanner(prev => ({ ...prev, subtitle: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Image URL (High Res)</label>
                <input
                  type="url"
                  placeholder="https://images.unsplash.com/..."
                  value={newBanner.imageUrl}
                  onChange={(e) => setNewBanner(prev => ({ ...prev, imageUrl: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Target Action Link</label>
                  <input
                    type="text"
                    placeholder="/auctions or /sell"
                    value={newBanner.targetUrl}
                    onChange={(e) => setNewBanner(prev => ({ ...prev, targetUrl: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Position</label>
                  <select
                    value={newBanner.position}
                    onChange={(e) => setNewBanner(prev => ({ ...prev, position: e.target.value as any }))}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none cursor-pointer"
                  >
                    <option value="hero">Hero Top Banner</option>
                    <option value="top_bar">Top Announcement Bar</option>
                    <option value="footer">Footer Banner</option>
                    <option value="popup">Modal Pop-up</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="isActiveToggle"
                  checked={newBanner.isActive}
                  onChange={(e) => setNewBanner(prev => ({ ...prev, isActive: e.target.checked }))}
                  className="w-4 h-4 rounded text-red-600 focus:ring-red-500 cursor-pointer"
                />
                <label htmlFor="isActiveToggle" className="font-bold text-gray-800 cursor-pointer">
                  Publish Live Immediately
                </label>
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-700 hover:to-orange-600 text-white font-black rounded-xl text-xs shadow-md cursor-pointer"
                >
                  Create & Save Banner
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Banner & Carousel Slides Modal */}
      {editingBanner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-xs animate-fade-in overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-4xl w-full my-auto shadow-2xl border border-gray-100 flex flex-col max-h-[92vh] overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-purple-600 to-blue-600 flex items-center justify-center text-white text-lg shadow-sm">
                  🎠
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-black text-gray-900 text-base">Edit Banner & Carousel Slides</h3>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-purple-100 text-purple-700 border border-purple-200">
                      {editingBanner.slides?.length || 1} Slides
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${editingBanner.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>
                      {editingBanner.isActive ? 'Active Live' : 'Inactive Draft'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Customize images, destination links, badges, add more slides, or delete slides with real-time preview.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setEditingBanner(null)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center font-bold text-xs cursor-pointer transition"
              >
                ✕
              </button>
            </div>

            {/* Modal Body: Scrollable */}
            <div className="p-5 overflow-y-auto space-y-6 flex-1">
              {/* 1. Live Interactive Player Preview */}
              {editingBanner.slides && editingBanner.slides.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                      <span>👁️</span>
                      <span>Live Homepage Player Preview (Slide #{editSlidePreviewIndex + 1} of {editingBanner.slides.length})</span>
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditSlidePreviewIndex(prev => (prev - 1 + editingBanner.slides!.length) % editingBanner.slides!.length)}
                        className="px-2 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold cursor-pointer"
                      >
                        ‹ Prev
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditSlidePreviewIndex(prev => (prev + 1) % editingBanner.slides!.length)}
                        className="px-2 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold cursor-pointer"
                      >
                        Next ›
                      </button>
                    </div>
                  </div>

                  {(() => {
                    const currentSlide = editingBanner.slides[editSlidePreviewIndex] || editingBanner.slides[0];
                    return (
                      <div className="relative rounded-2xl overflow-hidden h-48 sm:h-56 bg-gray-950 border border-gray-900/10 shadow-md">
                        <img
                          src={currentSlide.imageUrl || 'https://images.unsplash.com/photo-1617814076367-b759c7d7e738?auto=format&fit=crop&w=1600&q=80'}
                          alt={currentSlide.title}
                          className="w-full h-full object-cover object-center"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/30 p-4 sm:p-5 flex flex-col justify-between text-white pointer-events-none">
                          <div className="flex items-center justify-between pointer-events-auto">
                            {currentSlide.badge && (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-red-600/90 text-white shadow-xs backdrop-blur-xs">
                                {currentSlide.badge}
                              </span>
                            )}
                            <span className="text-[10px] font-mono text-gray-300 bg-black/60 px-2 py-0.5 rounded-full">
                              Slide {editSlidePreviewIndex + 1} / {editingBanner.slides.length}
                            </span>
                          </div>

                          <div className="space-y-1 max-w-xl pointer-events-auto">
                            <h4 className="text-base sm:text-lg font-black text-white leading-tight">
                              {currentSlide.title || 'Untitled Slide'}
                            </h4>
                            {currentSlide.subtitle && (
                              <p className="text-xs text-gray-200 line-clamp-2 leading-relaxed">
                                {currentSlide.subtitle}
                              </p>
                            )}
                            <div className="pt-1.5 flex items-center gap-2 flex-wrap">
                              <span className="px-3 py-1 rounded-lg bg-gradient-to-r from-red-600 to-orange-500 text-white font-bold text-xs shadow-xs">
                                {currentSlide.ctaText || 'Learn More →'}
                              </span>
                              <span className="text-[10px] text-gray-300 font-mono bg-white/10 px-2 py-0.5 rounded-md">
                                Target: {currentSlide.targetUrl || '/auctions'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Slide Selector Indicator Dots */}
                        <div className="absolute bottom-2.5 right-3 flex items-center gap-1.5 z-10">
                          {editingBanner.slides.map((_, sIdx) => (
                            <button
                              key={sIdx}
                              type="button"
                              onClick={() => setEditSlidePreviewIndex(sIdx)}
                              className={`h-2 rounded-full transition-all cursor-pointer ${
                                sIdx === editSlidePreviewIndex ? 'w-6 bg-red-500' : 'w-2 bg-white/60 hover:bg-white'
                              }`}
                              title={`Jump to Slide #${sIdx + 1}`}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* 2. Navigation Tabs */}
              <div className="flex items-center justify-between border-b border-gray-200">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditActiveTab('slides')}
                    className={`pb-2.5 px-3 font-bold text-xs cursor-pointer border-b-2 transition ${
                      editActiveTab === 'slides'
                        ? 'border-purple-600 text-purple-700'
                        : 'border-transparent text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    🎠 Carousel Slides ({editingBanner.slides?.length || 0})
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditActiveTab('banner')}
                    className={`pb-2.5 px-3 font-bold text-xs cursor-pointer border-b-2 transition ${
                      editActiveTab === 'banner'
                        ? 'border-purple-600 text-purple-700'
                        : 'border-transparent text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    ⚙️ Overall Banner Settings
                  </button>
                </div>

                {editActiveTab === 'slides' && (
                  <button
                    type="button"
                    onClick={handleAddSlide}
                    className="mb-1.5 px-3.5 py-1.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer transition active:scale-95"
                  >
                    <span>➕</span>
                    <span>Add New Slide</span>
                  </button>
                )}
              </div>

              {/* 3. Tab: Carousel Slides Editor */}
              {editActiveTab === 'slides' && (
                <div className="space-y-4">
                  {/* Curated Presets Bar */}
                  <div className="p-3 bg-purple-50/70 border border-purple-100 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">✨</span>
                      <div>
                        <span className="font-bold text-xs text-purple-900 block">Quick Automotive Slide Presets</span>
                        <span className="text-[11px] text-purple-700">Click any preset to append it directly as a new high-definition slide.</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {CAROUSEL_PRESETS.map((p, pIdx) => (
                        <button
                          key={pIdx}
                          type="button"
                          onClick={() => {
                            const newSlide: CarouselSlide = {
                              id: `slide_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                              title: p.title,
                              subtitle: p.subtitle,
                              imageUrl: p.imageUrl,
                              targetUrl: p.targetUrl,
                              badge: p.badge,
                              ctaText: p.ctaText
                            };
                            const next = [...(editingBanner.slides || []), newSlide];
                            setEditingBanner({ ...editingBanner, isCarousel: true, slides: next });
                            setEditSlidePreviewIndex(next.length - 1);
                          }}
                          className="px-2.5 py-1 bg-white hover:bg-purple-100 text-purple-800 border border-purple-200 rounded-lg text-[11px] font-bold shadow-2xs cursor-pointer transition"
                        >
                          + {p.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Slides List */}
                  <div className="space-y-4">
                    {editingBanner.slides && editingBanner.slides.map((slide, sIdx) => {
                      const isCurrentPreview = sIdx === editSlidePreviewIndex;
                      return (
                        <div
                          key={slide.id || sIdx}
                          className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                            isCurrentPreview
                              ? 'bg-purple-50/30 border-purple-300 ring-2 ring-purple-100 shadow-sm'
                              : 'bg-gray-50/70 border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          {/* Slide Card Header */}
                          <div className="flex items-center justify-between pb-3 border-b border-gray-200/80 flex-wrap gap-2">
                            <div className="flex items-center gap-2.5">
                              <img
                                src={slide.imageUrl || 'https://images.unsplash.com/photo-1617814076367-b759c7d7e738?auto=format&fit=crop&w=400&q=80'}
                                alt="Thumb"
                                className="w-12 h-8 rounded-lg object-cover border border-gray-300"
                              />
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-gray-900 text-white">
                                    Slide #{sIdx + 1}
                                  </span>
                                  <h4 className="font-bold text-xs text-gray-900 truncate max-w-[200px]">
                                    {slide.title || 'Untitled Slide'}
                                  </h4>
                                </div>
                                <span className="text-[10px] font-mono text-purple-700 block truncate">
                                  Link: {slide.targetUrl || '/auctions'}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setEditSlidePreviewIndex(sIdx)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition ${
                                  isCurrentPreview
                                    ? 'bg-purple-600 text-white'
                                    : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                                }`}
                              >
                                {isCurrentPreview ? '✓ Viewing' : '👁️ View'}
                              </button>
                              <button
                                type="button"
                                disabled={sIdx === 0}
                                onClick={() => handleMoveSlide(sIdx, 'up')}
                                className="w-7 h-7 rounded-lg bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center font-bold text-xs cursor-pointer"
                                title="Move Slide Up"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                disabled={sIdx === (editingBanner.slides?.length || 1) - 1}
                                onClick={() => handleMoveSlide(sIdx, 'down')}
                                className="w-7 h-7 rounded-lg bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center font-bold text-xs cursor-pointer"
                                title="Move Slide Down"
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                disabled={(editingBanner.slides?.length || 0) <= 1}
                                onClick={() => handleRemoveSlide(sIdx)}
                                className="px-2.5 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1"
                                title="Delete this slide"
                              >
                                <span>🗑️</span>
                                <span>Delete Slide</span>
                              </button>
                            </div>
                          </div>

                          {/* Slide Fields Grid */}
                          <div className="pt-3.5 space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="block text-[11px] font-bold text-gray-700 mb-1">
                                  Slide Title *
                                </label>
                                <input
                                  type="text"
                                  value={slide.title || ''}
                                  onChange={(e) => handleUpdateSlideField(sIdx, 'title', e.target.value)}
                                  placeholder="e.g. AutoBid Premier Supercar Auctions"
                                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-purple-600"
                                />
                              </div>

                              <div>
                                <label className="block text-[11px] font-bold text-gray-700 mb-1">
                                  Badge Label (Optional)
                                </label>
                                <input
                                  type="text"
                                  value={slide.badge || ''}
                                  onChange={(e) => handleUpdateSlideField(sIdx, 'badge', e.target.value)}
                                  placeholder="e.g. 🔥 LIVE AUCTIONS DAILY"
                                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-purple-600"
                                />
                                <div className="flex items-center gap-1 mt-1 flex-wrap">
                                  {BADGE_PRESETS.slice(0, 4).map((bg, bIdx) => (
                                    <button
                                      key={bIdx}
                                      type="button"
                                      onClick={() => handleUpdateSlideField(sIdx, 'badge', bg)}
                                      className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 cursor-pointer"
                                    >
                                      {bg}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-gray-700 mb-1">
                                Subtitle / Hook Description
                              </label>
                              <textarea
                                rows={2}
                                value={slide.subtitle || ''}
                                onChange={(e) => handleUpdateSlideField(sIdx, 'subtitle', e.target.value)}
                                placeholder="e.g. Bid on authenticated luxury supercars with real-time transparent bidding."
                                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-purple-600 resize-none"
                              />
                            </div>

                            {/* Slide Image URL & Presets */}
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label className="block text-[11px] font-bold text-gray-700">
                                  Slide Image URL (High Definition) *
                                </label>
                                <button
                                  type="button"
                                  onClick={() => setShowPresetPickerForSlide(showPresetPickerForSlide === sIdx ? null : sIdx)}
                                  className="text-[10px] font-bold text-purple-700 hover:text-purple-900 cursor-pointer"
                                >
                                  {showPresetPickerForSlide === sIdx ? '✕ Close Presets' : '🖼️ Choose Automotive Preset'}
                                </button>
                              </div>
                              <input
                                type="url"
                                value={slide.imageUrl || ''}
                                onChange={(e) => handleUpdateSlideField(sIdx, 'imageUrl', e.target.value)}
                                placeholder="https://images.unsplash.com/photo-..."
                                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-mono outline-none focus:ring-2 focus:ring-purple-600"
                              />

                              {/* Dropdown of presets if open */}
                              {showPresetPickerForSlide === sIdx && (
                                <div className="mt-2 p-3 bg-white border border-purple-200 rounded-2xl shadow-md grid grid-cols-2 sm:grid-cols-3 gap-2 animate-fade-in">
                                  {CAROUSEL_PRESETS.map((preset, prIdx) => (
                                    <div
                                      key={prIdx}
                                      onClick={() => handleApplyPresetToSlide(sIdx, preset)}
                                      className="group/pr relative rounded-xl overflow-hidden border border-gray-200 hover:border-purple-500 cursor-pointer transition flex flex-col justify-between"
                                    >
                                      <img
                                        src={preset.imageUrl}
                                        alt={preset.name}
                                        className="h-16 w-full object-cover group-hover/pr:scale-105 transition"
                                      />
                                      <div className="p-1.5 bg-white text-[10px]">
                                        <span className="font-bold text-gray-900 block truncate">{preset.name}</span>
                                        <span className="text-gray-500 text-[9px] block truncate">{preset.title}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Destination Links & CTA */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                              <div>
                                <label className="block text-[11px] font-bold text-gray-700 mb-1">
                                  Destination Link (`targetUrl`) *
                                </label>
                                <input
                                  type="text"
                                  value={slide.targetUrl || ''}
                                  onChange={(e) => handleUpdateSlideField(sIdx, 'targetUrl', e.target.value)}
                                  placeholder="/auctions or /sell"
                                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-mono font-bold text-purple-700 outline-none focus:ring-2 focus:ring-purple-600"
                                />
                                <div className="flex items-center gap-1 mt-1 flex-wrap">
                                  {TARGET_LINK_PRESETS.map((link, lIdx) => (
                                    <button
                                      key={lIdx}
                                      type="button"
                                      onClick={() => handleUpdateSlideField(sIdx, 'targetUrl', link.path)}
                                      className={`text-[9px] font-semibold px-1.5 py-0.5 rounded cursor-pointer ${
                                        slide.targetUrl === link.path ? 'bg-purple-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                                      }`}
                                    >
                                      {link.label}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div>
                                <label className="block text-[11px] font-bold text-gray-700 mb-1">
                                  CTA Button Text
                                </label>
                                <input
                                  type="text"
                                  value={slide.ctaText || ''}
                                  onChange={(e) => handleUpdateSlideField(sIdx, 'ctaText', e.target.value)}
                                  placeholder="e.g. Explore Live Auctions →"
                                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-purple-600"
                                />
                                <span className="text-[10px] text-gray-400 mt-1 block">
                                  Clickable button shown on this slide.
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 4. Tab: Overall Banner Settings */}
              {editActiveTab === 'banner' && (
                <div className="space-y-4 max-w-xl">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Banner Identifier</label>
                    <input
                      type="text"
                      disabled
                      value={editingBanner.id}
                      className="w-full px-3 py-2 bg-gray-100 border border-gray-200 rounded-xl text-xs font-mono text-gray-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Overall Banner Title *</label>
                    <input
                      type="text"
                      value={editingBanner.title}
                      onChange={(e) => setEditingBanner({ ...editingBanner, title: e.target.value })}
                      placeholder="e.g. AutoBid Premier Live Auctions"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-purple-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Overall Subtitle</label>
                    <textarea
                      rows={2}
                      value={editingBanner.subtitle || ''}
                      onChange={(e) => setEditingBanner({ ...editingBanner, subtitle: e.target.value })}
                      placeholder="e.g. Bid on authenticated luxury supercars..."
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-purple-600 resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Display Position</label>
                      <select
                        value={editingBanner.position}
                        onChange={(e) => setEditingBanner({ ...editingBanner, position: e.target.value as any })}
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none cursor-pointer"
                      >
                        <option value="hero">Hero Top Banner</option>
                        <option value="top_bar">Top Announcement Bar</option>
                        <option value="footer">Footer Banner</option>
                        <option value="popup">Modal Pop-up</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Banner Type</label>
                      <div className="flex items-center gap-2 pt-2">
                        <input
                          type="checkbox"
                          id="isCarouselToggle"
                          checked={Boolean(editingBanner.isCarousel)}
                          onChange={(e) => setEditingBanner({ ...editingBanner, isCarousel: e.target.checked })}
                          className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
                        />
                        <label htmlFor="isCarouselToggle" className="font-bold text-gray-800 text-xs cursor-pointer">
                          Multi-Slide Carousel
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-2xl border border-gray-200 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-xs text-gray-900 block">Publish Live Status</span>
                      <span className="text-[11px] text-gray-500">
                        {editingBanner.isActive ? 'Banner is live and visible on the website.' : 'Banner is hidden/inactive on the website.'}
                      </span>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingBanner.isActive}
                        onChange={(e) => setEditingBanner({ ...editingBanner, isActive: e.target.checked })}
                        className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                      />
                      <span className={`text-xs font-bold ${editingBanner.isActive ? 'text-emerald-700' : 'text-gray-500'}`}>
                        {editingBanner.isActive ? 'Active Live' : 'Inactive'}
                      </span>
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-100 flex items-center justify-between bg-gray-50">
              <span className="text-xs text-gray-500 font-semibold">
                Total Slides: <span className="font-bold text-gray-900">{editingBanner.slides?.length || 1}</span>
              </span>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingBanner(null)}
                  className="px-4 py-2 bg-white hover:bg-gray-100 text-gray-700 font-bold rounded-xl text-xs border border-gray-200 cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSavingEdit}
                  onClick={() => handleSaveEditedBanner()}
                  className="px-6 py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-black rounded-xl text-xs shadow-md disabled:opacity-50 cursor-pointer transition flex items-center gap-2 active:scale-95"
                >
                  {isSavingEdit ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Saving Changes...</span>
                    </>
                  ) : (
                    <>
                      <span>💾</span>
                      <span>Save Changes Live</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
