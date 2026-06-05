import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { Search, MoreVertical, Send, Image as ImageIcon, Users, UserCircle, LogOut, ArrowLeft, Sun } from 'lucide-react';
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
  const [groupName, setGroupName] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchChats = async () => {
    const res = await fetch('/api/chats', { headers: { 'Authorization': `Bearer ${token}` }});
    const data = await res.json();
    setChats(data.chats || []);
  };

  const fetchUsers = async () => {
    const res = await fetch('/api/users', { headers: { 'Authorization': `Bearer ${token}` }});
    const data = await res.json();
    setAllUsers(data.users || []);
  };

  useEffect(() => {
    if (token) {
      fetchChats();
      fetchUsers();
    }
  }, [token]);

  useEffect(() => {
    if (socket) {
      socket.on('new_message', (msg: any) => {
        if (selectedChat && msg.chat_id === selectedChat.id) {
          setMessages(prev => [...prev, msg]);
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
        fetchChats(); // Update last message logic
        
        // Push notification logic
        if (msg.sender_id !== user?.id) {
          if (Notification.permission === 'granted') {
            new Notification(`Новое сообщение от ${msg.sender_name}`, {
              body: msg.text || 'Фотография',
              icon: 'https://api.iconify.design/mdi/leaf.svg'
            });
          }
        }
      });
      return () => { socket.off('new_message'); }
    }
  }, [socket, selectedChat, user?.id]);

  useEffect(() => {
    // Request notification permission
    if ('Notification' in window && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  }, []);

  const openChat = async (chat: any) => {
    setSelectedChat(chat);
    setShowUsers(false);
    const res = await fetch(`/api/chats/${chat.id}/messages`, { headers: { 'Authorization': `Bearer ${token}` }});
    const data = await res.json();
    setMessages(data.messages || []);
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView();
    }, 100);
    socket?.emit('join_chat', chat.id);
  };

  const createDirectChat = async (otherUser: any) => {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ type: 'direct', participantIds: [otherUser.id] })
    });
    const data = await res.json();
    fetchChats();
    // Simulate opening it
    const chat = { id: data.chatId, type: 'direct', name: otherUser.name, avatar: otherUser.avatar, other_user_id: otherUser.id };
    openChat(chat);
  };

  const createGroupChat = async () => {
    if (selectedUsers.length === 0 || !groupName) return;
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ type: 'group', participantIds: selectedUsers, name: groupName })
    });
    const data = await res.json();
    fetchChats();
    setGroupName('');
    setSelectedUsers([]);
    setShowUsers(false);
    openChat({ id: data.chatId, type: 'group', name: groupName });
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text && !imageFile) return;

    const formData = new FormData();
    if (text) formData.append('text', text);
    if (imageFile) formData.append('image', imageFile);

    setText('');
    setImageFile(null);

    await fetch(`/api/chats/${selectedChat.id}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
  };

  const getTime = (dateStr: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute:'2-digit' });
  };

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
            <span className="font-semibold text-lg text-[#111b21] truncate">{user?.name}</span>
          </Link>
          <div className="flex gap-4 text-[#54656f]">
            <button onClick={() => setShowUsers(!showUsers)} className="hover:bg-[#d9dbdf] rounded-full p-1 transition"><Users size={20} /></button>
            <button onClick={logout} className="hover:bg-[#d9dbdf] rounded-full p-1 transition"><LogOut size={20} /></button>
          </div>
        </div>

        {/* Search */}
        <div className="p-2 bg-white shrink-0">
          <div className="bg-[#f0f2f5] rounded-lg flex items-center px-3 py-1.5">
            <Search className="text-[#54656f] mr-2" size={18} />
            <input type="text" placeholder="Поиск или новый чат" className="bg-transparent border-none outline-none text-sm w-full" />
          </div>
        </div>

        {/* List Areas */}
        <div className="flex-1 overflow-y-auto">
          {showUsers ? (
            <div className="p-4">
              <h3 className="text-sm font-semibold text-gray-500 mb-4">Создать Группу</h3>
              <div className="mb-4">
                <input type="text" placeholder="Название группы" value={groupName} onChange={(e) => setGroupName(e.target.value)} className="w-full border rounded px-3 py-2 mb-2 focus:ring-2 focus:ring-green-500 outline-none"/>
                <button onClick={createGroupChat} className="w-full bg-green-600 text-white rounded py-2 text-sm">Создать</button>
              </div>
              <h3 className="text-sm font-semibold text-gray-500 mb-2">Пользователи</h3>
              {allUsers.map((u: any) => (
                <div key={u.id} className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg cursor-pointer border-b">
                  <input type="checkbox" checked={selectedUsers.includes(u.id)} onChange={(e) => {
                    if (e.target.checked) setSelectedUsers(prev => [...prev, u.id]);
                    else setSelectedUsers(prev => prev.filter(id => id !== u.id));
                  }} className="w-5 h-5 text-green-600" />
                  <div onClick={() => createDirectChat(u)} className="flex items-center gap-3 flex-1">
                    {u.avatar ? <img src={u.avatar} className="w-10 h-10 rounded-full object-cover" /> : <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center"><UserCircle className="text-gray-400" size={24}/></div>}
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
              {chats.map((c: any) => (
                <div key={c.id} onClick={() => openChat(c)} className={`flex items-center p-3 cursor-pointer hover:bg-[#f5f6f6] ${selectedChat?.id === c.id ? 'bg-[#f0f2f5]' : 'bg-white'}`}>
                  {c.avatar ? (
                    <img src={c.avatar} className="w-12 h-12 rounded-full object-cover mr-3" />
                  ) : (
                    <div className="w-12 h-12 bg-[#81c784] text-white rounded-full flex items-center justify-center text-xl font-bold mr-3">
                      {c.name ? c.name[0].toUpperCase() : 'Г'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0 border-b border-[#f0f2f5] pb-2">
                    <div className="flex justify-between items-baseline mb-1">
                      <h3 className="font-medium text-[#111b21] truncate">{c.name || 'Group Chat'}</h3>
                      <span className="text-xs text-[#667781]">{getTime(c.last_message_time)}</span>
                    </div>
                    <p className="text-sm text-[#667781] truncate">{c.last_message || '...'}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      {selectedChat ? (
        <div className={`flex-1 h-full flex flex-col bg-[#efeae2] relative ${!selectedChat ? 'hidden md:flex' : 'flex'}`}>
          {/* Header */}
          <div className="h-[64px] bg-[#f0f2f5] flex items-center gap-3 px-4 py-2 border-l border-[#d1d7db] z-10 w-full shadow-sm shrink-0">
            <button onClick={() => setSelectedChat(null)} className="md:hidden"><ArrowLeft className="text-[#54656f]"/></button>
            {selectedChat.avatar ? (
              <img src={selectedChat.avatar} className="w-10 h-10 rounded-full object-cover mr-3" />
            ) : (
              <div className="w-10 h-10 bg-[#81c784] text-white rounded-full flex items-center justify-center font-bold mr-3">
                {selectedChat.name ? selectedChat.name[0].toUpperCase() : 'Г'}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="font-medium text-[#111b21] truncate">{selectedChat.name || 'Group Chat'}</h2>
              <p className="text-xs text-[#667781]">{selectedChat.type === 'group' ? 'Группа' : 'Личный чат'}</p>
            </div>
            <MoreVertical className="text-[#54656f]" />
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 md:p-8 flex flex-col gap-4 relative w-full">
            {messages.map((m: any, i: number) => {
              const isSelf = m.sender_id === user?.id;
              return (
                <div key={m.id || i} className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[75%] rounded-lg p-2 shadow-sm relative ${isSelf ? 'bg-[#d9fdd3] rounded-tr-none' : 'bg-white rounded-tl-none'}`}>
                    {!isSelf && selectedChat.type === 'group' && (
                      <div className="text-[11px] font-bold text-[#e67e22] mb-1 px-1">{m.sender_name}</div>
                    )}
                    {m.image_url && (
                      <img src={m.image_url} alt="Uploaded" className="rounded-md max-w-full mb-1 object-cover shadow-sm" style={{maxHeight: '300px'}} />
                    )}
                    {m.text && <p className="text-sm text-[#111b21] break-words">{m.text}</p>}
                    <div className="text-[10px] text-[#667781] text-right mt-1">
                      {getTime(m.created_at)}
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
                  <button onClick={() => setImageFile(null)} className="text-red-500 hover:text-red-700">Удалить</button>
                </div>
             )}
            <form onSubmit={sendMessage} className="flex gap-2 items-end w-full">
              <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2 text-[#54656f] hover:bg-[#d9dbdf] rounded-full transition">
                <ImageIcon size={24} />
              </button>
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) setImageFile(e.target.files[0]);
              }} />
              <div className="flex-1 bg-white rounded-lg px-3 py-2 flex items-center min-h-[44px]">
                <textarea 
                  value={text} 
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Введите сообщение" 
                  className="w-full resize-none outline-none max-h-32 text-sm pt-1" 
                  rows={1}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage(e);
                    }
                  }}
                />
              </div>
              <button type="submit" disabled={!text && !imageFile} className={`p-2 rounded-full flex items-center justify-center shrink-0 transition ${text || imageFile ? 'text-[#00a884] hover:bg-[#d9dbdf]' : 'text-gray-400'}`}>
                <Send size={24} />
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="hidden md:flex flex-1 items-center justify-center bg-[#f0f2f5] flex-col text-center px-10">
          <Sun size={120} className="text-gray-300 mb-8" />
          <h1 className="text-3xl font-light text-gray-700 mb-4">Эко-культура Web</h1>
          <p className="text-gray-500">Отправляйте и получайте сообщения. Моментально делитесь опытом садоводства.</p>
        </div>
      )}
    </div>
  );
}
