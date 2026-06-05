import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Leaf } from 'lucide-react';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password })
      });
      const data = await res.json();
      if (res.ok) {
        login(data.token, data.user);
        navigate('/');
      } else {
        setError(data.error);
      }
    } catch {
      setError('Ошибка сети');
    }
  };

  return (
    <div className="min-h-screen bg-[#f0f2f5] flex items-center justify-center p-4 font-sans text-[#414141]">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8 border border-[#d1d7db]">
        <div className="flex justify-center mb-6 text-[#00a884]">
          <Leaf size={48} />
        </div>
        <h2 className="text-2xl font-bold text-center text-[#111b21] mb-8">Вход в Эко-культура</h2>
        {error && <div className="bg-red-50 text-red-500 p-3 rounded mb-4 text-center text-sm">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-[#54656f]">Номер телефона</label>
            <input type="tel" required value={phone} onChange={e => setPhone(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] transition-colors" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#54656f]">Пароль</label>
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] transition-colors" />
          </div>
          <button type="submit" className="w-full bg-[#00a884] text-white font-medium py-2 px-4 rounded-md hover:bg-[#008069] transition shadow-sm">
            Войти
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-[#667781]">
          Нет аккаунта? <Link to="/register" className="text-[#00a884] hover:underline">Зарегистрироваться</Link>
        </p>
      </div>
    </div>
  );
}
