import React from 'react';
import { User } from '../types';
import { TRANSLATIONS } from '../constants';

interface NavbarProps {
  onNavigate: (page: string) => void;
  activePage: string;
  currentUser?: User;
  currentLanguage?: string;
  onOpenVerification?: () => void;
  unreadChatCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({ 
  onNavigate, 
  activePage, 
  currentUser, 
  currentLanguage = 'English (US)', 
  onOpenVerification,
  unreadChatCount = 0 
}) => {
  // Get translations or fallback to English
  const t = TRANSLATIONS[currentLanguage] || TRANSLATIONS['English (US)'];

  return (
    <nav className="sticky top-0 z-50 px-3 sm:px-6 py-2">
      <div className="max-w-7xl mx-auto glass-panel rounded-xl px-3 sm:px-5">
        <div className="flex items-center justify-between h-13 py-1.5">
          {/* Logo */}
          <div className="flex items-center cursor-pointer group" onClick={() => onNavigate('home')}>
            <span className="text-xl font-bold tracking-tight italic text-gray-900 group-hover:opacity-90 transition-opacity">
              Auto<span className="bg-gradient-to-r from-red-600 to-orange-500 bg-clip-text text-transparent">Bid</span>
            </span>
          </div>

          {/* Desktop Menu */}
          <div className="hidden md:block">
            <div className="flex items-center space-x-1">
              <button
                onClick={() => onNavigate('home')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${activePage === 'home' ? 'bg-red-50 text-red-600 shadow-xs' : 'text-gray-600 hover:bg-gray-100/70 hover:text-gray-900'}`}
              >
                {t.auctions}
              </button>
              <button
                onClick={() => onNavigate('profile')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${activePage === 'profile' ? 'bg-red-50 text-red-600 shadow-xs' : 'text-gray-600 hover:bg-gray-100/70 hover:text-gray-900'}`}
              >
                {t.profile}
              </button>
              <button
                onClick={() => onNavigate('chat')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 relative ${activePage === 'chat' ? 'bg-blue-50 text-blue-600 shadow-xs' : 'text-gray-600 hover:bg-gray-100/70 hover:text-gray-900'}`}
              >
                <span>Chat</span>
                {unreadChatCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full bg-red-600 text-white text-[9px] font-black">
                    {unreadChatCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => onNavigate('support')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${activePage === 'support' ? 'bg-red-50 text-red-600 shadow-xs' : 'text-gray-600 hover:bg-gray-100/70 hover:text-gray-900'}`}
              >
                Help & Support
              </button>
              <button
                onClick={() => onNavigate('sell')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${activePage === 'sell' ? 'bg-red-50 text-red-600 shadow-xs' : 'text-gray-600 hover:bg-gray-100/70 hover:text-gray-900'}`}
              >
                {t.sell}
              </button>
              {(currentUser?.role === 'admin' || currentUser?.role === 'finance' || currentUser?.role === 'accountant' || currentUser?.role === 'support' || currentUser?.role === 'employee') && (
                  <button 
                    onClick={() => onNavigate('admin')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${activePage === 'admin' ? 'bg-gray-900 text-white shadow-xs' : 'text-gray-800 bg-gray-100 hover:bg-gray-200'}`}
                  >
                    Admin Panel
                  </button>
              )}
            </div>
          </div>

          {/* User Avatar / Profile Link or Sign In */}
          <div className="flex items-center gap-2 relative">
            {currentUser ? (
              <>
                {/* Wallet Balance Pill */}
                <button
                  onClick={() => onNavigate('wallet')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                    activePage === 'wallet'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                  }`}
                  title="INR Wallet Balance"
                >
                  <span className="text-sm">🪙</span>
                  <span>₹{(currentUser.deposits || 0).toLocaleString()}</span>
                </button>

                {/* Chat Icon Button beside Wallet */}
                <button
                  onClick={() => onNavigate('chat')}
                  className={`relative flex items-center justify-center p-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    activePage === 'chat'
                      ? 'bg-blue-600 text-white shadow-xs ring-2 ring-blue-300'
                      : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200'
                  }`}
                  title="Messages & Chat History"
                >
                  <svg className="w-4 h-4" fill={activePage === 'chat' ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  {unreadChatCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 text-white text-[9px] font-black rounded-full flex items-center justify-center shadow-xs animate-pulse">
                      {unreadChatCount > 9 ? '9+' : unreadChatCount}
                    </span>
                  )}
                </button>

                {currentUser.isVerified ? (
                  <div 
                    onClick={() => onOpenVerification ? onOpenVerification() : onNavigate('settings')}
                    title="Account Verified: Authorized for Bidding & Selling"
                    className="hidden sm:flex items-center gap-1 px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-[11px] font-bold cursor-pointer hover:bg-emerald-100 transition shadow-xs"
                  >
                    <svg className="w-3.5 h-3.5 text-emerald-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                    <span>Verified</span>
                  </div>
                ) : (
                  <button
                    onClick={() => onOpenVerification ? onOpenVerification() : onNavigate('settings')}
                    title="Click to authenticate your account"
                    className="hidden sm:flex items-center gap-1 px-2.5 py-1 bg-gradient-to-r from-amber-500 to-red-500 text-white rounded-lg text-[11px] font-bold hover:brightness-105 transition shadow-xs cursor-pointer"
                  >
                    <span>🛡️</span>
                    <span>Verify ID</span>
                  </button>
                )}
                <button 
                  onClick={() => onNavigate('profile')}
                  className="w-8 h-8 rounded-full bg-gradient-to-br from-red-600 to-orange-500 p-0.5 shadow-sm hover:scale-105 transition-transform cursor-pointer"
                  title={`@${currentUser.username || 'user'}`}
                >
                  <img 
                    src={currentUser.avatarUrl || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=150"} 
                    alt={currentUser.username || "Profile"} 
                    className="w-full h-full rounded-full border border-white object-cover"
                  />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate('auth')}
                className="bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-700 hover:to-orange-600 text-white text-xs font-bold px-3.5 py-1.5 rounded-lg shadow-sm transition flex items-center gap-1 cursor-pointer"
              >
                <span>Sign In</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};