import React, { useState, useEffect } from 'react';
import { db, collection, onSnapshot } from '../firebase';
import { ContentBanner, CarouselSlide } from '../types';

interface HomeBannerCarouselProps {
  onNavigate?: (view: any) => void;
}

export const HomeBannerCarousel: React.FC<HomeBannerCarouselProps> = ({ onNavigate }) => {
  const [banners, setBanners] = useState<ContentBanner[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(0);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);

  // Load active banners from Firestore and server API
  useEffect(() => {
    let unsub: (() => void) | null = null;

    const fetchServerActiveBanners = () => {
      fetch('/api/banners/active')
        .then(res => res.json())
        .then(data => {
          if (data.success && Array.isArray(data.banners)) {
            setBanners(data.banners);
          }
        })
        .catch(() => {});
    };

    fetchServerActiveBanners();

    try {
      unsub = onSnapshot(collection(db, 'content_banners'), (snap) => {
        if (!snap.empty) {
          const list: ContentBanner[] = [];
          snap.forEach(d => {
            const data = d.data() as ContentBanner;
            if (data.isActive !== false) {
              list.push({ id: d.id, ...data });
            }
          });
          list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          setBanners(list);
        } else {
          // If Firestore is empty, check server active banners
          fetchServerActiveBanners();
        }
      }, () => {
        fetchServerActiveBanners();
      });
    } catch {
      fetchServerActiveBanners();
    }

    const pollInterval = setInterval(fetchServerActiveBanners, 4000);

    return () => {
      if (unsub) unsub();
      clearInterval(pollInterval);
    };
  }, []);

  // Flatten active banners into slides:
  // If an active banner is a carousel, take its slides; otherwise treat the banner as a single slide.
  const activeSlides: CarouselSlide[] = React.useMemo(() => {
    if (!banners || banners.length === 0) return [];

    const slidesList: CarouselSlide[] = [];
    banners.forEach(b => {
      if (b.isActive === false) return;
      if (b.isCarousel && b.slides && b.slides.length > 0) {
        b.slides.forEach(s => slidesList.push(s));
      } else {
        slidesList.push({
          id: b.id,
          title: b.title,
          subtitle: b.subtitle,
          imageUrl: b.imageUrl || 'https://images.unsplash.com/photo-1617814076367-b759c7d7e738?auto=format&fit=crop&w=1600&q=80',
          targetUrl: b.targetUrl || '/auctions',
          badge: b.badge || '📢 FEATURED ANNOUNCEMENT',
          ctaText: b.ctaText || 'Learn More →'
        });
      }
    });

    return slidesList;
  }, [banners]);

  // Autoplay timer
  useEffect(() => {
    if (isPaused || activeSlides.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentSlideIndex(prev => (prev + 1) % activeSlides.length);
    }, 5500);
    return () => clearInterval(interval);
  }, [isPaused, activeSlides.length]);

  if (isDismissed || activeSlides.length === 0) return null;

  const currentSlide = activeSlides[currentSlideIndex] || activeSlides[0];

  const handleActionClick = (e: React.MouseEvent, targetUrl?: string) => {
    e.stopPropagation();
    if (!targetUrl) return;

    if (targetUrl.startsWith('http')) {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    if (onNavigate) {
      if (targetUrl.includes('sell')) onNavigate('sell');
      else if (targetUrl.includes('wallet')) onNavigate('wallet');
      else if (targetUrl.includes('stock')) onNavigate('stock');
      else onNavigate('home');
    }
  };

  const goToPrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentSlideIndex(prev => (prev - 1 + activeSlides.length) % activeSlides.length);
  };

  const goToNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentSlideIndex(prev => (prev + 1) % activeSlides.length);
  };

  return (
    <div 
      className="relative mb-5 rounded-3xl overflow-hidden shadow-xl border border-gray-900/10 group select-none transition-all duration-300"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Slide Background Image */}
      <div className="relative h-60 sm:h-72 md:h-80 w-full overflow-hidden bg-gray-950">
        <img
          key={currentSlide.id || currentSlideIndex}
          src={currentSlide.imageUrl}
          alt={currentSlide.title || 'AutoBid Promotional Banner'}
          className="w-full h-full object-cover object-center transform transition-transform duration-700 ease-out scale-100 group-hover:scale-105"
        />

        {/* Cinematic Gradient Overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/30 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/40 to-transparent pointer-events-none" />

        {/* Content Container */}
        <div className="absolute inset-0 z-10 flex flex-col justify-end p-5 sm:p-7 md:p-9 text-white max-w-3xl">
          {currentSlide.badge && (
            <div className="mb-2.5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] sm:text-xs font-black uppercase tracking-wider bg-red-600 text-white shadow-md">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                {currentSlide.badge}
              </span>
            </div>
          )}

          <h2 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-black tracking-tight leading-tight line-clamp-2 drop-shadow-md">
            {currentSlide.title}
          </h2>

          {currentSlide.subtitle && (
            <p className="mt-1.5 text-xs sm:text-sm text-gray-200 line-clamp-2 max-w-xl font-medium drop-shadow-sm leading-relaxed">
              {currentSlide.subtitle}
            </p>
          )}

          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={(e) => handleActionClick(e, currentSlide.targetUrl)}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-700 hover:to-orange-600 text-white text-xs sm:text-sm font-black shadow-lg transition-all transform hover:-translate-y-0.5 cursor-pointer flex items-center gap-2"
            >
              <span>{currentSlide.ctaText || 'Learn More →'}</span>
            </button>

            {currentSlide.targetUrl && (
              <span className="text-[11px] text-gray-300 font-mono hidden sm:inline-block">
                Link: {currentSlide.targetUrl}
              </span>
            )}
          </div>
        </div>

        {/* Carousel Navigation Arrows */}
        {activeSlides.length > 1 && (
          <>
            <button
              type="button"
              onClick={goToPrev}
              aria-label="Previous slide"
              className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-black/40 hover:bg-black/70 backdrop-blur-md text-white border border-white/20 flex items-center justify-center font-bold text-lg transition opacity-80 group-hover:opacity-100 cursor-pointer shadow-md"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={goToNext}
              aria-label="Next slide"
              className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-black/40 hover:bg-black/70 backdrop-blur-md text-white border border-white/20 flex items-center justify-center font-bold text-lg transition opacity-80 group-hover:opacity-100 cursor-pointer shadow-md"
            >
              ›
            </button>
          </>
        )}

        {/* Carousel Slide Indicator Dots */}
        {activeSlides.length > 1 && (
          <div className="absolute bottom-3 right-4 sm:right-6 z-20 flex items-center gap-1.5 bg-black/40 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/10">
            {activeSlides.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentSlideIndex(idx);
                }}
                className={`transition-all duration-300 rounded-full cursor-pointer ${
                  idx === currentSlideIndex 
                    ? 'w-6 h-1.5 bg-red-500' 
                    : 'w-1.5 h-1.5 bg-white/50 hover:bg-white/80'
                }`}
                aria-label={`Go to slide ${idx + 1}`}
              />
            ))}
            <span className="text-[10px] text-white/80 font-mono ml-1">
              {currentSlideIndex + 1}/{activeSlides.length}
            </span>
          </div>
        )}

        {/* Dismiss / Close Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsDismissed(true);
          }}
          title="Dismiss banner"
          className="absolute top-3 right-3 z-20 w-7 h-7 rounded-full bg-black/40 hover:bg-black/70 backdrop-blur-md text-white/80 hover:text-white flex items-center justify-center text-xs border border-white/10 cursor-pointer transition"
        >
          ✕
        </button>
      </div>
    </div>
  );
};
