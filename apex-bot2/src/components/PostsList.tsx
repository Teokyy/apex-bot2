import React from 'react';
import { PostRecord } from '../types.js';
import { CheckCircle2, XCircle, Clock, ExternalLink } from 'lucide-react';

interface PostsListProps {
  posts: PostRecord[];
}

export default function PostsList({ posts }: PostsListProps) {
  const formatTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs h-[500px] flex flex-col">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100">
        <h3 className="text-base font-bold text-slate-800 font-display flex items-center gap-2">
          <Clock className="w-5 h-5 text-indigo-500" />
          <span>Недавно опубликованные посты</span>
        </h3>
        <span className="text-xs bg-indigo-50 text-indigo-600 font-semibold px-2.5 py-1 rounded-full font-mono">
          Последние {posts.length} записей
        </span>
      </div>

      <div className="overflow-y-auto flex-1 mt-4 space-y-3 pr-1">
        {posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 py-10">
            <Clock className="w-10 h-10 stroke-1 mb-2" />
            <p className="text-sm font-medium">Посты пока не опубликованы</p>
            <p className="text-xs text-slate-400">Запустите ручную или автоматическую синхронизацию для публикации</p>
          </div>
        ) : (
          posts.map((post) => {
            const isSuccess = post.status === 'success';
            const isBirthday = post.title.includes('character birthdays');

            return (
              <div
                key={post.id}
                className="border border-slate-100 hover:border-slate-200 bg-slate-50/50 hover:bg-slate-50 p-3.5 rounded-xl transition-all"
              >
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md font-mono ${
                        post.channel === '@animuds'
                          ? 'bg-rose-50 text-rose-600 border border-rose-100'
                          : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                      }`}
                    >
                      {post.channel}
                    </span>
                    {isBirthday && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-50 text-amber-600 border border-amber-100 font-mono">
                        ДЕНЬ РОЖДЕНИЯ
                      </span>
                    )}
                  </div>
                  
                  <span className="text-[10px] font-medium text-slate-400 font-mono">
                    {formatTime(post.time)}
                  </span>
                </div>

                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-slate-700 leading-snug line-clamp-2">
                    {post.title}
                  </p>
                  
                  <div className="flex items-center shrink-0">
                    {isSuccess ? (
                      <div className="text-emerald-500" title="Posted successfully">
                        <CheckCircle2 className="w-4 h-4 fill-emerald-50" />
                      </div>
                    ) : (
                      <div className="text-rose-500" title="Posting failed">
                        <XCircle className="w-4 h-4 fill-rose-50" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
