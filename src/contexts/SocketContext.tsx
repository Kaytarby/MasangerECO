import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

export interface ServerHealth {
  ok: boolean;
  mode: 'supabase' | 'sqlite' | 'demo';
  persistent: boolean;
  schemaReady: boolean;
  realtime: 'socket.io' | 'polling';
  maxUploadBytes?: number;
  hint?: string;
}

interface SocketContextType {
  socket: Socket | null;
  realtime: 'socket.io' | 'polling' | null;
  health: ServerHealth | null;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  realtime: null,
  health: null,
});

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
  const { token, user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [health, setHealth] = useState<ServerHealth | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((res) => res.json())
      .then((data: ServerHealth) => {
        if (!cancelled && data && data.realtime) {
          setHealth(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHealth({
            ok: true,
            mode: 'supabase',
            persistent: true,
            schemaReady: true,
            realtime: 'polling',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const realtime = health?.realtime ?? null;

  useEffect(() => {
    if (realtime === 'socket.io' && token && user) {
      const newSocket = io({
        auth: { token },
      });
      setSocket(newSocket);
      return () => {
        newSocket.close();
        setSocket(null);
      };
    }
    setSocket(null);
  }, [realtime, token, user?.id]);

  return (
    <SocketContext.Provider value={{ socket, realtime, health }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
