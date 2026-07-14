import React, { useState, useEffect, useCallback } from 'react';
import { BotStatus, LogEntry, PostRecord } from './types.js';
import Header from './components/Header.tsx';
import StatsGrid from './components/StatsGrid.tsx';
import PostsList from './components/PostsList.tsx';
import BirthdaysManager from './components/BirthdaysManager.tsx';
import SettingsForm from './components/SettingsForm.tsx';
import LogsList from './components/LogsList.tsx';
import { Rss, Tv, MessageSquare, AlertCircle, CheckCircle2, X } from 'lucide-react';

export default function App() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [posts, setPosts] = useState<PostRecord[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'posts' | 'birthdays' | 'settings' | 'logs'>('posts');
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [isRefreshingLogs, setIsRefreshingLogs] = useState(false);

  // Notification states
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({
    show: false,
    message: '',
    type: 'success',
  });

  const triggerToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ show: true, message, type });
  }, []);

  const dismissToast = useCallback(() => {
    setToast((prev) => ({ ...prev, show: false }));
  }, []);

  // Fetch status, logs, posts
  const fetchStatus = useCallback(async (showLogsRefreshSpinner = false) => {
    if (showLogsRefreshSpinner) setIsRefreshingLogs(true);
    try {
      const resp = await fetch('/api/status');
      if (resp.ok) {
        const data = await resp.json();
        setStatus(data.status);
        setPosts(data.posts);
        setLogs(data.logs);
      }
    } catch {
      // Fail silently on background poll
    } finally {
      setIsLoading(false);
      if (showLogsRefreshSpinner) setIsRefreshingLogs(false);
    }
  }, []);

  // Poll system status every 4 seconds
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      fetchStatus();
    }, 4000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Handle bot On/Off toggle
  const handleToggleBot = async () => {
    try {
      const resp = await fetch('/api/status/toggle', { method: 'POST' });
      if (resp.ok) {
        const data = await resp.json();
        triggerToast(
          `Бот теперь ${data.isRunning ? 'запущен' : 'приостановлен'}.`,
          data.isRunning ? 'success' : 'error'
        );
        fetchStatus();
      } else {
        triggerToast('Не удалось переключить режим бота', 'error');
      }
    } catch {
      triggerToast('Сетевая ошибка при переключении бота', 'error');
    }
  };

  // Trigger immediate feed check cycle
  const handleCheckNow = async () => {
    try {
      setIsChecking(true);
      triggerToast('Запуск проверки лент RSS...', 'success');
      const resp = await fetch('/api/status/check', { method: 'POST' });
      if (resp.ok) {
        triggerToast('Синхронизация лент успешно завершена!', 'success');
        fetchStatus();
      } else {
        triggerToast('Проверка лент завершена с предупреждениями.', 'error');
      }
    } catch {
      triggerToast('Сетевая ошибка при проверке лент', 'error');
    } finally {
      setIsChecking(false);
    }
  };

  // Toast Auto-dismiss
  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => {
        dismissToast();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [toast.show, dismissToast]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-10">
      {/* Header */}
      <Header
        status={status}
        onToggle={handleToggleBot}
        onCheckNow={handleCheckNow}
        isChecking={isChecking}
      />

      {/* Main Container */}
      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 mt-6 flex-1 flex flex-col gap-6">
        {/* Real-time stats banner */}
        <StatsGrid status={status} />

        {/* Content Layout */}
        <div className="flex flex-col gap-4">
          {/* Navigation Bar */}
          <div className="flex bg-white p-1.5 border border-slate-200 rounded-xl max-w-lg self-center sm:self-start">
            <button
              onClick={() => setActiveTab('posts')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                activeTab === 'posts'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Недавние посты</span>
            </button>
            
            <button
              onClick={() => setActiveTab('birthdays')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                activeTab === 'birthdays'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Tv className="w-3.5 h-3.5" />
              <span>Дни рождения</span>
            </button>
            
            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                activeTab === 'settings'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Rss className="w-3.5 h-3.5" />
              <span>Конфигурация .env</span>
            </button>

            <button
              onClick={() => setActiveTab('logs')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                activeTab === 'logs'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>Консоль логов</span>
            </button>
          </div>

          {/* Active Tab Component */}
          {isLoading ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-10 flex items-center justify-center h-[500px]">
              <div className="flex flex-col items-center gap-2">
                <span className="relative flex h-5 w-5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-5 w-5 bg-indigo-500"></span>
                </span>
                <span className="text-xs font-mono text-slate-400 mt-2">Подключение к серверу бота...</span>
              </div>
            </div>
          ) : (
            <div className="transition-all duration-300">
              {activeTab === 'posts' && <PostsList posts={posts} />}
              {activeTab === 'birthdays' && (
                <BirthdaysManager
                  onSuccess={(msg) => triggerToast(msg, 'success')}
                  onError={(msg) => triggerToast(msg, 'error')}
                />
              )}
              {activeTab === 'settings' && (
                <SettingsForm
                  onSuccess={(msg) => triggerToast(msg, 'success')}
                  onError={(msg) => triggerToast(msg, 'error')}
                />
              )}
              {activeTab === 'logs' && (
                <LogsList
                  logs={logs}
                  onRefresh={() => fetchStatus(true)}
                  isRefreshing={isRefreshingLogs}
                />
              )}
            </div>
          )}
        </div>
      </main>

      {/* Global Toast Alert */}
      {toast.show && (
        <div className="fixed bottom-6 right-6 z-50 animate-bounce-short">
          <div
            className={`flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl border ${
              toast.type === 'success'
                ? 'bg-emerald-500 border-emerald-400 text-white shadow-emerald-500/10'
                : 'bg-rose-500 border-rose-400 text-white shadow-rose-500/10'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 shrink-0" />
            )}
            <p className="text-xs font-semibold leading-relaxed pr-2">
              {toast.message}
            </p>
            <button
              onClick={dismissToast}
              className="hover:bg-white/10 p-1 rounded-lg transition-all text-white/80 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
