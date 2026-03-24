/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  User as FirebaseUser,
  updateProfile
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  onSnapshot, 
  serverTimestamp, 
  where, 
  doc, 
  setDoc, 
  getDocs,
  updateDoc,
  Timestamp,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { 
  MessageSquare, 
  Users, 
  Globe, 
  Send, 
  LogOut, 
  UserPlus, 
  Check, 
  X, 
  Search,
  User as UserIcon,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
}

interface Message {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  timestamp: any;
  receiverId?: string;
  chatId?: string;
}

interface Connection {
  id: string;
  senderId: string;
  receiverId: string;
  status: 'pending' | 'accepted' | 'rejected';
  timestamp: any;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

// --- Utils ---

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const getChatId = (uid1: string, uid2: string) => {
  return [uid1, uid2].sort().join('_');
};

// --- Components ---

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (event.error?.message?.includes('operationType')) {
        setHasError(true);
        try {
          const info = JSON.parse(event.error.message);
          setErrorMsg(`Firestore Error: ${info.error} during ${info.operationType} on ${info.path}`);
        } catch {
          setErrorMsg(event.error.message);
        }
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
        <div className="bg-white p-6 rounded-xl shadow-lg max-w-md w-full border border-red-200">
          <h2 className="text-xl font-bold text-red-600 mb-2">Something went wrong</h2>
          <p className="text-gray-600 mb-4">{errorMsg}</p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 transition"
          >
            Reload Application
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'global' | 'private' | 'connections'>('global');
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      setIsAuthReady(true);
    });
    return unsubscribe;
  }, []);

  // Test connection to Firestore
  useEffect(() => {
    if (isAuthReady) {
      const testConnection = async () => {
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (error) {
          if (error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Please check your Firebase configuration.");
          }
        }
      };
      testConnection();
    }
  }, [isAuthReady]);

  // Fetch all users for discovery
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const uList = snapshot.docs
        .map(doc => doc.data() as UserProfile)
        .filter(u => u.uid !== user.uid);
      setUsers(uList);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'users'));
    return unsubscribe;
  }, [user]);

  // Fetch connections
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'connections'),
      where('senderId', '==', user.uid)
    );
    const q2 = query(
      collection(db, 'connections'),
      where('receiverId', '==', user.uid)
    );

    const unsub1 = onSnapshot(q, (snapshot) => {
      const cList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Connection));
      setConnections(prev => {
        const other = prev.filter(c => c.receiverId !== user.uid);
        return [...other, ...cList];
      });
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'connections'));

    const unsub2 = onSnapshot(q2, (snapshot) => {
      const cList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Connection));
      setConnections(prev => {
        const other = prev.filter(c => c.senderId !== user.uid);
        return [...other, ...cList];
      });
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'connections'));

    return () => { unsub1(); unsub2(); };
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  const acceptedConnections = connections.filter(c => c.status === 'accepted');
  const friends = users.filter(u => 
    acceptedConnections.some(c => c.senderId === u.uid || c.receiverId === u.uid)
  );

  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-slate-50 overflow-hidden font-sans relative">
        {/* Mobile Overlay */}
        <AnimatePresence>
          {isSidebarOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden"
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <div className={`
          fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-slate-200 flex flex-col transition-transform duration-300 ease-in-out
          md:relative md:translate-x-0 md:w-64
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}>
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold shadow-lg shadow-indigo-100">
                {user.displayName?.[0] || user.email?.[0]}
              </div>
              <div className="overflow-hidden">
                <p className="font-semibold truncate text-slate-800">{user.displayName || 'User'}</p>
                <p className="text-xs text-slate-500 truncate">{user.email}</p>
              </div>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-2 text-slate-400 hover:text-slate-600">
              <X size={20} />
            </button>
          </div>

          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            <SidebarItem 
              icon={<Globe size={20} />} 
              label="Global Chat" 
              active={view === 'global'} 
              onClick={() => { setView('global'); setSelectedUser(null); setIsSidebarOpen(false); }} 
            />
            <SidebarItem 
              icon={<Users size={20} />} 
              label="Connections" 
              active={view === 'connections'} 
              onClick={() => { setView('connections'); setSelectedUser(null); setIsSidebarOpen(false); }} 
            />
            
            <div className="mt-8 mb-2 px-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Private Chats</p>
            </div>
            
            {friends.length === 0 ? (
              <p className="px-3 py-4 text-xs text-slate-400 italic">No friends yet. Head to Connections to find people!</p>
            ) : (
              friends.map(friend => (
                <SidebarItem 
                  key={friend.uid}
                  icon={<div className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-[10px] font-bold">{friend.displayName[0]}</div>}
                  label={friend.displayName}
                  active={view === 'private' && selectedUser?.uid === friend.uid}
                  onClick={() => { setView('private'); setSelectedUser(friend); setIsSidebarOpen(false); }}
                />
              ))
            )}
          </nav>

          <div className="p-4 border-t border-slate-100">
            <button 
              onClick={() => signOut(auth)}
              className="flex items-center gap-3 p-3 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition w-full font-medium"
            >
              <LogOut size={20} />
              <span>Logout</span>
            </button>
          </div>
        </div>

        {/* Main Content */}
        <main className="flex-1 flex flex-col relative min-w-0">
          <AnimatePresence mode="wait">
            {view === 'global' && (
              <ChatArea 
                key="global" 
                title="Global Chat" 
                type="global" 
                user={user} 
                onMenuClick={() => setIsSidebarOpen(true)}
              />
            )}
            {view === 'private' && selectedUser && (
              <ChatArea 
                key={`private-${selectedUser.uid}`} 
                title={selectedUser.displayName} 
                type="private" 
                user={user} 
                targetUser={selectedUser} 
                onMenuClick={() => setIsSidebarOpen(true)}
              />
            )}
            {view === 'connections' && (
              <ConnectionsArea 
                key="connections" 
                user={user} 
                users={users} 
                connections={connections} 
                onMenuClick={() => setIsSidebarOpen(true)}
              />
            )}
            {view === 'private' && !selectedUser && (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-6 text-center">
                <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center shadow-sm mb-6">
                  <MessageSquare size={40} strokeWidth={1.5} className="text-slate-300" />
                </div>
                <h3 className="text-slate-600 font-semibold mb-2">No Chat Selected</h3>
                <p className="text-sm max-w-xs">Select a friend from the sidebar or start a conversation in the global chat.</p>
                <button 
                  onClick={() => setIsSidebarOpen(true)}
                  className="mt-6 md:hidden px-6 py-2 bg-indigo-600 text-white rounded-full text-sm font-bold shadow-lg shadow-indigo-100"
                >
                  Open Sidebar
                </button>
              </div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </ErrorBoundary>
  );
}

// --- Sub-components ---

function SidebarItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void, key?: string }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3 rounded-xl transition ${active ? 'bg-indigo-50 text-indigo-600' : 'text-slate-600 hover:bg-slate-50'}`}
    >
      {icon}
      <span className="font-medium">{label}</span>
    </button>
  );
}

function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCred.user, { displayName });
        
        // Create user profile in Firestore
        await setDoc(doc(db, 'users', userCred.user.uid), {
          uid: userCred.user.uid,
          email,
          displayName,
          createdAt: serverTimestamp()
        });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-slate-100"
      >
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
            <MessageSquare size={32} />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center text-slate-800 mb-2">
          {isLogin ? 'Welcome Back' : 'Create Account'}
        </h2>
        <p className="text-center text-slate-500 mb-8">
          {isLogin ? 'Sign in to continue chatting' : 'Join the community today'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Display Name</label>
              <input 
                type="text" 
                required 
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
                placeholder="John Doe"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
            <input 
              type="email" 
              required 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input 
              type="password" 
              required 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm border border-red-100">
              {error}
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition shadow-lg shadow-indigo-100 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {isLogin ? 'Sign In' : 'Sign Up'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button 
            onClick={() => setIsLogin(!isLogin)}
            className="text-indigo-600 font-medium hover:underline"
          >
            {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function ChatArea({ title, type, user, targetUser, onMenuClick }: { title: string, type: 'global' | 'private', user: FirebaseUser, targetUser?: UserProfile, key?: string, onMenuClick?: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const colRef = collection(db, type === 'global' ? 'global_messages' : 'private_messages');
    let q;
    
    if (type === 'global') {
      q = query(colRef, orderBy('timestamp', 'asc'));
    } else if (targetUser) {
      const chatId = getChatId(user.uid, targetUser.uid);
      q = query(colRef, 
        where('chatId', '==', chatId), 
        where('participants', 'array-contains', user.uid),
        orderBy('timestamp', 'asc')
      );
    } else {
      return;
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
      setMessages(msgs);
    }, (err) => handleFirestoreError(err, OperationType.LIST, type === 'global' ? 'global_messages' : 'private_messages'));

    return unsubscribe;
  }, [type, targetUser, user.uid]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    try {
      const msgData: any = {
        text: newMessage,
        senderId: user.uid,
        senderName: user.displayName || 'Anonymous',
        timestamp: serverTimestamp()
      };

      if (type === 'private' && targetUser) {
        msgData.receiverId = targetUser.uid;
        msgData.chatId = getChatId(user.uid, targetUser.uid);
        msgData.participants = [user.uid, targetUser.uid];
      }

      await addDoc(collection(db, type === 'global' ? 'global_messages' : 'private_messages'), msgData);
      setNewMessage('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, type === 'global' ? 'global_messages' : 'private_messages');
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex-1 flex flex-col h-full bg-white"
    >
      <div className="p-4 border-b border-slate-200 bg-white flex items-center gap-3 sticky top-0 z-10">
        <button 
          onClick={onMenuClick}
          className="md:hidden p-2 -ml-2 text-slate-500 hover:bg-slate-50 rounded-lg transition"
        >
          <div className="w-5 h-5 flex flex-col justify-center gap-1">
            <div className="h-0.5 w-full bg-current rounded-full" />
            <div className="h-0.5 w-full bg-current rounded-full" />
            <div className="h-0.5 w-full bg-current rounded-full" />
          </div>
        </button>
        <div className="flex-1 flex items-center gap-3 overflow-hidden">
          {type === 'private' && (
            <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0">
              {title[0]}
            </div>
          )}
          <h2 className="text-base font-bold text-slate-800 truncate">{title}</h2>
          {type === 'global' && <span className="text-[10px] bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Public</span>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 opacity-50">
            <p className="text-sm italic">No messages yet. Say hello!</p>
          </div>
        )}
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`flex flex-col ${msg.senderId === user.uid ? 'items-end' : 'items-start'}`}
          >
            <div className={`max-w-[85%] md:max-w-[70%] p-3 rounded-2xl shadow-sm ${
              msg.senderId === user.uid 
                ? 'bg-indigo-600 text-white rounded-tr-none' 
                : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'
            }`}>
              {type === 'global' && msg.senderId !== user.uid && (
                <p className={`text-[10px] font-bold mb-1 ${msg.senderId === user.uid ? 'text-indigo-200' : 'text-indigo-600'}`}>
                  {msg.senderName}
                </p>
              )}
              <p className="text-sm leading-relaxed break-words">{msg.text}</p>
            </div>
            <span className="text-[10px] text-slate-400 mt-1 px-1">
              {msg.timestamp?.toDate ? msg.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...'}
            </span>
          </div>
        ))}
        <div ref={scrollRef} />
      </div>

      <div className="p-4 bg-white border-t border-slate-200">
        <form onSubmit={sendMessage} className="flex gap-2 max-w-4xl mx-auto">
          <input 
            type="text" 
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 transition text-sm"
          />
          <button 
            type="submit"
            disabled={!newMessage.trim()}
            className="p-3 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 transition shadow-lg shadow-indigo-100 disabled:opacity-50 disabled:shadow-none"
          >
            <Send size={20} />
          </button>
        </form>
      </div>
    </motion.div>
  );
}

function ConnectionsArea({ user, users, connections, onMenuClick }: { user: FirebaseUser, users: UserProfile[], connections: Connection[], key?: string, onMenuClick?: () => void }) {
  const [search, setSearch] = useState('');

  const sendRequest = async (targetId: string) => {
    try {
      await addDoc(collection(db, 'connections'), {
        senderId: user.uid,
        receiverId: targetId,
        status: 'pending',
        timestamp: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'connections');
    }
  };

  const updateRequest = async (connId: string, status: 'accepted' | 'rejected') => {
    try {
      if (status === 'rejected') {
        // For simplicity, we just delete or update to rejected. Let's update.
        await updateDoc(doc(db, 'connections', connId), { status: 'rejected' });
      } else {
        await updateDoc(doc(db, 'connections', connId), { status: 'accepted' });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'connections');
    }
  };

  const filteredUsers = users.filter(u => 
    u.displayName.toLowerCase().includes(search.toLowerCase()) &&
    !connections.some(c => (c.senderId === u.uid || c.receiverId === u.uid) && c.status !== 'rejected')
  );

  const pendingRequests = connections.filter(c => c.receiverId === user.uid && c.status === 'pending');
  const sentRequests = connections.filter(c => c.senderId === user.uid && c.status === 'pending');

  return (
    <motion.div 
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex-1 flex flex-col h-full bg-slate-50"
    >
      <div className="p-4 border-b border-slate-200 bg-white flex items-center gap-3 sticky top-0 z-10">
        <button 
          onClick={onMenuClick}
          className="md:hidden p-2 -ml-2 text-slate-500 hover:bg-slate-50 rounded-lg transition"
        >
          <div className="w-5 h-5 flex flex-col justify-center gap-1">
            <div className="h-0.5 w-full bg-current rounded-full" />
            <div className="h-0.5 w-full bg-current rounded-full" />
            <div className="h-0.5 w-full bg-current rounded-full" />
          </div>
        </button>
        <h2 className="text-base font-bold text-slate-800">Connections</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-2xl mx-auto space-y-8">
          {/* Pending Requests */}
          {pendingRequests.length > 0 && (
            <section>
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Pending Requests</h3>
              <div className="grid gap-3">
                {pendingRequests.map(req => {
                  const sender = users.find(u => u.uid === req.senderId);
                  return (
                    <div key={req.id} className="bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold">
                          {sender?.displayName?.[0] || '?'}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{sender?.displayName || 'Unknown'}</p>
                          <p className="text-[10px] text-slate-400 font-medium">wants to connect</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => updateRequest(req.id, 'accepted')}
                          className="p-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition shadow-md shadow-emerald-100"
                        >
                          <Check size={18} />
                        </button>
                        <button 
                          onClick={() => updateRequest(req.id, 'rejected')}
                          className="p-2 bg-slate-100 text-slate-400 rounded-xl hover:bg-slate-200 hover:text-slate-600 transition"
                        >
                          <X size={18} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Discover Users */}
          <section>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Discover People</h3>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input 
                  type="text" 
                  placeholder="Search users..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition shadow-sm"
                />
              </div>
            </div>
            
            <div className="grid gap-3">
              {filteredUsers.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-3xl border border-dashed border-slate-200 text-slate-400">
                  <p className="text-sm">No new people found</p>
                </div>
              ) : (
                filteredUsers.map(u => (
                  <div key={u.uid} className="bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between shadow-sm hover:border-indigo-100 transition">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 font-bold border border-slate-100">
                        {u.displayName[0]}
                      </div>
                      <p className="text-sm font-semibold text-slate-800">{u.displayName}</p>
                    </div>
                    <button 
                      onClick={() => sendRequest(u.uid)}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition shadow-lg shadow-indigo-100"
                    >
                      <UserPlus size={14} />
                      <span className="hidden xs:inline">Connect</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Sent Requests */}
          {sentRequests.length > 0 && (
            <section>
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Sent Requests</h3>
              <div className="grid gap-3">
                {sentRequests.map(req => {
                  const receiver = users.find(u => u.uid === req.receiverId);
                  return (
                    <div key={req.id} className="bg-white/60 p-4 rounded-2xl border border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-3 opacity-60">
                        <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 font-bold">
                          {receiver?.displayName?.[0] || '?'}
                        </div>
                        <p className="text-sm font-semibold text-slate-600">{receiver?.displayName || 'Unknown'}</p>
                      </div>
                      <span className="text-[10px] font-bold text-slate-400 italic bg-slate-50 px-2 py-1 rounded-full">Pending</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </motion.div>
  );
}
