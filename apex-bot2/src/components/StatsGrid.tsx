import React from 'react';
import { Send, Tv, Gamepad2, Cake, Hourglass } from 'lucide-react';
import { BotStatus } from '../types.js';

interface StatsGridProps {
  status: BotStatus | null;
}

export default function StatsGrid({ status }: StatsGridProps) {
  const stats = status?.stats || { anime: 0, gaming: 0, birthdays: 0 };
  const total = status?.totalPostsSent ?? 0;
  
  // Format next check Countdown or Next Check Time
  const formatTime = (isoString: string | null) => {
    if (!isoString) return 'Никогда';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return 'Н/Д';
    }
  };

  const statItems = [
    {
      title: 'Всего опубликовано',
      value: total,
      icon: <Send className="w-5 h-5 text-indigo-500" />,
      bg: 'bg-indigo-50 border-indigo-100',
    },
    {
      title: 'Аниме новости (@animuds)',
      value: stats.anime,
      icon: <Tv className="w-5 h-5 text-rose-500" />,
      bg: 'bg-rose-50 border-rose-100',
    },
    {
      title: 'Игровые новости (@gamemuds)',
      value: stats.gaming,
      icon: <Gamepad2 className="w-5 h-5 text-emerald-500" />,
      bg: 'bg-emerald-50 border-emerald-100',
    },
    {
      title: 'Поздравлений с ДР',
      value: stats.birthdays,
      icon: <Cake className="w-5 h-5 text-amber-500" />,
      bg: 'bg-amber-50 border-amber-100',
    },
    {
      title: 'Следующая синхронизация',
      value: status?.isRunning ? formatTime(status.nextCheckTime) : 'Бот остановлен',
      icon: <Hourglass className={`w-5 h-5 text-sky-500 ${status?.isRunning ? 'animate-pulse' : ''}`} />,
      bg: 'bg-sky-50 border-sky-100',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      {statItems.map((item, idx) => (
        <div
          key={idx}
          className={`p-4 rounded-2xl border ${item.bg} flex flex-col justify-between shadow-xs transition-all hover:translate-y-[-2px] hover:shadow-md col-span-2 sm:col-span-1`}
        >
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-slate-500 tracking-wider">
              {item.title}
            </span>
            <div className="p-1.5 rounded-lg bg-white shadow-xs">
              {item.icon}
            </div>
          </div>
          <div className="text-2xl font-bold font-display text-slate-800">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}
