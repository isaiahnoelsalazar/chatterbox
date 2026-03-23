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
      <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
        {/* Sidebar */}
        <div className="w-20 md:w-64 bg-white border-r border-slate-200 flex flex-col">
          <div className="p-4 border-bottom flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold">
              {user.displayName?.[0] || user.email?.[0]}
            </div>
            <div className="hidden md:block overflow-hidden">
              <p className="font-semibold truncate">{user.displayName || 'User'}</p>
              <p className="text-xs text-slate-500 truncate">{user.email}</p>
            </div>
          </div>

          <nav className="flex-1 p-2 space-y-1">
            <SidebarItem 
              icon={<Globe size={20} />} 
              label="Global Chat" 
              active={view === 'global'} 
              onClick={() => { setView('global'); setSelectedUser(null); }} 
            />
            <SidebarItem 
              icon={<Users size={20} />} 
              label="Connections" 
              active={view === 'connections'} 
              onClick={() => { setView('connections'); setSelectedUser(null); }} 
            />
            
            <div className="mt-6 mb-2 px-3 hidden md:block">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Private Chats</p>
            </div>
            
            {friends.map(friend => (
              <SidebarItem 
                key={friend.uid}
                icon={<div className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-[10px]">{friend.displayName[0]}</div>}
                label={friend.displayName}
                active={view === 'private' && selectedUser?.uid === friend.uid}
                onClick={() => { setView('private'); setSelectedUser(friend); }}
              />
            ))}
          </nav>

          <button 
            onClick={() => signOut(auth)}
            className="p-4 flex items-center gap-3 text-slate-600 hover:bg-slate-50 transition w-full border-t border-slate-100"
          >
            <LogOut size={20} />
            <span className="hidden md:block font-medium">Logout</span>
          </button>
        </div>

        {/* Main Content */}
        <main className="flex-1 flex flex-col relative">
          <AnimatePresence mode="wait">
            {view === 'global' && (
              <ChatArea key="global" title="Global Chat" type="global" user={user} />
            )}
            {view === 'private' && selectedUser && (
              <ChatArea 
                key={`private-${selectedUser.uid}`} 
                title={selectedUser.displayName} 
                type="private" 
                user={user} 
                targetUser={selectedUser} 
              />
            )}
            {view === 'connections' && (
              <ConnectionsArea 
                key="connections" 
                user={user} 
                users={users} 
                connections={connections} 
              />
            )}
            {view === 'private' && !selectedUser && (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                <MessageSquare size={48} strokeWidth={1} className="mb-4" />
                <p>Select a friend to start chatting</p>
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
      <span className="hidden md:block font-medium">{label}</span>
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

function ChatArea({ title, type, user, targetUser }: { title: string, type: 'global' | 'private', user: FirebaseUser, targetUser?: UserProfile, key?: string }) {
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
      q = query(colRef, where('chatId', '==', chatId), orderBy('timestamp', 'asc'));
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
      }

      await addDoc(collection(db, type === 'global' ? 'global_messages' : 'private_messages'), msgData);
      setNewMessage('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, type === 'global' ? 'global_messages' : 'private_messages');
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex-1 flex flex-col h-full"
    >
      <div className="p-4 border-b border-slate-200 bg-white flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">{title}</h2>
        {type === 'global' && <span className="text-xs bg-indigo-100 text-indigo-600 px-2 py-1 rounded-full font-medium">Public</span>}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`flex flex-col ${msg.senderId === user.uid ? 'items-end' : 'items-start'}`}
          >
            <div className={`max-w-[80%] p-3 rounded-2xl ${
              msg.senderId === user.uid 
                ? 'bg-indigo-600 text-white rounded-tr-none' 
                : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'
            }`}>
              {type === 'global' && msg.senderId !== user.uid && (
                <p className="text-[10px] font-bold mb-1 opacity-70">{msg.senderName}</p>
              )}
              <p className="text-sm leading-relaxed">{msg.text}</p>
            </div>
            <span className="text-[10px] text-slate-400 mt-1 px-1">
              {msg.timestamp?.toDate ? msg.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...'}
            </span>
          </div>
        ))}
        <div ref={scrollRef} />
      </div>

      <form onSubmit={sendMessage} className="p-4 bg-white border-t border-slate-200 flex gap-2">
        <input 
          type="text" 
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 transition"
        />
        <button 
          type="submit"
          className="p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition shadow-lg shadow-indigo-100"
        >
          <Send size={20} />
        </button>
      </form>
    </motion.div>
  );
}

function ConnectionsArea({ user, users, connections }: { user: FirebaseUser, users: UserProfile[], connections: Connection[], key?: string }) {
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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex-1 p-6 overflow-y-auto"
    >
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Pending Requests */}
        {pendingRequests.length > 0 && (
          <section>
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Pending Requests</h3>
            <div className="grid gap-3">
              {pendingRequests.map(req => {
                const sender = users.find(u => u.uid === req.senderId);
                return (
                  <div key={req.id} className="bg-white p-4 rounded-2xl border border-slate-200 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold">
                        {sender?.displayName?.[0] || '?'}
                      </div>
                      <div>
                        <p className="font-semibold">{sender?.displayName || 'Unknown'}</p>
                        <p className="text-xs text-slate-500">wants to connect</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => updateRequest(req.id, 'accepted')}
                        className="p-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition"
                      >
                        <Check size={18} />
                      </button>
                      <button 
                        onClick={() => updateRequest(req.id, 'rejected')}
                        className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition"
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
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Discover People</h3>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="text" 
                placeholder="Search users..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition"
              />
            </div>
          </div>
          
          <div className="grid gap-3">
            {filteredUsers.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
                <p>No new people found</p>
              </div>
            ) : (
              filteredUsers.map(u => (
                <div key={u.uid} className="bg-white p-4 rounded-2xl border border-slate-200 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold">
                      {u.displayName[0]}
                    </div>
                    <p className="font-semibold">{u.displayName}</p>
                  </div>
                  <button 
                    onClick={() => sendRequest(u.uid)}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition"
                  >
                    <UserPlus size={16} />
                    <span>Connect</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Sent Requests */}
        {sentRequests.length > 0 && (
          <section>
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Sent Requests</h3>
            <div className="grid gap-3">
              {sentRequests.map(req => {
                const receiver = users.find(u => u.uid === req.receiverId);
                return (
                  <div key={req.id} className="bg-white p-4 rounded-2xl border border-slate-200 flex items-center justify-between opacity-70">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 font-bold">
                        {receiver?.displayName?.[0] || '?'}
                      </div>
                      <p className="font-semibold">{receiver?.displayName || 'Unknown'}</p>
                    </div>
                    <span className="text-xs font-medium text-slate-400 italic">Pending...</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </motion.div>
  );
}
