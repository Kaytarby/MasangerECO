import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { Search, MoreVertical, Send, Image as ImageIcon, Users, UserCircle, LogOut, ArrowLeft, Sun, MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Home() {
  const { user, token, logout } = useAuth();
  const { socket } = useSocket();
  const [chats, setChats] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [selectedChat, setSelectedChat] = useState<any | null>(null);
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [showUsers, setShowUsers] = useState(false);
  const [search, setSearch] = useState('');
  const [groupName, setGroupName] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const authHeaders = () => ({ 'Authorization': `Bearer ${token}` });

  const fetchChats = async () => {
    try {
      const res = await fetch('/api/chats', { headers: authHeaders() });
      const data = await res.json();
      setChats(data.chats || []);
    } catch { /* ignore */ }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users', { headers: authHeaders() });
      const data = await res.json();
      setAllUsers(data.users || []);
    } catch { /* ignore */ }
  };

  const markRead = (chatId: number) => {
    fetch(`/api/chats/${chatId}/read`, { method: 'POST', headers: authHeaders() }).catch(() => {});
    setChats(prev => prev.map(c => (c.id === chatId && c.unread ? { ...c, unread: 0 } : c)));
  };

  useEffect(() => {
    if (token) {
      fetchChats();
      fetchUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (socket) {
      socket.on('new_message', (msg: any) => {
        if (selectedChat && msg.chat_id === selectedChat.id) {
          setMessages(prev => (prev.some((m: any) => m.id === msg.id) ? prev : [...prev, msg]));
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
          markRead(selectedChat.id);
        }
        fetchChats();

        // Browser notification for messages from other chats
        if (msg.sender_id !== user?.id && (!selectedChat || msg.chat_id !== selectedChat.id)) {
          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification(`Новое сообщение от ${msg.sender_name}`, {
                body: msg.text || '📷 Фотография',
                icon: 'https://api.iconify.design/mdi/leaf.svg'
              });
            } catch { /* ignore */ }
          }
        }
      });
      return () => { socket.off('new_message'); };
    }
  }, [socket, selectedChat, user?.id]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'denied' && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
  }, []);

  const openChat = async (chat: any) => {
    setSelectedChat(chat);
    setShowUsers(false);
    setSearch('');
    setMessages([]);
    const res = await fetch(`/api/chats/${chat.id}/messages`, { headers: authHeaders() });
    const data = await res.json();
    setMessages(data.messages || []);
    setTimeout(() => messagesEndRef.current?.scrollIntoView(), 100);
    socket?.emit('join_chat', chat.id);
    markRead(chat.id);
  };

  const createDirectChat = async (otherUser: any) => {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ type: 'direct', participantIds: [otherUser.id] })
    });
    const data = await res.json();
    if (!data.chatId) return;
    fetchChats();
    const chat = { id: data.chatId, type: 'direct', name: otherUser.name, avatar: otherUser.avatar, other_user_id: otherUser.id, unread: 0 };
    openChat(chat);
  };

  const createGroupChat = async () => {
    if (selectedUsers.length === 0 || !groupName.trim()) return;
    const name = groupName.trim();
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ type: 'group', participantIds: selectedUsers, name })
    });
    const data = await res.json();
    if (!data.chatId) return;
    fetchChats();
    setGroupName('');
    setSelectedUsers([]);
    setShowUsers(false);
    openChat({ id: data.chatId, type: 'group', name, unread: 0 });
  };

  const sendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedChat || (!text.trim() && !imageFile) || sending) return;

    const formData = new FormData();
    if (text.trim()) formData.append('text', text);
    if (imageFile) formData.append('image', imageFile);

    setText('');
    setImageFile(null);
    setSending(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      await fetch(`/api/chats/${selectedChat.id}/messages`, {
        method: 'POST',
        headers: authHeaders(),
        body: formData
      });
    } catch { /* message will not appear; user can retry */ }
    setSending(false);
  };

  const formatTime = (dateStr?: string | null) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
  };

  const lastMessagePreview = (c: any) => {
    if (c.last_message_image) return '📷 Фотография';
    if (!c.last_message) return 'Нет сообщений';
    return c.last_message;
  };

  const q = search.trim().toLowerCase();
  const filteredChats = q ? chats.filter((c: any) => (c.name || '').toLowerCase().includes(q)) : chats;
  const filteredUsers = q
    ? allUsers.filter((u: any) => u.name.toLowerCase().includes(q))
    : allUsers;
  const searching = q.length > 0;

  return (
    <div className="h-screen w-full flex flex-col md:flex-row bg-[#f0f2f5] font-sans overflow-hidden text-[#414141]">
      {/* Sidebar */}
      <div className={`w-full md:w-1/3 max-w-[400px] h-full bg-white border-r border-[#d1d7db] flex flex-col ${selectedChat ? 'hidden md:flex' : 'flex'}`}>
        {/* Header */}
        <div className="h-[64px] bg-[#f0f2f5] px-4 py-2 flex items-center justify-between shrink-0">
          <Link to="/profile" className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity">
            {user?.avatar ? (
              <img src={user.avatar} className="w-10 h-10 rounded-full object-cover" />
            ) : (
              <UserCircle size={40} className="text-[#54656f]" />
            )}
            <div className="min-w-0">
              <span className="font-semibold text-[#111b21] truncate block">{user?.name}</span>
              <span className="text-xs text-[#667781] block truncate">{user?.phone}</span>
            </div>
          </Link>
          <div className="flex gap-1 text-[#54656f]">
            <button onClick={() => setShowUsers(!showUsers)} title="Новый чат" className={`hover:bg-[#d9dbdf] rounded-full p-1.5 transition ${showUsers ? 'bg-[#d9dbdf]' : ''}`}><Users size={20} /></button>
            <button onClick={logout} title="Выйти" className="hover:bg-[#d9dbdf] rounded-full p-1.5 transition"><LogOut size={20} /></button>
          </div>
        </div>

        {/* Search */}
        <div className="p-2 bg-white shrink-0">
          <div className="bg-[#f0f2f5] rounded-lg flex items-center px-3 py-1.5 gap-2">
            <Search className="text-[#54656f] shrink-0" size={18} />
            <input
              type="text"
              placeholder="Поиск чатов и людей"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent border-none outline-none text-sm w-full"
            />
            {searching && (
              <button onClick={() => setSearch('')} className="text-[#54656f] text-xs hover:text-[#111b21] shrink-0">✕</button>
            )}
          </div>
        </div>

        {/* List Areas */}
        <div className="flex-1 overflow-y-auto">
          {showUsers && !searching ? (
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-500">Новая группа</h3>
                <button onClick={() => setShowUsers(false)} className="text-xs text-[#00a884]">Закрыть</button>
              </div>
              <div className="mb-4">
                <input type="text" placeholder="Название группы" value={groupName} onChange={(e) => setGroupName(e.target.value)}
                  className="w-full border border-gray-200 rounded px-3 py-2 mb-2 focus:ring-2 focus:ring-green-500 outline-none" />
                <button onClick={createGroupChat}
                  disabled={!groupName.trim() || selectedUsers.length === 0}
                  className="w-full bg-green-600 text-white rounded py-2 text-sm disabled:opacity-50">
                  Создать группу ({selectedUsers.length} уч.)
                </button>
              </div>
              <h3 className="text-sm font-semibold text-gray-500 mb-2">Добавить участников</h3>
              {allUsers.length === 0 && <p className="text-sm text-gray-400">Пока нет других пользователей</p>}
              {allUsers.map((u: any) => (
                <div key={u.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer border-b">
                  <input type="checkbox" checked={selectedUsers.includes(u.id)} onChange={(e) => {
                    if (e.target.checked) setSelectedUsers(prev => [...prev, u.id]);
                    else setSelectedUsers(prev => prev.filter(id => id !== u.id));
                  }} className="w-5 h-5 text-green-600 accent-green-600" />
                  <div onClick={() => createDirectChat(u)} className="flex items-center gap-3 flex-1 min-w-0">
                    {u.avatar ? <img src={u.avatar} className="w-10 h-10 rounded-full object-cover" /> :
                      <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center"><UserCircle className="text-gray-400" size={24} /></div>}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{u.name}</div>
                      {u.bio && <div className="text-xs text-gray-500 truncate">{u.bio}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div>
              {searching && <div className="px-4 pt-3 pb-1 text-xs font-semibold text-gray-400 uppercase">Чаты</div>}
              {filteredChats.length === 0 && (
                <p className="text-sm text-gray-400 px-4 py-3">{searching ? 'Ничего не найдено' : 'Чатов пока нет'}</p>
              )}
              {filteredChats.map((c: any) => (
                <div key={c.id} onClick={() => openChat(c)}
                  className={`flex items-center p-3 cursor-pointer hover:bg-[#f5f6f6] ${selectedChat?.id === c.id ? 'bg-[#f0f2f5]' : 'bg-white'}`}>
                  {c.avatar ? (
                    <img src={c.avatar} className="w-12 h-12 rounded-full object-cover mr-3 shrink-0" />
                  ) : (
                    <div className="w-12 h-12 bg-[#81c784] text-white rounded-full flex items-center justify-center text-xl font-bold mr-3 shrink-0">
                      {(c.name || 'Г')[0].toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0 border-b border-[#f0f2f5] pb-2">
                    <div className="flex justify-between items-baseline mb-1">
                      <h3 className="font-medium text-[#111b21] truncate">{c.name || 'Группа'}</h3>
                      <span className="text-xs text-[#667781] shrink-0 ml-2">{formatTime(c.last_message_time)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-[#667781] truncate flex-1">{lastMessagePreview(c)}</p>
                      {c.unread > 0 && (
                        <div className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-[#00a884] text-white text-xs font-semibold flex items-center justify-center shrink-0">
                          {c.unread > 99 ? '99+' : c.unread}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {searching && (
                <>
                  <div className="px-4 pt-4 pb-1 text-xs font-semibold text-gray-400 uppercase">Люди — нажмите, чтобы начать чат</div>
                  {filteredUsers.length === 0 && <p className="text-sm text-gray-400 px-4 py-2">Среди пользователей не найдено</p>}
                  {filteredUsers.map((u: any) => (
                    <div key={u.id} onClick={() => createDirectChat(u)} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-[#f5f6f6] bg-white">
                      {u.avatar ? <img src={u.avatar} className="w-12 h-12 rounded-full object-cover shrink-0" /> :
                        <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center shrink-0"><UserCircle className="text-gray-400" size={28} /></div>}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-[#111b21] truncate">{u.name}</div>
                        {u.bio && <div className="text-xs text-gray-500 truncate">{u.bio}</div>}
                      </div>
                    </div>
                  ))}
                </>
              )}

              {!searching && chats.length === 0 && (
                <div className="flex flex-col items-center justify-center px-8 py-12 text-center">
                  <MessageCircle size={48} className="text-gray-300 mb-4" />
                  <p className="text-sm text-gray-500 mb-4">Здесь появятся ваши чаты.</p>
                  <button onClick={() => setShowUsers(true)} className="bg-[#00a884] text-white text-sm rounded-lg px-4 py-2 hover:bg-[#008069] transition">
                    Начать первый чат
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      {selectedChat ? (
        <div className="flex-1 h-full flex flex-col bg-[#efeae2] relative min-w-0">
          {/* Header */}
          <div className="h-[64px] bg-[#f0f2f5] flex items-center gap-3 px-4 py-2 border-l border-[#d1d7db] z-10 w-full shadow-sm shrink-0">
            <button onClick={() => setSelectedChat(null)} className="md:hidden"><ArrowLeft className="text-[#54656f]" /></button>
            {selectedChat.avatar ? (
              <img src={selectedChat.avatar} className="w-10 h-10 rounded-full object-cover shrink-0" />
            ) : (
              <div className="w-10 h-10 bg-[#81c784] text-white rounded-full flex items-center justify-center font-bold shrink-0">
                {(selectedChat.name || 'Г')[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="font-medium text-[#111b21] truncate">{selectedChat.name || 'Группа'}</h2>
              <p className="text-xs text-[#667781]">{selectedChat.type === 'group' ? 'Группа' : 'Личный чат'}</p>
            </div>
            <MoreVertical className="text-[#54656f]" />
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 md:p-8 flex flex-col gap-2 relative w-full">
            {messages.map((m: any, i: number) => {
              const isSelf = m.sender_id === user?.id;
              return (
                <div key={m.id || i} className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] md:max-w-[75%] rounded-lg p-2 shadow-sm relative ${isSelf ? 'bg-[#d9fdd3] rounded-tr-none' : 'bg-white rounded-tl-none'}`}>
                    {!isSelf && selectedChat.type === 'group' && (
                      <div className="text-[11px] font-bold text-[#e67e22] mb-1 px-1">{m.sender_name}</div>
                    )}
                    {m.image_url && (
                      <img src={m.image_url} alt="Фотография" className="rounded-md max-w-full mb-1 object-cover shadow-sm" style={{ maxHeight: '300px' }} />
                    )}
                    {m.text && <p className="text-sm text-[#111b21] break-words whitespace-pre-wrap">{m.text}</p>}
                    <div className="text-[10px] text-[#667781] text-right mt-1">
                      {formatTime(m.created_at)}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="bg-[#f0f2f5] p-3 shrink-0 w-full z-10 flex flex-col gap-2 relative border-l border-[#d1d7db]">
            {imageFile && (
              <div className="absolute bottom-full left-0 mb-2 ml-4 bg-white p-2 rounded shadow-lg flex items-center gap-4">
                <span className="text-sm truncate max-w-[200px]">{imageFile.name}</span>
                <button onClick={() => setImageFile(null)} className="text-red-500 hover:text-red-700 text-sm">Удалить</button>
              </div>
            )}
            <form onSubmit={sendMessage} className="flex gap-2 items-end w-full">
              <button type="button" onClick={() => fileInputRef.current?.click()} title="Прикрепить фото" className="p-2 text-[#54656f] hover:bg-[#d9dbdf] rounded-full transition">
                <ImageIcon size={24} />
              </button>
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) setImageFile(e.target.files[0]);
                e.target.value = '';
              }} />
              <div className="flex-1 bg-white rounded-lg px-3 py-2 flex items-center min-h-[44px]">
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    const el = e.target;
                    el.style.height = 'auto';
                    el.style.height = Math.min(el.scrollHeight, 128) + 'px';
                  }}
                  placeholder="Введите сообщение"
                  className="w-full resize-none outline-none max-h-32 text-sm pt-1"
                  rows={1}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                />
              </div>
              <button type="submit" disabled={!text.trim() && !imageFile} title="Отправить"
                className={`p-2 rounded-full flex items-center justify-center shrink-0 transition ${text.trim() || imageFile ? 'text-[#00a884] hover:bg-[#d9dbdf]' : 'text-gray-400'}`}>
                <Send size={24} />
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="hidden md:flex flex-1 items-center justify-center bg-[#f0f2f5] flex-col text-center px-10">
          <Sun size={120} className="text-gray-300 mb-8" />
          <h1 className="text-3xl font-light text-gray-700 mb-4">Эко-культура</h1>
          <p className="text-gray-500 max-w-md">Отправляйте и получайте сообщения в реальном времени, делитесь фотографиями. Моментально обменивайтесь опытом садоводства.</p>
        </div>
      )}
    </div>
  );
}
