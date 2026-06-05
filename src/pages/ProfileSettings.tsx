import React, { useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, UserCircle, Camera } from 'lucide-react';

export default function ProfileSettings() {
  const { user, token, updateUser } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [avatarObj, setAvatarObj] = useState<File | null>(null);
  const [previewURL, setPreviewURL] = useState(user?.avatar || '');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setAvatarObj(file);
      const url = URL.createObjectURL(file);
      setPreviewURL(url);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData();
    formData.append('name', name);
    formData.append('bio', bio);
    if (avatarObj) formData.append('avatar', avatarObj);

    const res = await fetch('/api/users/profile', {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (res.ok) {
      updateUser(data.user);
      navigate('/');
    }
    setLoading(false);
  };

  return (
    <div className="h-screen w-full flex bg-[#f0f2f5] justify-center items-center">
      <div className="w-full max-w-md h-full sm:h-auto sm:border sm:border-[#d1d7db] bg-[#f0f2f5] flex flex-col shadow-xl overflow-hidden text-[#414141] font-sans">
        {/* Header */}
        <div className="h-28 bg-[#008069] flex items-end p-5 shrink-0">
          <div className="flex items-center gap-6 text-white">
            <button onClick={() => navigate('/')} className="hover:opacity-80 transition-opacity"><ArrowLeft className="w-6 h-6" /></button>
            <h1 className="text-lg font-medium">Профиль</h1>
          </div>
        </div>

        {/* Content */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto flex flex-col w-full">
          <div className="flex flex-col items-center py-7 bg-white mb-3 shadow-sm">
            <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              {previewURL ? (
                <img src={previewURL} className="w-48 h-48 rounded-full object-cover" />
              ) : (
                <div className="w-48 h-48 bg-[#e9edef] rounded-full flex items-center justify-center text-[#54656f]">
                  <UserCircle size={96} className="text-[#a6b0b5]" />
                </div>
              )}
              <div className="absolute inset-0 bg-black bg-opacity-40 rounded-full flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                 <Camera size={32} className="text-white mb-2" />
                 <span className="text-white text-xs text-center px-4 uppercase font-bold">Изменить фото</span>
              </div>
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
            </div>
          </div>

          <div className="bg-white p-6 shadow-sm mb-3">
            <label className="text-xs text-[#008069] block mb-2 font-medium">Ваше имя</label>
            <div className="flex flex-col">
              <input type="text" value={name} onChange={e => setName(e.target.value)} required
                className="w-full text-[#111b21] bg-transparent border-b border-gray-300 focus:border-[#008069] outline-none py-1 transition-colors" />
              <p className="text-xs text-[#667781] mt-2">Это имя будут видеть другие садоводы в Эко-культура.</p>
            </div>
          </div>

          <div className="bg-white p-6 shadow-sm">
            <label className="text-xs text-[#008069] block mb-2 font-medium">О себе</label>
            <div className="flex flex-col">
              <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3}
                placeholder="Расскажите о своих успехах в садоводстве..."
                className="w-full text-[#111b21] bg-transparent border-b border-gray-300 focus:border-[#008069] outline-none py-1 transition-colors resize-none" />
            </div>
          </div>

          <div className="px-6 py-8">
            <button type="submit" disabled={loading} className="w-full bg-[#00a884] text-white font-medium py-3 justify-center flex items-center rounded text-sm hover:bg-[#008069] shadow-sm disabled:opacity-70 transition">
              {loading ? 'Сохранение...' : 'Сохранить изменения'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
