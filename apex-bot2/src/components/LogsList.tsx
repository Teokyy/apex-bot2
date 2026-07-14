import React, { useRef, useEffect } from 'react';
import { LogEntry } from '../types.js';
import { Terminal, ShieldX, RefreshCw } from 'lucide-react';

interface LogsListProps {
  logs: LogEntry[];
  onRefresh: () => void;
  isRefreshing: boolean;
}

export default function LogsList({ logs, onRefresh, isRefreshing }: LogsListProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to top when new logs arrive (since we unshift logs onto the front of the array)
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [logs]);

  const formatLocalTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour12: false });
    } catch {
      return isoString;
    }
  };

  const getLogStyles = (level: string) => {
    switch (level) {
      case 'error':
        return 'text-rose-400 bg-rose-500/5 border-l-rose-500';
      case 'warn':
        return 'text-amber-400 bg-amber-500/5 border-l-amber-500';
      case 'success':
        return 'text-emerald-400 bg-emerald-500/5 border-l-emerald-500';
      case 'info':
      default:
        return 'text-sky-300 bg-sky-500/5 border-l-sky-500';
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl h-[500px] flex flex-col font-mono text-xs">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <Terminal className="w-5 h-5 text-emerald-400" />
          <span>Консоль логов в реальном времени</span>
        </h3>
        
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white cursor-pointer hover:bg-slate-700 transition-all disabled:opacity-50"
          title="Обновить логи консоли"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto mt-4 space-y-2 pr-1 scrollbar-thin scrollbar-thumb-slate-800"
      >
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 py-10">
            <Terminal className="w-10 h-10 stroke-1 mb-2 text-slate-700" />
            <p className="text-xs">Консоль пока пуста...</p>
            <p className="text-[10px] text-slate-600">Попытки синхронизации и отчеты о публикации появятся здесь.</p>
          </div>
        ) : (
          logs.map((log, idx) => (
            <div
              key={idx}
              className={`border-l-2 p-2 rounded-r-md leading-relaxed ${getLogStyles(log.level)}`}
            >
              <div className="flex justify-between text-[10px] opacity-60 mb-0.5">
                <span className="font-bold uppercase">[{log.level}]</span>
                <span>{formatLocalTime(log.timestamp)}</span>
              </div>
              <p className="whitespace-pre-wrap select-text">{log.message}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
