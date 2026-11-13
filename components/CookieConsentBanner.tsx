import React, { useState, useEffect } from 'react';
import { getCookieConsent, saveCookieConsent, CookiePreferences } from '../utils/cookieManager';

interface CookieConsentBannerProps {
  onOpenPolicy?: () => void;
  isOpenExternal?: boolean;
  onCloseExternal?: () => void;
}

export const CookieConsentBanner: React.FC<CookieConsentBannerProps> = ({
  onOpenPolicy,
  isOpenExternal,
  onCloseExternal
}) => {
  const [showBanner, setShowBanner] = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [preferences, setPreferences] = useState<CookiePreferences>({
    essential: true,
    sessionRecovery: true,
    functional: true,
    analytics: true,
  });

  useEffect(() => {
    const consent = getCookieConsent();
    if (!consent.hasAnswered) {
      // Show banner after brief delay
      const timer = setTimeout(() => setShowBanner(true), 1200);
      return () => clearTimeout(timer);
    } else {
      setPreferences(consent.preferences);
    }
  }, []);

  // External trigger (e.g., from Settings or Footer)
  useEffect(() => {
    if (isOpenExternal) {
      setShowCustomModal(true);
    }
  }, [isOpenExternal]);

  const handleAcceptAll = () => {
    saveCookieConsent('all');
    setShowBanner(false);
    setShowCustomModal(false);
    if (onCloseExternal) onCloseExternal();
  };

  const handleEssentialOnly = () => {
    saveCookieConsent('essential');
    setShowBanner(false);
    setShowCustomModal(false);
    if (onCloseExternal) onCloseExternal();
  };

  const handleSaveCustom = () => {
    saveCookieConsent('custom', preferences);
    setShowBanner(false);
    setShowCustomModal(false);
    if (onCloseExternal) onCloseExternal();
  };

  if (!showBanner && !showCustomModal && !isOpenExternal) {
    return null;
  }

  return (
    <>
      {/* FLOATING COOKIE CONSENT BANNER */}
      {showBanner && !showCustomModal && (
        <aside
          role="region"
          aria-label="Cookie and session recovery consent"
          className="fixed bottom-3 left-3 right-3 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-lg z-50 bg-slate-950/95 backdrop-blur-xl text-white rounded-3xl p-4 sm:p-5 shadow-2xl border border-white/15 animate-fade-in-up"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-400/30 flex items-center justify-center text-xl shrink-0 shadow-inner">
              🍪
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <span>Cookies & Auto-Restore Active</span>
                </h3>
                <span className="text-[10px] bg-amber-500/20 text-amber-300 font-mono px-2 py-0.5 rounded-full font-bold">
                  Session Memory
                </span>
              </div>
              <p className="text-xs text-gray-300 leading-relaxed mb-3">
                AutoBid uses cookies and session storage to save your in-progress vehicle listings (Steps 1–6), identity verification, and wallet transactions so you can resume exactly where you left off if you leave or reopen the site.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleAcceptAll}
                  className="px-4 py-2 bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-700 hover:to-orange-600 text-white font-bold text-xs rounded-xl shadow-md transition cursor-pointer"
                >
                  Accept All & Enable Auto-Restore
                </button>
                <button
                  type="button"
                  onClick={handleEssentialOnly}
                  className="px-3 py-2 bg-white/10 hover:bg-white/20 text-gray-200 font-bold text-xs rounded-xl transition cursor-pointer"
                >
                  Essential Only
                </button>
                <button
                  type="button"
                  onClick={() => setShowCustomModal(true)}
                  className="px-2.5 py-2 text-xs font-semibold text-gray-400 hover:text-white transition underline cursor-pointer"
                >
                  Preferences
                </button>
              </div>

              <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-gray-400">
                <span>Your draft state is retained on this device.</span>
                {onOpenPolicy && (
                  <button
                    type="button"
                    onClick={onOpenPolicy}
                    className="text-amber-400 hover:text-amber-300 underline font-semibold cursor-pointer"
                  >
                    Read Cookie Policy →
                  </button>
                )}
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* CUSTOMIZE COOKIE PREFERENCES MODAL */}
      {showCustomModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-scale-up border border-gray-100">
            {/* Modal Header */}
            <div className="p-5 border-b border-gray-100 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-transparent flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-800 border border-amber-300/40 flex items-center justify-center text-xl font-bold">
                  🍪
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-base">Cookie & Storage Preferences</h3>
                  <p className="text-xs text-gray-500">Configure how AutoBid remembers your work across sessions</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCustomModal(false);
                  if (onCloseExternal) onCloseExternal();
                }}
                className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center justify-center text-xs font-bold transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {/* Category 1: Strictly Necessary */}
              <div className="p-3.5 bg-gray-50 rounded-2xl border border-gray-200/80">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 font-bold text-gray-900 text-sm">
                    <span>🛡️</span>
                    <span>Strictly Necessary Cookies</span>
                  </div>
                  <span className="text-[10px] bg-gray-200 text-gray-700 font-bold px-2 py-0.5 rounded-full">
                    Always Active
                  </span>
                </div>
                <p className="text-gray-500 leading-relaxed">
                  Required for user authentication, security verification, fraud protection, and core auction mechanics. Cannot be switched off.
                </p>
              </div>

              {/* Category 2: In-Progress Draft & Session Recovery (Requested feature!) */}
              <div className="p-3.5 bg-amber-50/70 rounded-2xl border border-amber-200">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 font-bold text-amber-950 text-sm">
                    <span>🔄</span>
                    <span>Workflow Draft & Session Recovery</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preferences.sessionRecovery}
                      onChange={(e) => setPreferences({ ...preferences, sessionRecovery: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
                  </label>
                </div>
                <p className="text-amber-900/80 leading-relaxed">
                  Automatically remembers your vehicle selling progress (step 1 to 6), uploaded car images, identity verification OTP steps, and wallet transactions so you never lose work if you leave or close your browser.
                </p>
              </div>

              {/* Category 3: Functional & Language Preferences */}
              <div className="p-3.5 bg-gray-50 rounded-2xl border border-gray-200/80">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 font-bold text-gray-900 text-sm">
                    <span>🌐</span>
                    <span>Functional & Language Preferences</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preferences.functional}
                      onChange={(e) => setPreferences({ ...preferences, functional: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>
                <p className="text-gray-500 leading-relaxed">
                  Stores your chosen display language (Hindi, Marathi, English, etc.), active theme, and sound settings.
                </p>
              </div>

              {/* Category 4: Performance & Analytics */}
              <div className="p-3.5 bg-gray-50 rounded-2xl border border-gray-200/80">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 font-bold text-gray-900 text-sm">
                    <span>📊</span>
                    <span>Performance & Experience Optimization</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preferences.analytics}
                      onChange={(e) => setPreferences({ ...preferences, analytics: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-gray-900"></div>
                  </label>
                </div>
                <p className="text-gray-500 leading-relaxed">
                  Helps us analyze high-traffic bidding spikes and diagnose network latency for real-time live auctions.
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-100 bg-gray-50 flex flex-wrap items-center justify-between gap-2">
              {onOpenPolicy && (
                <button
                  type="button"
                  onClick={() => {
                    setShowCustomModal(false);
                    onOpenPolicy();
                  }}
                  className="text-xs text-blue-600 hover:underline font-bold"
                >
                  View Full Cookie Policy
                </button>
              )}

              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={handleEssentialOnly}
                  className="px-3.5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-bold rounded-xl transition"
                >
                  Essential Only
                </button>
                <button
                  type="button"
                  onClick={handleSaveCustom}
                  className="px-5 py-2 bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-700 hover:to-orange-600 text-white text-xs font-bold rounded-xl shadow-md transition"
                >
                  Save My Preferences
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
