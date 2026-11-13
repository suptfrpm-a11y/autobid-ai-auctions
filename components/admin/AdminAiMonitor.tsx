import React, { useState, useEffect } from 'react';
import { db, collection, onSnapshot, doc, updateDoc, addDoc, getDocs, query, orderBy } from '../../firebase';
import { User, AiChatSession } from '../../types';
import { logAdminAction } from './adminAuditHelper';

interface AdminAiMonitorProps {
  currentUser: User;
}

export const AdminAiMonitor: React.FC<AdminAiMonitorProps> = ({ currentUser }) => {
  const [sessions, setSessions] = useState<AiChatSession[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'resolved' | 'escalated' | 'ticket_created' | 'in_progress'>('all');
  const [userFilter, setUserFilter] = useState<'all' | 'guest' | 'registered'>('all');
  const [selectedSession, setSelectedSession] = useState<AiChatSession | null>(null);
  const [adminNoteInput, setAdminNoteInput] = useState<string>('');
  const [isProcessingAction, setIsProcessingAction] = useState<boolean>(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  // Subscribe to real-time ai_chats in Firestore + fallback to server API
  useEffect(() => {
    setIsLoading(true);
    let isMounted = true;

    const fetchSessionsFromServer = async () => {
      try {
        const res = await fetch('/api/ai/sessions');
        if (res.ok) {
          const data = await res.json();
          if (data.success && isMounted) {
            setSessions(data.sessions || []);
          }
        }
      } catch (err) {
        console.error("[AdminAiMonitor] Failed to fetch sessions from server:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    // 1. Subscribe to Firestore ai_chats collection
    let unsubFirestore: (() => void) | null = null;
    try {
      const colRef = collection(db, 'ai_chats');
      unsubFirestore = onSnapshot(colRef, (snap) => {
        if (!isMounted) return;
        const list: AiChatSession[] = [];
        snap.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as AiChatSession);
        });
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        setSessions(list);
        setIsLoading(false);
      }, (err) => {
        console.warn("[AdminAiMonitor] Firestore snapshot warning, falling back to server API:", err);
        fetchSessionsFromServer();
      });
    } catch (e) {
      fetchSessionsFromServer();
    }

    return () => {
      isMounted = false;
      if (unsubFirestore) unsubFirestore();
    };
  }, []);

  // Update selectedSession if the sessions list updates
  useEffect(() => {
    if (selectedSession) {
      const updated = sessions.find(s => s.id === selectedSession.id);
      if (updated) setSelectedSession(updated);
    }
  }, [sessions]);

  // Statistics
  const totalCount = sessions.length;
  const resolvedCount = sessions.filter(s => s.resolutionStatus === 'resolved').length;
  const escalatedCount = sessions.filter(s => s.resolutionStatus === 'escalated' || s.isEscalated).length;
  const guestCount = sessions.filter(s => s.isGuest).length;
  const registeredCount = sessions.filter(s => !s.isGuest).length;
  const ticketCreatedCount = sessions.filter(s => s.ticketId || s.resolutionStatus === 'ticket_created').length;
  const resolutionRate = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 100;

  // Filtered sessions
  const filteredSessions = sessions.filter(s => {
    // Status filter
    if (statusFilter === 'resolved' && s.resolutionStatus !== 'resolved') return false;
    if (statusFilter === 'escalated' && s.resolutionStatus !== 'escalated' && !s.isEscalated) return false;
    if (statusFilter === 'ticket_created' && !s.ticketId && s.resolutionStatus !== 'ticket_created') return false;
    if (statusFilter === 'in_progress' && (s.resolutionStatus === 'resolved' || s.resolutionStatus === 'escalated')) return false;

    // User filter
    if (userFilter === 'guest' && !s.isGuest) return false;
    if (userFilter === 'registered' && s.isGuest) return false;

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const email = (s.userEmail || '').toLowerCase();
      const username = (s.username || '').toLowerCase();
      const summary = (s.problemSummary || s.summary || '').toLowerCase();
      const msgs = (s.messages || []).map(m => (m.content || m.text || '').toLowerCase()).join(' ');

      const id = (s.id || s.sessionId || '').toLowerCase();
      return email.includes(q) || username.includes(q) || id.includes(q) || summary.includes(q) || msgs.includes(q);
    }

    return true;
  });

  // Handle Mark Resolved
  const handleUpdateStatus = async (sessionId: string, newStatus: 'resolved' | 'escalated' | 'in_progress') => {
    setIsProcessingAction(true);
    try {
      // Update in Firestore
      try {
        await updateDoc(doc(db, 'ai_chats', sessionId), {
          resolutionStatus: newStatus,
          isEscalated: newStatus === 'escalated',
          adminNotes: adminNoteInput || undefined,
          updatedAt: Date.now()
        });
      } catch (e) {
        // Fallback to server
        await fetch('/api/ai/update-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, resolutionStatus: newStatus, adminNotes: adminNoteInput })
        });
      }

      await logAdminAction(
        currentUser,
        'UPDATE_AI_SESSION_STATUS',
        'ai_chats',
        sessionId,
        `Marked AI session ${sessionId} as ${newStatus}`
      );

      setActionSuccessMsg(`Session status updated to "${newStatus}"`);
      setTimeout(() => setActionSuccessMsg(null), 3000);
    } catch (err: any) {
      alert("Failed to update status: " + err.message);
    } finally {
      setIsProcessingAction(false);
    }
  };

  // Convert to official ticket
  const handleCreateTicketFromSession = async (session: AiChatSession) => {
    setIsProcessingAction(true);
    try {
      const transcript = (session.messages || [])
        .map(m => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.role === 'user' ? (session.username ? '@' + session.username : 'User') : 'AI Agent'}: ${m.content || m.text || ''}`)
        .join('\n');

      const ticketData = {
        userId: session.userId || 'guest_' + session.id.slice(0, 8),
        username: session.username || session.userEmail?.split('@')[0] || 'GuestUser',
        userEmail: session.userEmail || 'unknown@autobid.com',
        isGuest: session.isGuest,
        category: 'ai_escalated_support',
        subject: `AI Escalation: ${session.problemSummary || session.summary || 'User Assistance Request'}`,
        description: `Transferred directly from Groq AI Agent Monitor.\n\nAI Diagnosis / Problem Summary:\n${session.problemSummary || session.summary || 'User requested human staff intervention.'}\n\nFull Chat Transcript:\n${transcript}`,
        status: 'open',
        priority: 'high',
        source: 'ai_monitor',
        aiSessionId: session.id,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      // Create in tickets collection
      const docRef = await addDoc(collection(db, 'tickets'), ticketData);

      // Link ticketId back to AI chat session
      try {
        await updateDoc(doc(db, 'ai_chats', session.id), {
          ticketId: docRef.id,
          resolutionStatus: 'ticket_created',
          isEscalated: true,
          updatedAt: Date.now()
        });
      } catch (e) {
        await fetch('/api/ai/update-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id, resolutionStatus: 'ticket_created', ticketId: docRef.id })
        });
      }

      await logAdminAction(
        currentUser,
        'ESCALATE_AI_TO_TICKET',
        'tickets',
        docRef.id,
        `Created high-priority ticket #${docRef.id.slice(0, 8)} from AI session ${session.id}`
      );

      setActionSuccessMsg(`✓ Support Ticket #${docRef.id.slice(0, 6)} generated successfully!`);
      setTimeout(() => setActionSuccessMsg(null), 4000);
    } catch (err: any) {
      alert("Failed to escalate ticket: " + err.message);
    } finally {
      setIsProcessingAction(false);
    }
  };

  const copyTranscript = (session: AiChatSession) => {
    const text = (session.messages || [])
      .map(m => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.role === 'user' ? 'User' : 'AutoBid AI'}: ${m.content || m.text || ''}`)
      .join('\n\n');
    navigator.clipboard.writeText(text);
    setActionSuccessMsg("Chat transcript copied to clipboard!");
    setTimeout(() => setActionSuccessMsg(null), 2500);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Module Title Banner */}
      <div className="bg-gradient-to-r from-purple-900 via-indigo-900 to-gray-950 p-6 sm:p-7 rounded-3xl text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-3xl shadow-lg">
              🤖
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-xl sm:text-2xl font-black tracking-tight">AI Monitor & Autonomous Agent Hub</h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  Groq LLM Engine Online
                </span>
              </div>
              <p className="text-xs text-purple-200 mt-1 max-w-2xl leading-relaxed">
                Real-time operational dashboard monitoring all user and guest AI support conversations. The autonomous agent automatically resolves minor platform questions, troubleshoots errors, and escalates complex issues to human staff.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto bg-white/10 backdrop-blur-md px-3.5 py-2 rounded-2xl border border-white/15 text-xs">
            <span className="text-purple-200">Active Model:</span>
            <span className="font-mono font-bold text-white bg-black/30 px-2 py-0.5 rounded-lg border border-white/10">
              openai/gpt-oss-120b
            </span>
          </div>
        </div>
      </div>

      {/* KPI Statistic Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5 sm:gap-4">
        {/* Total Sessions */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-400 text-xs font-bold uppercase tracking-wider">
            <span>Total AI Sessions</span>
            <span className="text-base">💬</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-gray-900">{totalCount}</span>
            <span className="text-[11px] text-gray-400 font-medium">recorded</span>
          </div>
          <div className="mt-2 text-[10px] text-gray-500 font-medium">Across registered & guest visitors</div>
        </div>

        {/* AI Resolved */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-emerald-100 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-emerald-600 text-xs font-bold uppercase tracking-wider">
            <span>Solved by AI</span>
            <span className="text-base">✓</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-emerald-600">{resolvedCount}</span>
            <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md">
              {resolutionRate}% rate
            </span>
          </div>
          <div className="mt-2 text-[10px] text-emerald-700 font-medium">Minor platform issues autonomously closed</div>
        </div>

        {/* Escalated / Needs Attention */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-amber-100 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-amber-600 text-xs font-bold uppercase tracking-wider">
            <span>Escalated to Staff</span>
            <span className="text-base">⚠️</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-amber-600">{escalatedCount}</span>
            <span className="text-[11px] text-amber-800 font-medium">requiring review</span>
          </div>
          <div className="mt-2 text-[10px] text-amber-700 font-medium">Beyond autonomous scope or user requested</div>
        </div>

        {/* Official Tickets Created */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-purple-100 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-purple-600 text-xs font-bold uppercase tracking-wider">
            <span>Tickets Created</span>
            <span className="text-base">🎫</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-purple-600">{ticketCreatedCount}</span>
            <span className="text-[11px] text-purple-800 font-medium">formal</span>
          </div>
          <div className="mt-2 text-[10px] text-purple-700 font-medium">Synced into Support Tickets queue</div>
        </div>

        {/* Guest vs Registered */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between text-gray-400 text-xs font-bold uppercase tracking-wider">
            <span>Audience Breakdown</span>
            <span className="text-base">👥</span>
          </div>
          <div className="mt-2 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Registered:</span>
              <strong className="text-gray-900 font-mono font-bold">{registeredCount}</strong>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Guest Visitors:</span>
              <strong className="text-purple-600 font-mono font-bold">{guestCount}</strong>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-gray-400 font-medium">Guests provided verified emails</div>
        </div>
      </div>

      {/* Control Bar: Search & Filter Tabs */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400 text-sm">
              🔍
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by email, username, session ID, or problem summary..."
              className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-xs text-gray-400 hover:text-gray-700"
              >
                ✕
              </button>
            )}
          </div>

          {/* Status Filters */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'all', label: 'All Sessions', count: totalCount },
              { id: 'resolved', label: '✓ AI Resolved', count: resolvedCount },
              { id: 'escalated', label: '⚠️ Escalated', count: escalatedCount },
              { id: 'ticket_created', label: '🎫 Ticket Created', count: ticketCreatedCount },
              { id: 'in_progress', label: '⏳ In Progress', count: sessions.filter(s => s.resolutionStatus === 'in_progress').length }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id as any)}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs transition cursor-pointer flex items-center gap-1.5 ${
                  statusFilter === tab.id
                    ? 'bg-purple-900 text-white shadow-xs'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  statusFilter === tab.id ? 'bg-purple-700 text-white' : 'bg-gray-200 text-gray-700'
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* User Audience Secondary Filter */}
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100 text-xs">
          <span className="text-gray-400 font-bold uppercase tracking-wider text-[10px]">Audience:</span>
          <button
            onClick={() => setUserFilter('all')}
            className={`px-2.5 py-1 rounded-lg font-bold text-[11px] ${userFilter === 'all' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            All ({totalCount})
          </button>
          <button
            onClick={() => setUserFilter('registered')}
            className={`px-2.5 py-1 rounded-lg font-bold text-[11px] ${userFilter === 'registered' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Registered Users ({registeredCount})
          </button>
          <button
            onClick={() => setUserFilter('guest')}
            className={`px-2.5 py-1 rounded-lg font-bold text-[11px] ${userFilter === 'guest' ? 'bg-purple-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Guest Visitors with Email ({guestCount})
          </button>
        </div>
      </div>

      {/* Success Notification */}
      {actionSuccessMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-900 text-xs font-bold flex items-center justify-between animate-fade-in">
          <span className="flex items-center gap-2">
            <span>✓</span>
            <span>{actionSuccessMsg}</span>
          </span>
          <button onClick={() => setActionSuccessMsg(null)} className="text-emerald-700 hover:text-emerald-900">✕</button>
        </div>
      )}

      {/* Session Table & Inspection Split */}
      {isLoading ? (
        <div className="bg-white p-12 rounded-3xl border border-gray-100 shadow-sm text-center">
          <div className="w-10 h-10 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sm font-bold text-gray-800">Synchronizing AI Chat Sessions...</p>
          <p className="text-xs text-gray-400 mt-1">Connecting to live agent store and Firestore collection</p>
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="bg-white p-12 rounded-3xl border border-gray-100 shadow-sm text-center">
          <span className="text-4xl mb-3 block">🤖</span>
          <h3 className="text-base font-black text-gray-900">No AI Conversations Found</h3>
          <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
            {searchQuery
              ? 'No sessions matched your search terms. Try clearing filters.'
              : 'As visitors and users chat with the AI assistant, all sessions, diagnoses, and resolutions will appear here in real time.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-gray-200/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-100 text-gray-400 uppercase tracking-wider font-extrabold text-[10px]">
                <tr>
                  <th className="py-3 px-4">User / Contact Email</th>
                  <th className="py-3 px-4">Status & Diagnosis</th>
                  <th className="py-3 px-4">Last Message & Summary</th>
                  <th className="py-3 px-4 text-center">Messages</th>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSessions.map((session) => {
                  const lastMsg = session.messages && session.messages.length > 0
                    ? session.messages[session.messages.length - 1]
                    : null;

                  return (
                    <tr
                      key={session.id}
                      onClick={() => setSelectedSession(session)}
                      className="hover:bg-purple-50/40 transition cursor-pointer"
                    >
                      {/* User Column */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs shrink-0 ${
                            session.isGuest ? 'bg-purple-100 text-purple-700' : 'bg-indigo-100 text-indigo-700'
                          }`}>
                            {session.isGuest ? 'G' : (session.username?.[0]?.toUpperCase() || 'U')}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-extrabold text-gray-900 block truncate max-w-[140px] sm:max-w-[180px]">
                                {session.userEmail || (session.username ? `@${session.username}` : 'Anonymous Visitor')}
                              </span>
                              {session.isGuest ? (
                                <span className="px-1.5 py-0.2 bg-purple-100 text-purple-800 rounded font-bold text-[9px] uppercase tracking-wider">
                                  Guest
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded font-bold text-[9px] uppercase tracking-wider">
                                  Member
                                </span>
                              )}
                            </div>
                            {session.username && (
                              <span className="text-[10px] text-gray-400 block truncate">@{session.username}</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Status & Diagnosis */}
                      <td className="py-3.5 px-4">
                        <div className="space-y-1">
                          {session.resolutionStatus === 'resolved' && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black">
                              <span>✓</span> AI Solved Minor Issue
                            </span>
                          )}
                          {session.resolutionStatus === 'escalated' && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-black">
                              <span>⚠️</span> Escalated to Staff
                            </span>
                          )}
                          {session.resolutionStatus === 'ticket_created' && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-50 text-purple-800 border border-purple-200 text-[10px] font-black">
                              <span>🎫</span> Ticket #{session.ticketId?.slice(0, 6) || 'Created'}
                            </span>
                          )}
                          {(session.status === 'appeal_submitted' || session.resolutionStatus === 'appeal_submitted' || (session as any).deletionAppeal) && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-50 text-rose-800 border border-rose-300 text-[10px] font-black animate-pulse">
                              <span>🗑️</span> Deletion Appeal
                            </span>
                          )}
                          {session.resolutionStatus === 'in_progress' && !((session as any).deletionAppeal) && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-black">
                              <span>⏳</span> Active / In Progress
                            </span>
                          )}

                          {session.problemSummary && (
                            <p className="text-[11px] text-gray-600 line-clamp-1 max-w-xs font-medium">
                              {session.problemSummary}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Last Message Snippet */}
                      <td className="py-3.5 px-4 max-w-xs sm:max-w-sm">
                        {lastMsg ? (
                          <div>
                            <span className="text-[10px] text-gray-400 font-bold uppercase">
                              {lastMsg.role === 'user' ? 'User' : 'AI'}:
                            </span>
                            <p className="text-gray-700 truncate line-clamp-1 text-xs">
                              {lastMsg.content || lastMsg.text || ''}
                            </p>
                          </div>
                        ) : (
                          <span className="text-gray-400 italic">No messages</span>
                        )}
                      </td>

                      {/* Messages Count */}
                      <td className="py-3.5 px-4 text-center">
                        <span className="font-mono font-bold bg-gray-100 text-gray-700 px-2 py-0.5 rounded-lg text-xs">
                          {session.messages?.length || 0}
                        </span>
                      </td>

                      {/* Timestamp */}
                      <td className="py-3.5 px-4 text-gray-500 whitespace-nowrap">
                        <div className="font-mono text-[11px]">
                          {new Date(session.updatedAt || session.createdAt).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric'
                          })}
                        </div>
                        <div className="text-[10px] text-gray-400">
                          {new Date(session.updatedAt || session.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSession(session);
                          }}
                          className="px-3 py-1.5 bg-gray-900 hover:bg-black text-white font-bold rounded-xl text-xs transition cursor-pointer shadow-xs"
                        >
                          Inspect Transcript
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detailed Chat Session Inspector Modal */}
      {selectedSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl overflow-hidden animate-scale-up border border-gray-100 flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-gray-950 via-gray-900 to-purple-950 text-white">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-xl">
                  🤖
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-black text-sm sm:text-base">
                      {selectedSession.userEmail || (selectedSession.username ? `@${selectedSession.username}` : 'Guest Visitor')}
                    </h3>
                    {selectedSession.isGuest ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-400/30">
                        Guest
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                        Registered User
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-300 font-mono">
                    Session ID: {selectedSession.id} • {new Date(selectedSession.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => copyTranscript(selectedSession)}
                  className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition cursor-pointer flex items-center gap-1"
                  title="Copy chat transcript"
                >
                  📋 Copy
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSession(null)}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center font-bold text-xs transition cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Diagnosis Banner */}
            <div className="p-4 bg-purple-50/70 border-b border-purple-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-purple-950">AI Diagnostic Summary:</span>
                  <span className="font-bold text-purple-800">
                    {selectedSession.problemSummary || 'Platform guidance & troubleshooting session'}
                  </span>
                </div>
                <div className="text-[11px] text-purple-700 flex items-center gap-3">
                  <span>Contact Email: <strong>{selectedSession.userEmail || 'Not specified'}</strong></span>
                  <span>Messages: <strong>{selectedSession.messages?.length || 0}</strong></span>
                </div>
                {(selectedSession as any).vehicleListing && (
                  <div className="mt-1.5 p-2 bg-emerald-100/80 border border-emerald-300 rounded-lg text-emerald-950 flex items-center gap-2 text-[11px]">
                    <span>🚗</span>
                    <span className="font-bold">AI Vehicle Listing:</span>
                    <span>{(selectedSession as any).vehicleListing.year} {(selectedSession as any).vehicleListing.make} {(selectedSession as any).vehicleListing.model}</span>
                    {(selectedSession as any).vehicleListing.stockNumber && (
                      <span className="font-mono text-[10px] bg-emerald-200 text-emerald-900 px-1.5 py-0.2 rounded font-extrabold">
                        Stock #{(selectedSession as any).vehicleListing.stockNumber}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Status selector badge */}
              <div className="flex items-center gap-1.5 self-end sm:self-auto">
                <button
                  onClick={() => handleUpdateStatus(selectedSession.id, 'resolved')}
                  disabled={isProcessingAction}
                  className={`px-2.5 py-1 rounded-lg font-bold text-xs transition cursor-pointer ${
                    selectedSession.resolutionStatus === 'resolved'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-white text-emerald-700 border border-emerald-300 hover:bg-emerald-50'
                  }`}
                >
                  ✓ Solved
                </button>
                <button
                  onClick={() => handleUpdateStatus(selectedSession.id, 'escalated')}
                  disabled={isProcessingAction}
                  className={`px-2.5 py-1 rounded-lg font-bold text-xs transition cursor-pointer ${
                    selectedSession.resolutionStatus === 'escalated'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-white text-amber-700 border border-amber-300 hover:bg-amber-50'
                  }`}
                >
                  ⚠️ Escalate
                </button>
              </div>
            </div>

            {/* Conversation Messages Thread */}
            <div className="p-5 overflow-y-auto space-y-3.5 flex-1 max-h-[45vh] bg-gray-50/50">
              {(selectedSession.messages || []).map((msg, idx) => {
                const isUser = msg.role === 'user';
                return (
                  <div
                    key={msg.id || idx}
                    className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                      <span>{isUser ? (selectedSession.username ? '@' + selectedSession.username : 'User') : '🤖 Groq AI Assistant'}</span>
                      <span>•</span>
                      <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>

                    <div
                      className={`max-w-[85%] rounded-2xl p-3.5 text-xs leading-relaxed shadow-xs whitespace-pre-wrap ${
                        isUser
                          ? 'bg-gray-900 text-white rounded-tr-xs'
                          : 'bg-white text-gray-800 border border-gray-200 rounded-tl-xs'
                      }`}
                    >
                      {msg.content || msg.text || ''}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Admin Note & 1-Click Ticket Footer */}
            <div className="p-4 bg-white border-t border-gray-100 space-y-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="flex-1">
                  <input
                    type="text"
                    value={adminNoteInput}
                    onChange={e => setAdminNoteInput(e.target.value)}
                    placeholder="Optional internal admin note on this conversation..."
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div className="flex items-center gap-2">
                  {!selectedSession.ticketId && selectedSession.resolutionStatus !== 'ticket_created' ? (
                    <button
                      type="button"
                      disabled={isProcessingAction}
                      onClick={() => handleCreateTicketFromSession(selectedSession)}
                      className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-sm transition active:scale-98 cursor-pointer flex items-center gap-1.5"
                    >
                      <span>🎫</span>
                      <span>Create Support Ticket</span>
                    </button>
                  ) : (
                    <span className="px-3 py-2 bg-purple-100 text-purple-900 font-bold text-xs rounded-xl border border-purple-200">
                      🎫 Ticket Active: #{selectedSession.ticketId?.slice(0, 8)}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => setSelectedSession(null)}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl transition cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
