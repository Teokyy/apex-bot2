import React from 'react';
import { Bot, Play, Pause, RefreshCw } from 'lucide-react';
import { BotStatus } from '../types.js';

interface HeaderProps {
  status: BotStatus | null;
  onToggle: () => void;
  onCheckNow: () => void;
  isChecking: boolean;
}

export default function Header({ status, onToggle, onCheckNow, isChecking }: HeaderProps) {
  const isRunning = status?.isRunning ?? false;

  return (
    <header className="bg-white border-b border-slate-200 py-4 px-6 flex flex-col sm:flex-row justify-between items-center gap-4 sticky top-0 z-50">
      <div className="flex items-center gap-3">
        <div className="bg-sky-500 text-white p-2.5 rounded-xl shadow-md shadow-sky-500/20">
          <Bot className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight font-display text-slate-800">
            Telegram Авто-Постер & Бот Дней Рождения
          </h1>
          <p className="text-xs text-slate-500 font-mono">
            Панель управления Vite + Express + LLM
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
        <button
          onClick={onToggle}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all ${
            isRunning
              ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-500/15'
              : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/15'
          }`}
        >
          {isRunning ? (
            <>
              <Pause className="w-4 h-4" />
              <span>Приостановить</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              <span>Запустить бота</span>
            </>
          )}
        </button>

        <button
          onClick={onCheckNow}
          disabled={isChecking}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-slate-800/15"
        >
          <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
          <span>{isChecking ? 'Проверка...' : 'Проверить ленты'}</span>
        </button>
      </div>
    </header>
  );
}
