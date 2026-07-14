import React, { useState, useEffect } from 'react';
import { BirthdayDatabase, Birthday } from '../types.js';
import { Cake, Search, Plus, Trash2, Calendar, AlertCircle } from 'lucide-react';

interface BirthdaysManagerProps {
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

const MONTHS = [
  { value: '01', name: 'Январь' },
  { value: '02', name: 'Февраль' },
  { value: '03', name: 'Март' },
  { value: '04', name: 'Апрель' },
  { value: '05', name: 'Май' },
  { value: '06', name: 'Июнь' },
  { value: '07', name: 'Июль' },
  { value: '08', name: 'Август' },
  { value: '09', name: 'Сентябрь' },
  { value: '10', name: 'Октябрь' },
  { value: '11', name: 'Ноябрь' },
  { value: '12', name: 'Декабрь' },
];

export default function BirthdaysManager({ onSuccess, onError }: BirthdaysManagerProps) {
  const [db, setDb] = useState<BirthdayDatabase>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Form states
  const [month, setMonth] = useState('07');
  const [day, setDay] = useState('14');
  const [name, setName] = useState('');
  const [anime, setAnime] = useState('');

  // Fetch birthdays
  const fetchBirthdays = async () => {
    try {
      setIsLoading(true);
      const resp = await fetch('/api/birthdays');
      if (resp.ok) {
        const data = await resp.json();
        setDb(data);
      } else {
        onError('Не удалось загрузить базу данных именинников');
      }
    } catch (err) {
      onError('Ошибка чтения базы данных дней рождения');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBirthdays();
  }, []);

  // Save changes to backend
  const saveBirthdays = async (newDb: BirthdayDatabase) => {
    try {
      const resp = await fetch('/api/birthdays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDb),
      });
      if (resp.ok) {
        setDb(newDb);
        onSuccess('Календарь дней рождения успешно обновлен!');
      } else {
        onError('Не удалось сохранить изменения');
      }
    } catch {
      onError('Сетевая ошибка при сохранении дней рождения');
    }
  };

  // Add character
  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !anime.trim()) {
      onError('Поля Имя и Аниме не могут быть пустыми');
      return;
    }

    const dateKey = `${month}-${day.padStart(2, '0')}`;
    const newDb = { ...db };
    
    if (!newDb[dateKey]) {
      newDb[dateKey] = [];
    }

    // Check duplicate
    const exists = newDb[dateKey].some(
      (c) => c.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (exists) {
      onError('Этот персонаж уже добавлен на выбранную дату!');
      return;
    }

    newDb[dateKey] = [...newDb[dateKey], { name: name.trim(), anime: anime.trim() }];
    
    saveBirthdays(newDb);
    setName('');
    setAnime('');
  };

  // Delete character
  const handleDelete = (dateKey: string, charIndex: number) => {
    const newDb = { ...db };
    if (newDb[dateKey]) {
      newDb[dateKey] = newDb[dateKey].filter((_, idx) => idx !== charIndex);
      if (newDb[dateKey].length === 0) {
        delete newDb[dateKey];
      }
      saveBirthdays(newDb);
    }
  };

  // Process search & grouping
  const flatList: Array<{ date: string; monthName: string; dayStr: string; char: Birthday; index: number }> = [];
  
  Object.entries(db).forEach(([dateKey, chars]) => {
    const [m, d] = dateKey.split('-');
    const mObj = MONTHS.find((item) => item.value === m);
    const mName = mObj ? mObj.name : 'Неизвестно';
    
    chars.forEach((char, index) => {
      if (
        searchTerm === '' ||
        char.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        char.anime.toLowerCase().includes(searchTerm.toLowerCase()) ||
        dateKey.includes(searchTerm)
      ) {
        flatList.push({
          date: dateKey,
          monthName: mName,
          dayStr: d,
          char,
          index,
        });
      }
    });
  });

  // Sort flatList by month value then day value
  flatList.sort((a, b) => {
    const [am, ad] = a.date.split('-').map(Number);
    const [bm, bd] = b.date.split('-').map(Number);
    if (am !== bm) return am - bm;
    return ad - bd;
  });

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs h-[500px] flex flex-col md:flex-row gap-6">
      {/* List Panel */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-800 font-display flex items-center gap-2">
            <Cake className="w-5 h-5 text-amber-500" />
            <span>Дни рождения персонажей</span>
          </h3>
          <div className="relative">
            <input
              type="text"
              placeholder="Поиск именинников..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-amber-500 focus:border-amber-500 focus:outline-hidden w-40 sm:w-56 font-medium transition-all"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto mt-4 space-y-2 pr-1">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-slate-400">
              <span className="animate-pulse text-xs font-mono">Загрузка данных календаря...</span>
            </div>
          ) : flatList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 py-10">
              <Calendar className="w-10 h-10 stroke-1 mb-2 text-slate-300" />
              <p className="text-sm font-medium">Ничего не найдено</p>
              <p className="text-xs text-slate-400">Добавьте нового именинника через форму справа</p>
            </div>
          ) : (
            flatList.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between bg-slate-50 border border-slate-100 p-3 rounded-xl hover:border-slate-200 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="bg-amber-500/10 text-amber-600 font-bold px-3 py-1.5 rounded-lg flex flex-col items-center justify-center min-w-[50px]">
                    <span className="text-[10px] leading-tight uppercase tracking-wider font-semibold">
                      {item.monthName.slice(0, 3)}
                    </span>
                    <span className="text-lg leading-none font-display mt-0.5">
                      {item.dayStr}
                    </span>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-700">{item.char.name}</h4>
                    <p className="text-xs text-slate-400 font-medium">{item.char.anime}</p>
                  </div>
                </div>
                
                <button
                  onClick={() => handleDelete(item.date, item.index)}
                  className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer transition-all"
                  title="Удалить именинника"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Add Form Panel */}
      <div className="w-full md:w-72 bg-slate-50 border border-slate-100 rounded-xl p-4 flex flex-col justify-between">
        <div>
          <h4 className="text-sm font-bold text-slate-800 font-display flex items-center gap-2 mb-3">
            <Plus className="w-4 h-4 text-emerald-500" />
            <span>Новый именинник</span>
          </h4>
          
          <form onSubmit={handleAdd} className="space-y-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                Дата рождения
              </label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-amber-500 focus:outline-hidden"
                >
                  {MONTHS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.name}
                    </option>
                  ))}
                </select>
                
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                  placeholder="День"
                  required
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-amber-500 focus:outline-hidden"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                Имя персонажа
              </label>
              <input
                type="text"
                placeholder="Например, Мидория Изуку"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-amber-500 focus:outline-hidden font-medium"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                Аниме источник
              </label>
              <input
                type="text"
                placeholder="Например, My Hero Academia"
                value={anime}
                onChange={(e) => setAnime(e.target.value)}
                required
                className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-amber-500 focus:outline-hidden font-medium"
              />
            </div>

            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white font-medium py-2 px-3 rounded-lg text-xs cursor-pointer transition-all shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Добавить персонажа</span>
            </button>
          </form>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-200/50 flex gap-2 items-start text-[10px] text-slate-400 font-medium leading-relaxed">
          <AlertCircle className="w-3.5 h-3.5 text-slate-300 shrink-0 mt-0.5" />
          <span>
            Поздравления с днем рождения проверяются автоматически каждый цикл и отправляются в аниме-канал.
          </span>
        </div>
      </div>
    </div>
  );
}
