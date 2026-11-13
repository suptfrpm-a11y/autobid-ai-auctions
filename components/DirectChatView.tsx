import React, { useState, useEffect, useRef } from 'react';
import { User, DirectChat, DirectChatMessage } from '../types';
import { db } from '../firebase';
import { 
  collection, 
  doc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  setDoc, 
  updateDoc, 
  getDoc, 
  increment 
} from 'firebase/firestore';

interface DirectChatViewProps {
  currentUser: User;
  onNavigate: (view: string) => void;
  targetUser?: User | null;
  onViewProfile?: (user: User) => void;
  allUsers?: User[];
  onWalletUpdated?: (newBalance: number) => void;
}

export const DirectChatView: React.FC<DirectChatViewProps> = ({
  currentUser,
  onNavigate,
  targetUser,
  onViewProfile,
  allUsers = [],
  onWalletUpdated
}) => {
  const [chats, setChats] = useState<DirectChat[]>([]);
  const [activeChat, setActiveChat] = useState<DirectChat | null>(null);
  const [messages, setMessages] = useState<DirectChatMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [isSending, setIsSending] = useState(false);

  // New Chat Modal
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');

  // Transfer Funds Modal
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [transferSuccess, setTransferSuccess] = useState('');

  // Voice Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingError, setRecordingError] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<any>(null);

  // Audio Playback State
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Scroll to bottom
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Live user balance tracking
  const [liveBalance, setLiveBalance] = useState<number>(currentUser.deposits || 0);

  useEffect(() => {
    if (!currentUser?.id) return;
    const unsub = onSnapshot(doc(db, 'users', currentUser.id), (snap) => {
      if (snap.exists()) {
        const val = snap.data().deposits || 0;
        setLiveBalance(val);
        if (onWalletUpdated) onWalletUpdated(val);
      }
    });
    return () => unsub();
  }, [currentUser?.id]);

  // 1. Subscribe to User's Direct Chats
  useEffect(() => {
    if (!currentUser?.id) return;
    setIsLoadingChats(true);
    const chatsRef = collection(db, 'direct_chats');
    const q = query(chatsRef, where('participantIds', 'array-contains', currentUser.id));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatList: DirectChat[] = [];
      snapshot.forEach((docSnap) => {
        chatList.push({ id: docSnap.id, ...docSnap.data() } as DirectChat);
      });
      // Sort in memory by updatedAt descending
      chatList.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      setChats(chatList);
      setIsLoadingChats(false);
    }, (err) => {
      console.warn("Direct chats listener error:", err);
      setIsLoadingChats(false);
    });

    return () => unsubscribe();
  }, [currentUser?.id]);

  // 2. Open or create chat if targetUser is provided
  useEffect(() => {
    if (!targetUser || !currentUser?.id || targetUser.id === currentUser.id) return;

    const chatId = [currentUser.id, targetUser.id].sort().join('_');
    const existing = chats.find(c => c.id === chatId);

    if (existing) {
      setActiveChat(existing);
    } else {
      // Create chat shell or select it
      const newChat: DirectChat = {
        id: chatId,
        participantIds: [currentUser.id, targetUser.id],
        participants: {
          [currentUser.id]: {
            username: currentUser.username,
            fullName: currentUser.fullName || currentUser.username,
            avatarUrl: currentUser.avatarUrl || ''
          },
          [targetUser.id]: {
            username: targetUser.username,
            fullName: targetUser.fullName || targetUser.username,
            avatarUrl: targetUser.avatarUrl || ''
          }
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        unreadCount: {
          [currentUser.id]: 0,
          [targetUser.id]: 0
        }
      };

      setDoc(doc(db, 'direct_chats', chatId), newChat, { merge: true })
        .then(() => setActiveChat(newChat))
        .catch((e) => {
          console.warn("Create chat error:", e);
          setActiveChat(newChat);
        });
    }
  }, [targetUser, currentUser?.id]);

  // 3. Subscribe to active chat messages
  useEffect(() => {
    if (!activeChat?.id) {
      setMessages([]);
      return;
    }

    const messagesCol = collection(db, 'direct_chats', activeChat.id, 'messages');
    const q = query(messagesCol, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgList: DirectChatMessage[] = [];
      snapshot.forEach((docSnap) => {
        msgList.push({ id: docSnap.id, ...docSnap.data() } as DirectChatMessage);
      });
      setMessages(msgList);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 80);

      // Reset unread counter for current user
      if (activeChat.unreadCount && activeChat.unreadCount[currentUser.id] > 0) {
        updateDoc(doc(db, 'direct_chats', activeChat.id), {
          [`unreadCount.${currentUser.id}`]: 0
        }).catch(() => {});
      }
    }, (err) => {
      console.warn("Messages listener error:", err);
    });

    return () => unsubscribe();
  }, [activeChat?.id, currentUser?.id]);

  // Helper: Get Other Participant Info
  const getOtherParticipant = (chat: DirectChat) => {
    const otherId = chat.participantIds.find(id => id !== currentUser.id);
    if (!otherId) return { id: '', username: 'User', fullName: 'User', avatarUrl: '' };

    if (chat.participants && chat.participants[otherId]) {
      return { id: otherId, ...chat.participants[otherId] };
    }

    const userObj = allUsers.find(u => u.id === otherId);
    if (userObj) {
      return {
        id: otherId,
        username: userObj.username,
        fullName: userObj.fullName || userObj.username,
        avatarUrl: userObj.avatarUrl || ''
      };
    }

    return { id: otherId, username: 'AutoBid Member', fullName: 'AutoBid Member', avatarUrl: '' };
  };

  // Send Text Message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!messageText.trim() || !activeChat || !currentUser?.id || isSending) return;

    const other = getOtherParticipant(activeChat);
    const textToSend = messageText.trim();
    setMessageText('');
    setIsSending(true);

    try {
      const now = Date.now();
      const newMsg: Omit<DirectChatMessage, 'id'> = {
        chatId: activeChat.id,
        senderId: currentUser.id,
        senderUsername: currentUser.username,
        recipientId: other.id,
        type: 'text',
        text: textToSend,
        timestamp: now,
        read: false
      };

      await addDoc(collection(db, 'direct_chats', activeChat.id, 'messages'), newMsg);

      await setDoc(doc(db, 'direct_chats', activeChat.id), {
        participantIds: activeChat.participantIds,
        participants: {
          [currentUser.id]: {
            username: currentUser.username,
            fullName: currentUser.fullName || currentUser.username,
            avatarUrl: currentUser.avatarUrl || ''
          },
          [other.id]: {
            username: other.username,
            fullName: other.fullName || other.username,
            avatarUrl: other.avatarUrl || ''
          }
        },
        lastMessage: textToSend,
        lastMessageType: 'text',
        lastMessageTimestamp: now,
        lastSenderId: currentUser.id,
        updatedAt: now,
        unreadCount: {
          [other.id]: increment(1)
        }
      }, { merge: true });

    } catch (err: any) {
      console.error("Error sending message:", err);
      setMessageText(textToSend);
    } finally {
      setIsSending(false);
    }
  };

  // --------------------------------------------------------------------------
  // VOICE RECORDING LOGIC
  // --------------------------------------------------------------------------
  const startRecording = async () => {
    setRecordingError('');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setRecordingError("Voice recording is not supported in this browser.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      // Determine supported mime type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
        ? 'audio/webm' 
        : MediaRecorder.isTypeSupported('audio/ogg')
        ? 'audio/ogg'
        : 'audio/mp4';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(200);
      setIsRecording(true);
      setRecordingSeconds(0);

      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds(prev => prev + 1);
      }, 1000);

    } catch (err: any) {
      console.error("Microphone access error:", err);
      setRecordingError("Microphone access denied or not available. Please allow mic permission.");
      setIsRecording(false);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
    clearInterval(timerIntervalRef.current);
    setIsRecording(false);
    setRecordingSeconds(0);
    audioChunksRef.current = [];
  };

  const stopAndSendRecording = async () => {
    if (!mediaRecorderRef.current || !activeChat || !currentUser?.id) return;

    clearInterval(timerIntervalRef.current);
    const duration = recordingSeconds;
    setIsRecording(false);
    setIsSending(true);

    mediaRecorderRef.current.onstop = async () => {
      try {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorderRef.current?.mimeType || 'audio/webm' });
        mediaRecorderRef.current?.stream.getTracks().forEach(track => track.stop());

        // Convert Blob to base64 Data URL
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = reader.result as string;
          const other = getOtherParticipant(activeChat);
          const now = Date.now();

          const voiceMsg: Omit<DirectChatMessage, 'id'> = {
            chatId: activeChat.id,
            senderId: currentUser.id,
            senderUsername: currentUser.username,
            recipientId: other.id,
            type: 'voice',
            audioData: base64Audio,
            audioDuration: Math.max(1, duration),
            timestamp: now,
            read: false
          };

          await addDoc(collection(db, 'direct_chats', activeChat.id, 'messages'), voiceMsg);

          await setDoc(doc(db, 'direct_chats', activeChat.id), {
            participantIds: activeChat.participantIds,
            lastMessage: `🎤 Voice Message (${formatTime(Math.max(1, duration))})`,
            lastMessageType: 'voice',
            lastMessageTimestamp: now,
            lastSenderId: currentUser.id,
            updatedAt: now,
            unreadCount: {
              [other.id]: increment(1)
            }
          }, { merge: true });

          setIsSending(false);
          audioChunksRef.current = [];
        };
      } catch (err: any) {
        console.error("Error saving voice message:", err);
        setRecordingError("Failed to encode or send voice note.");
        setIsSending(false);
      }
    };

    if (mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  // Play / Pause voice message
  const togglePlayAudio = (messageId: string, audioDataUrl?: string) => {
    if (!audioDataUrl) return;

    if (playingMessageId === messageId) {
      audioPlayerRef.current?.pause();
      setPlayingMessageId(null);
      return;
    }

    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
    }

    const audio = new Audio(audioDataUrl);
    audioPlayerRef.current = audio;
    setPlayingMessageId(messageId);

    audio.onended = () => {
      setPlayingMessageId(null);
    };

    audio.onerror = () => {
      console.warn("Audio playback error");
      setPlayingMessageId(null);
    };

    audio.play().catch(e => {
      console.warn("Play failed:", e);
      setPlayingMessageId(null);
    });
  };

  // --------------------------------------------------------------------------
  // TRANSFER FUNDS (INR) LOGIC
  // --------------------------------------------------------------------------
  const handleTransferFunds = async () => {
    setTransferError('');
    setTransferSuccess('');

    const val = parseFloat(transferAmount);
    if (isNaN(val) || val <= 0) {
      setTransferError('Please enter a valid transfer amount (min ₹1).');
      return;
    }

    if (val > liveBalance) {
      setTransferError(`Insufficient wallet balance. You have ₹${liveBalance.toLocaleString()} available.`);
      return;
    }

    if (!activeChat || !currentUser?.id) return;
    const other = getOtherParticipant(activeChat);
    if (!other.id) {
      setTransferError('Recipient user could not be identified.');
      return;
    }

    setIsTransferring(true);
    try {
      const now = Date.now();

      // 1. Debit sender's deposits
      const senderRef = doc(db, 'users', currentUser.id);
      await updateDoc(senderRef, {
        deposits: increment(-val)
      });

      // 2. Credit recipient's deposits
      const recipientRef = doc(db, 'users', other.id);
      await updateDoc(recipientRef, {
        deposits: increment(val)
      });

      // 3. Record sender transaction
      await addDoc(collection(db, 'transactions'), {
        userId: currentUser.id,
        username: currentUser.username || 'User',
        type: 'transfer_out',
        amount: val,
        recipientId: other.id,
        recipientUsername: other.username || 'User',
        description: `Transferred ₹${val.toLocaleString()} to @${other.username || 'User'}${transferNote ? ` • Note: ${transferNote}` : ''}`,
        timestamp: now,
        status: 'success'
      });

      // 4. Record recipient transaction
      await addDoc(collection(db, 'transactions'), {
        userId: other.id,
        username: other.username || 'User',
        type: 'transfer_in',
        amount: val,
        senderId: currentUser.id,
        senderUsername: currentUser.username || 'User',
        description: `Received ₹${val.toLocaleString()} from @${currentUser.username || 'User'}${transferNote ? ` • Note: ${transferNote}` : ''}`,
        timestamp: now,
        status: 'success'
      });

      // 5. Post Fund Transfer message to chat thread
      const transferMsg: Omit<DirectChatMessage, 'id'> = {
        chatId: activeChat.id,
        senderId: currentUser.id,
        senderUsername: currentUser.username || 'User',
        recipientId: other.id,
        recipientUsername: other.username || 'User',
        type: 'fund_transfer',
        transferAmount: val,
        transferNote: transferNote.trim() || '',
        transferStatus: 'completed',
        timestamp: now,
        read: false
      };

      // Ensure no undefined fields are passed to Firestore addDoc
      const cleanTransferMsg = Object.fromEntries(
        Object.entries(transferMsg).filter(([_, v]) => v !== undefined)
      );

      await addDoc(collection(db, 'direct_chats', activeChat.id, 'messages'), cleanTransferMsg);

      // 6. Update chat document metadata
      await setDoc(doc(db, 'direct_chats', activeChat.id), {
        participantIds: activeChat.participantIds,
        lastMessage: `💸 Transferred ₹${val.toLocaleString()}`,
        lastMessageType: 'fund_transfer',
        lastMessageTimestamp: now,
        lastSenderId: currentUser.id,
        updatedAt: now,
        unreadCount: {
          [other.id]: increment(1)
        }
      }, { merge: true });

      // 7. Update local balance state immediately
      const newBal = Math.max(0, liveBalance - val);
      setLiveBalance(newBal);
      if (onWalletUpdated) onWalletUpdated(newBal);

      setTransferSuccess(`₹${val.toLocaleString()} transferred to @${other.username} successfully!`);
      setTimeout(() => {
        setShowTransferModal(false);
        setTransferAmount('');
        setTransferNote('');
        setTransferSuccess('');
      }, 1500);

    } catch (err: any) {
      console.error("Transfer funds error:", err);
      setTransferError(err.message || 'Transfer failed. Please check your connection and retry.');
    } finally {
      setIsTransferring(false);
    }
  };

  const startChatWithUser = (user: User) => {
    setShowNewChatModal(false);
    const chatId = [currentUser.id, user.id].sort().join('_');
    const existing = chats.find(c => c.id === chatId);

    if (existing) {
      setActiveChat(existing);
    } else {
      const newChat: DirectChat = {
        id: chatId,
        participantIds: [currentUser.id, user.id],
        participants: {
          [currentUser.id]: {
            username: currentUser.username,
            fullName: currentUser.fullName || currentUser.username,
            avatarUrl: currentUser.avatarUrl || ''
          },
          [user.id]: {
            username: user.username,
            fullName: user.fullName || user.username,
            avatarUrl: user.avatarUrl || ''
          }
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        unreadCount: {
          [currentUser.id]: 0,
          [user.id]: 0
        }
      };

      setDoc(doc(db, 'direct_chats', chatId), newChat, { merge: true })
        .then(() => setActiveChat(newChat))
        .catch(() => setActiveChat(newChat));
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) return '';
    const now = Date.now();
    const diff = now - timestamp;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const filteredChats = chats.filter(c => {
    const other = getOtherParticipant(c);
    const q = searchFilter.toLowerCase();
    return (
      other.username.toLowerCase().includes(q) ||
      (other.fullName && other.fullName.toLowerCase().includes(q)) ||
      (c.lastMessage && c.lastMessage.toLowerCase().includes(q))
    );
  });

  const availableUsersToChat = allUsers.filter(u => 
    u.id !== currentUser.id && 
    (u.username.toLowerCase().includes(userSearchQuery.toLowerCase()) || 
     (u.fullName && u.fullName.toLowerCase().includes(userSearchQuery.toLowerCase())))
  );

  return (
    <div className="max-w-6xl mx-auto px-2 sm:px-4 py-4 pb-28">
      {/* Container with Glass Panel */}
      <div className="glass-panel rounded-3xl border border-gray-200/80 shadow-xl overflow-hidden bg-white/95 backdrop-blur-xl flex flex-col md:flex-row h-[78vh] min-h-[580px]">
        
        {/* ========================================================= */}
        {/* LEFT COLUMN: CONVERSATION LIST (INBOX)                   */}
        {/* ========================================================= */}
        <div className={`w-full md:w-80 lg:w-96 border-r border-gray-200/80 flex flex-col bg-gray-50/60 ${activeChat ? 'hidden md:flex' : 'flex'}`}>
          {/* Header */}
          <div className="p-4 border-b border-gray-200/80 bg-white/80">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm shadow-xs">
                  💬
                </div>
                <div>
                  <h2 className="text-base font-black text-gray-900 tracking-tight">Messages</h2>
                  <p className="text-[10px] text-gray-400 font-medium">Free Real-time Direct Chat</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowNewChatModal(true)}
                className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-sm shadow-blue-500/20 flex items-center gap-1.5 cursor-pointer"
              >
                <span>➕</span>
                <span>New Chat</span>
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                value={searchFilter}
                onChange={e => setSearchFilter(e.target.value)}
                placeholder="Search conversations..."
                className="w-full bg-gray-100/80 border border-gray-200/80 rounded-xl pl-8 pr-3 py-1.5 text-xs text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
              />
              <svg className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          {/* Chat List Scroll Area */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100 scrollbar-thin">
            {isLoadingChats ? (
              <div className="p-8 text-center text-gray-400 space-y-2">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs font-medium">Loading conversations...</p>
              </div>
            ) : filteredChats.length === 0 ? (
              <div className="p-8 text-center text-gray-400 space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-gray-100 text-gray-400 flex items-center justify-center text-2xl mx-auto">
                  ✉️
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-700">No chats yet</p>
                  <p className="text-[11px] text-gray-400 mt-1 max-w-xs mx-auto">
                    Connect with any seller or bidder on AutoBid to negotiate, ask vehicle questions, or transfer funds.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowNewChatModal(true)}
                  className="px-4 py-2 rounded-xl bg-gray-900 text-white text-xs font-bold shadow-md hover:bg-black transition cursor-pointer"
                >
                  Start a Chat
                </button>
              </div>
            ) : (
              filteredChats.map((chat) => {
                const other = getOtherParticipant(chat);
                const isActive = activeChat?.id === chat.id;
                const unread = chat.unreadCount ? chat.unreadCount[currentUser.id] || 0 : 0;

                return (
                  <div
                    key={chat.id}
                    onClick={() => setActiveChat(chat)}
                    className={`p-3.5 flex items-center gap-3 cursor-pointer transition-colors relative ${
                      isActive ? 'bg-blue-50/70 border-l-4 border-blue-600' : 'hover:bg-gray-100/60'
                    }`}
                  >
                    {/* Avatar */}
                    <div className="relative shrink-0">
                      {other.avatarUrl ? (
                        <img
                          src={other.avatarUrl}
                          alt={other.username}
                          className="w-11 h-11 rounded-2xl object-cover border border-gray-200"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-base flex items-center justify-center shadow-xs">
                          {other.username.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="w-3 h-3 rounded-full bg-emerald-500 border-2 border-white absolute -bottom-0.5 -right-0.5" />
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-bold text-xs text-gray-900 truncate">
                          @{other.username}
                        </span>
                        <span className="text-[10px] text-gray-400 whitespace-nowrap">
                          {formatTimestamp(chat.lastMessageTimestamp || chat.updatedAt)}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-500 truncate mt-0.5">
                        {chat.lastMessage || 'Tap to start conversation'}
                      </p>
                    </div>

                    {/* Unread badge */}
                    {unread > 0 && (
                      <span className="w-5 h-5 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center shrink-0 shadow-sm animate-pulse">
                        {unread}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ========================================================= */}
        {/* RIGHT COLUMN: ACTIVE CONVERSATION WINDOW                 */}
        {/* ========================================================= */}
        <div className={`flex-1 flex flex-col bg-white ${!activeChat ? 'hidden md:flex' : 'flex'}`}>
          {activeChat ? (
            <>
              {/* Active Chat Header */}
              {(() => {
                const other = getOtherParticipant(activeChat);
                return (
                  <div className="px-4 py-3 border-b border-gray-200/80 bg-white/95 flex items-center justify-between gap-2 shadow-xs">
                    <div className="flex items-center gap-3">
                      {/* Back button for mobile view */}
                      <button
                        type="button"
                        onClick={() => setActiveChat(null)}
                        className="md:hidden p-1.5 rounded-xl hover:bg-gray-100 text-gray-600 transition"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>

                      {/* User Info */}
                      <div 
                        className="flex items-center gap-2.5 cursor-pointer hover:opacity-85 transition"
                        onClick={() => {
                          const targetUserObj = allUsers.find(u => u.id === other.id);
                          if (targetUserObj && onViewProfile) {
                            onViewProfile(targetUserObj);
                          }
                        }}
                      >
                        <div className="relative">
                          {other.avatarUrl ? (
                            <img
                              src={other.avatarUrl}
                              alt={other.username}
                              className="w-10 h-10 rounded-xl object-cover border border-gray-200"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-sm flex items-center justify-center shadow-xs">
                              {other.username.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white absolute -bottom-0.5 -right-0.5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-sm text-gray-900">@{other.username}</span>
                            <span className="text-[10px] bg-blue-50 text-blue-600 font-semibold px-1.5 py-0.5 rounded-md">
                              Verified
                            </span>
                          </div>
                          <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Active Member
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Actions on Header: Transfer Funds & Wallet Info */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowTransferModal(true)}
                        className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold shadow-md shadow-emerald-600/20 transition flex items-center gap-1.5 cursor-pointer"
                        title="Transfer funds directly to user's wallet"
                      >
                        <span>💸</span>
                        <span>Transfer Funds</span>
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Messages Feed */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-gray-50/50 via-white to-gray-50/30 scrollbar-thin">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-gray-400 space-y-2">
                    <span className="text-3xl">👋</span>
                    <p className="text-xs font-bold text-gray-700">Start the conversation</p>
                    <p className="text-[11px] text-gray-400 max-w-xs">
                      Send a friendly message, record a voice note, or transfer funds directly.
                    </p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isMe = msg.senderId === currentUser.id;

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} transition-all`}
                      >
                        {/* 1. FUND TRANSFER CARD */}
                        {msg.type === 'fund_transfer' ? (
                          <div className={`p-4 rounded-2xl max-w-sm sm:max-w-md shadow-md border ${
                            isMe 
                              ? 'bg-gradient-to-br from-emerald-700 to-teal-800 text-white border-emerald-600' 
                              : 'bg-emerald-50 border-emerald-200 text-gray-900'
                          }`}>
                            <div className="flex items-center gap-2.5 mb-2">
                              <span className="w-8 h-8 rounded-xl bg-white/20 text-white flex items-center justify-center text-base">
                                💸
                              </span>
                              <div>
                                <span className={`text-[10px] font-black uppercase tracking-wider block ${isMe ? 'text-emerald-200' : 'text-emerald-800'}`}>
                                  INR Wallet Transfer
                                </span>
                                <span className="text-xs font-bold">
                                  {isMe ? `Sent to @${msg.recipientUsername}` : `Received from @${msg.senderUsername}`}
                                </span>
                              </div>
                            </div>
                            <div className="my-2.5 p-3 rounded-xl bg-black/10 backdrop-blur-xs flex items-baseline justify-between">
                              <span className="text-xs font-semibold opacity-80">Amount:</span>
                              <span className="text-2xl font-black tracking-tight">
                                ₹{(msg.transferAmount || 0).toLocaleString()}
                              </span>
                            </div>
                            {msg.transferNote && (
                              <p className={`text-xs italic mb-2 ${isMe ? 'text-emerald-100' : 'text-gray-700'}`}>
                                "{msg.transferNote}"
                              </p>
                            )}
                            <div className="flex items-center justify-between text-[10px] opacity-75 pt-1 border-t border-white/10">
                              <span>✓ Credited to INR Wallet</span>
                              <span>{formatTimestamp(msg.timestamp)}</span>
                            </div>
                          </div>
                        ) : msg.type === 'voice' ? (
                          /* 2. VOICE MESSAGE BUBBLE */
                          <div className={`p-3 rounded-2xl max-w-xs sm:max-w-sm shadow-sm flex items-center gap-3 ${
                            isMe 
                              ? 'bg-blue-600 text-white rounded-br-xs' 
                              : 'bg-white border border-gray-200 text-gray-900 rounded-bl-xs'
                          }`}>
                            <button
                              type="button"
                              onClick={() => togglePlayAudio(msg.id, msg.audioData)}
                              className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 shadow-sm transition ${
                                isMe 
                                  ? 'bg-white text-blue-600 hover:bg-blue-50' 
                                  : 'bg-blue-600 text-white hover:bg-blue-700'
                              }`}
                            >
                              {playingMessageId === msg.id ? (
                                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                                </svg>
                              ) : (
                                <svg className="w-4 h-4 fill-current ml-0.5" viewBox="0 0 24 24">
                                  <path d="M8 5v14l11-7z" />
                                </svg>
                              )}
                            </button>

                            {/* Audio Visual Waveform */}
                            <div className="flex-1">
                              <div className="flex items-center gap-0.5 h-6">
                                {[12, 22, 16, 28, 14, 24, 18, 30, 20, 16, 26, 14, 22].map((h, i) => (
                                  <span
                                    key={i}
                                    style={{ height: `${h}px` }}
                                    className={`w-1 rounded-full transition-all ${
                                      playingMessageId === msg.id
                                        ? (isMe ? 'bg-white animate-pulse' : 'bg-blue-600 animate-pulse')
                                        : (isMe ? 'bg-white/50' : 'bg-gray-300')
                                    }`}
                                  />
                                ))}
                              </div>
                              <div className="flex items-center justify-between text-[10px] mt-1 opacity-80">
                                <span>Voice Note ({formatTime(msg.audioDuration || 0)})</span>
                                <span>{formatTimestamp(msg.timestamp)}</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          /* 3. REGULAR TEXT MESSAGE */
                          <div className={`p-3 px-4 rounded-2xl max-w-sm sm:max-w-md shadow-xs text-xs sm:text-sm leading-relaxed ${
                            isMe 
                              ? 'bg-blue-600 text-white rounded-br-xs' 
                              : 'bg-white border border-gray-200 text-gray-900 rounded-bl-xs'
                          }`}>
                            <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                            <span className={`text-[9px] block text-right mt-1 font-mono ${isMe ? 'text-blue-200' : 'text-gray-400'}`}>
                              {formatTimestamp(msg.timestamp)}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Recording Banner if active */}
              {isRecording && (
                <div className="px-4 py-2.5 bg-red-50 border-t border-red-200 flex items-center justify-between animate-pulse">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-red-600 animate-ping" />
                    <span className="text-xs font-bold text-red-700">Recording Voice Message...</span>
                    <span className="text-xs font-mono font-bold text-red-900 bg-red-100 px-2 py-0.5 rounded-md">
                      {formatTime(recordingSeconds)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={cancelRecording}
                      className="px-2.5 py-1 text-xs text-red-600 hover:text-red-800 font-semibold cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={stopAndSendRecording}
                      className="px-3.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-xs cursor-pointer flex items-center gap-1"
                    >
                      <span>Send Voice</span>
                      <span>✈️</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Feedback error banner */}
              {recordingError && (
                <div className="px-4 py-1.5 bg-amber-50 text-amber-800 text-xs border-t border-amber-200 flex items-center justify-between">
                  <span>⚠️ {recordingError}</span>
                  <button onClick={() => setRecordingError('')} className="font-bold">✕</button>
                </div>
              )}

              {/* Input Area */}
              <form onSubmit={handleSendMessage} className="p-3 border-t border-gray-200/80 bg-white flex items-center gap-2">
                {/* Transfer Funds Shortcut */}
                <button
                  type="button"
                  onClick={() => setShowTransferModal(true)}
                  title="Transfer Funds to User"
                  className="p-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition border border-emerald-200/80 cursor-pointer shrink-0"
                >
                  <span className="text-sm font-black">₹</span>
                </button>

                {/* Voice Note Button */}
                <button
                  type="button"
                  onClick={isRecording ? stopAndSendRecording : startRecording}
                  title={isRecording ? "Stop & Send Recording" : "Record Voice Message"}
                  className={`p-2.5 rounded-xl transition cursor-pointer shrink-0 ${
                    isRecording 
                      ? 'bg-red-600 text-white animate-pulse' 
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </button>

                {/* Text Message Input */}
                <input
                  type="text"
                  value={messageText}
                  onChange={e => setMessageText(e.target.value)}
                  placeholder="Type a message..."
                  disabled={isRecording}
                  className="flex-1 bg-gray-100/80 border border-gray-200 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
                />

                {/* Send Button */}
                <button
                  type="submit"
                  disabled={!messageText.trim() || isSending}
                  className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-bold transition shadow-md shadow-blue-500/20 flex items-center justify-center shrink-0 cursor-pointer"
                >
                  {isSending ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  )}
                </button>
              </form>
            </>
          ) : (
            /* No Active Chat Selected Placeholder */
            <div className="h-full flex flex-col items-center justify-center p-8 text-center text-gray-400 space-y-3">
              <div className="w-16 h-16 rounded-3xl bg-blue-50 text-blue-600 flex items-center justify-center text-3xl shadow-sm">
                💬
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-800">Select a Conversation</h3>
                <p className="text-xs text-gray-500 mt-1 max-w-sm">
                  Choose someone from your chat history on the left, or tap "New Chat" to connect with any buyer, seller, or platform member.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewChatModal(true)}
                className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-500/25 transition cursor-pointer"
              >
                Start New Chat
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ========================================================= */}
      {/* MODAL 1: TRANSFER FUNDS TO USER MODAL                     */}
      {/* ========================================================= */}
      {showTransferModal && activeChat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !isTransferring && setShowTransferModal(false)} />
          <div className="relative bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl animate-fade-in-up border border-gray-100">
            {(() => {
              const other = getOtherParticipant(activeChat);
              return (
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-black text-sm">
                        ₹
                      </span>
                      <div>
                        <h3 className="text-base font-bold text-gray-900">Transfer Funds</h3>
                        <p className="text-[10px] text-gray-500">Direct wallet-to-wallet transfer</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isTransferring}
                      onClick={() => setShowTransferModal(false)}
                      className="text-gray-400 hover:text-gray-600 text-lg font-bold p-1"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Recipient info & Balance card */}
                  <div className="mt-4 p-3.5 rounded-2xl bg-gray-50 border border-gray-200/80 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Recipient</span>
                      <span className="text-sm font-black text-gray-900">@{other.username}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Your Wallet Balance</span>
                      <span className="text-sm font-black text-emerald-600">₹{liveBalance.toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Preset Amount Chips */}
                  <div className="mt-4">
                    <label className="block text-xs font-bold text-gray-700 mb-1.5">Quick Select Amount</label>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                      {['100', '500', '1000', '2500', '5000', '10000'].map(preset => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setTransferAmount(preset)}
                          className={`py-1.5 rounded-xl text-xs font-bold border transition ${
                            transferAmount === preset 
                              ? 'bg-emerald-600 text-white border-emerald-600' 
                              : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
                          }`}
                        >
                          ₹{parseInt(preset).toLocaleString()}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom Amount */}
                  <div className="mt-3.5">
                    <label className="block text-xs font-bold text-gray-700 mb-1">Enter Amount (₹ INR) *</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-2.5 text-gray-400 font-bold text-base">₹</span>
                      <input
                        type="number"
                        min="1"
                        step="10"
                        value={transferAmount}
                        onChange={e => setTransferAmount(e.target.value)}
                        placeholder="e.g. 1500"
                        className="w-full pl-8 pr-4 py-2.5 rounded-xl border border-gray-300 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  {/* Purpose / Note */}
                  <div className="mt-3">
                    <label className="block text-xs font-bold text-gray-700 mb-1">Note or Reason (Optional)</label>
                    <input
                      type="text"
                      value={transferNote}
                      onChange={e => setTransferNote(e.target.value)}
                      placeholder="e.g. Vehicle inspection advance, deposit"
                      className="w-full px-3.5 py-2 rounded-xl border border-gray-300 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  {/* Error & Success Feedback */}
                  {transferError && (
                    <div className="mt-3 p-2.5 rounded-xl bg-red-50 text-red-700 text-xs font-medium border border-red-200">
                      ⚠️ {transferError}
                    </div>
                  )}

                  {transferSuccess && (
                    <div className="mt-3 p-2.5 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-bold border border-emerald-200">
                      ✅ {transferSuccess}
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="mt-5 flex items-center justify-end gap-2.5">
                    <button
                      type="button"
                      disabled={isTransferring}
                      onClick={() => setShowTransferModal(false)}
                      className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isTransferring || !transferAmount}
                      onClick={handleTransferFunds}
                      className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-emerald-600/20 transition flex items-center gap-2 cursor-pointer"
                    >
                      {isTransferring ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Processing...</span>
                        </>
                      ) : (
                        <>
                          <span>Transfer ₹{transferAmount ? parseFloat(transferAmount).toLocaleString() : '0'}</span>
                          <span>➔</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 2: NEW CHAT / FIND USER MODAL                       */}
      {/* ========================================================= */}
      {showNewChatModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowNewChatModal(false)} />
          <div className="relative bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl animate-fade-in-up border border-gray-100 flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900">Start a New Chat</h3>
              <button
                type="button"
                onClick={() => setShowNewChatModal(false)}
                className="text-gray-400 hover:text-gray-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Search user */}
            <div className="my-3">
              <input
                type="text"
                value={userSearchQuery}
                onChange={e => setUserSearchQuery(e.target.value)}
                placeholder="Search username or name..."
                className="w-full bg-gray-100 border border-gray-200 rounded-xl px-3.5 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Users list */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100 scrollbar-thin">
              {availableUsersToChat.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-xs">
                  No users found matching "{userSearchQuery}".
                </div>
              ) : (
                availableUsersToChat.map((user) => (
                  <div
                    key={user.id}
                    onClick={() => startChatWithUser(user)}
                    className="p-3 flex items-center justify-between hover:bg-gray-50 rounded-xl cursor-pointer transition"
                  >
                    <div className="flex items-center gap-2.5">
                      {user.avatarUrl ? (
                        <img
                          src={user.avatarUrl}
                          alt={user.username}
                          className="w-9 h-9 rounded-xl object-cover border border-gray-200"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-xl bg-blue-600 text-white font-bold text-xs flex items-center justify-center">
                          {user.username.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <span className="font-bold text-xs text-gray-900 block">@{user.username}</span>
                        <span className="text-[10px] text-gray-400">{user.fullName || 'AutoBid Member'}</span>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-lg">
                      Chat ➔
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
