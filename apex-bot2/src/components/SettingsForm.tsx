import React, { useState, useEffect } from 'react';
import { BotConfig } from '../types.js';
import { Settings, Eye, EyeOff, Save, Key, Sliders, ShieldAlert } from 'lucide-react';

interface SettingsFormProps {
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function SettingsForm({ onSuccess, onError }: SettingsFormProps) {
  const [config, setConfig] = useState<BotConfig>({
    tgBotToken: '',
    llmApiKey: '',
    llmModel: 'gemma-4-31b',
    llmBaseUrl: 'https://api.cerebras.ai/v1',
    checkInterval: 600,
    maxAgeHours: 48,
    geminiApiKey: '',
    avitoClientId: '',
    avitoClientSecret: '',
    avitoNotificationChatId: '',
    discordWebhookUrl: ''
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Visibility toggles
  const [showTgToken, setShowTgToken] = useState(false);
  const [showLlmKey, setShowLlmKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showAvitoSecret, setShowAvitoSecret] = useState(false);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        setConfig(data);
        setIsLoading(false);
      })
      .catch(() => {
        onError('Не удалось загрузить настройки конфигурации бота');
        setIsLoading(false);
      });
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      const resp = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (resp.ok) {
        onSuccess('Настройки и ключи доступа успешно обновлены!');
      } else {
        onError('Не удалось обновить конфигурацию');
      }
    } catch {
      onError('Сетевая ошибка при сохранении настроек');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs min-h-[550px] flex items-center justify-center">
        <span className="animate-pulse text-xs font-mono text-slate-400">Загрузка настроек...</span>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs min-h-[550px] flex flex-col">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
        <h3 className="text-base font-bold text-slate-800 font-display flex items-center gap-2">
          <Settings className="w-5 h-5 text-slate-600" />
          <span>Настройки системы и секреты</span>
        </h3>
      </div>

      <form onSubmit={handleSave} className="flex-1 overflow-y-auto space-y-4 pr-1">
        {/* Telegram Credentials */}
        <div className="bg-slate-50/50 border border-slate-100 p-4 rounded-xl space-y-3">
          <h4 className="text-xs font-bold text-slate-700 tracking-wider flex items-center gap-2 uppercase mb-1">
            <Key className="w-3.5 h-3.5 text-indigo-500" />
            <span>Доставка в Telegram</span>
          </h4>
          
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              TG_BOT_TOKEN
            </label>
            <div className="relative">
              <input
                type={showTgToken ? 'text' : 'password'}
                placeholder={config.tgBotToken ? "••••••••••••••••••••" : "Вставьте токен вашего Telegram-бота"}
                value={config.tgBotToken}
                onChange={(e) => setConfig({ ...config, tgBotToken: e.target.value })}
                className="w-full pl-3 pr-10 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-500 focus:outline-hidden"
              />
              <button
                type="button"
                onClick={() => setShowTgToken(!showTgToken)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showTgToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
              Токен бота, полученный от @BotFather. Этот бот должен быть добавлен в качестве администратора в каналы <code className="bg-slate-100 px-1 rounded">@animuds</code> и <code className="bg-slate-100 px-1 rounded">@gamemuds</code>.
            </p>
          </div>
        </div>

        {/* Translation Providers */}
        <div className="bg-slate-50/50 border border-slate-100 p-4 rounded-xl space-y-4">
          <h4 className="text-xs font-bold text-slate-700 tracking-wider flex items-center gap-2 uppercase mb-1">
            <Key className="w-3.5 h-3.5 text-sky-500" />
            <span>Провайдеры перевода AI</span>
          </h4>

          {/* Option A: Gemini */}
          <div className="border-b border-slate-200/50 pb-3">
            <span className="inline-block text-[10px] font-bold bg-sky-50 text-sky-600 border border-sky-100 px-2 py-0.5 rounded-full mb-2 uppercase font-mono">
              Вариант 1: Google Gemini API (Рекомендуется)
            </span>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                GEMINI_API_KEY
              </label>
              <div className="relative">
                <input
                  type={showGeminiKey ? 'text' : 'password'}
                  placeholder={config.geminiApiKey ? "••••••••••••••••••••" : "Вставьте ваш Google AI Studio Gemini API Key"}
                  value={config.geminiApiKey}
                  onChange={(e) => setConfig({ ...config, geminiApiKey: e.target.value })}
                  className="w-full pl-3 pr-10 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-sky-500 focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={() => setShowGeminiKey(!showGeminiKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                Если настроен, бот использует модель <code className="bg-slate-100 px-1 rounded">gemini-2.5-flash</code> для создания качественных структурированных постов на русском.
              </p>
            </div>
          </div>

          {/* Option B: Cerebras / OpenAI compatible */}
          <div>
            <span className="inline-block text-[10px] font-bold bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-0.5 rounded-full mb-2 uppercase font-mono">
              Вариант 2: Cerebras / Сторонний API (OpenAI-совместимый)
            </span>
            
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  LLM_API_KEY
                </label>
                <div className="relative">
                  <input
                    type={showLlmKey ? 'text' : 'password'}
                    placeholder={config.llmApiKey ? "••••••••••••••••••••" : "Вставьте API ключ провайдера"}
                    value={config.llmApiKey}
                    onChange={(e) => setConfig({ ...config, llmApiKey: e.target.value })}
                    className="w-full pl-3 pr-10 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-500 focus:outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLlmKey(!showLlmKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showLlmKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">
                    LLM_MODEL
                  </label>
                  <input
                    type="text"
                    value={config.llmModel}
                    onChange={(e) => setConfig({ ...config, llmModel: e.target.value })}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-500 focus:outline-hidden"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">
                    LLM_BASE_URL
                  </label>
                  <input
                    type="text"
                    value={config.llmBaseUrl}
                    onChange={(e) => setConfig({ ...config, llmBaseUrl: e.target.value })}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-500 focus:outline-hidden"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sync Settings */}
        <div className="bg-slate-50/50 border border-slate-100 p-4 rounded-xl space-y-3">
          <h4 className="text-xs font-bold text-slate-700 tracking-wider flex items-center gap-2 uppercase mb-1">
            <Sliders className="w-3.5 h-3.5 text-emerald-500" />
            <span>Интервалы опроса лент RSS</span>
          </h4>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                ИНТЕРВАЛ ОПРОСА (секунды)
              </label>
              <input
                type="number"
                min="60"
                value={config.checkInterval}
                onChange={(e) => setConfig({ ...config, checkInterval: parseInt(e.target.value, 10) })}
                className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-500 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                МАКС. ВОЗРАСТ СТАТЕЙ (часы)
              </label>
              <input
                type="number"
                min="1"
                value={config.maxAgeHours}
                onChange={(e) => setConfig({ ...config, maxAgeHours: parseInt(e.target.value, 10) })}
                className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-500 focus:outline-hidden"
              />
            </div>
          </div>
        </div>

        {/* Avito Messenger checking integration */}
        <div className="bg-slate-50/50 border border-slate-100 p-4 rounded-xl space-y-3">
          <h4 className="text-xs font-bold text-slate-700 tracking-wider flex items-center gap-2 uppercase mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
            <span>Интеграция с Авито (Новые сообщения)</span>
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                AVITO_CLIENT_ID
              </label>
              <input
                type="text"
                placeholder="Вставьте Client ID из кабинета разработчика Авито"
                value={config.avitoClientId}
                onChange={(e) => setConfig({ ...config, avitoClientId: e.target.value })}
                className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-500 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                AVITO_CLIENT_SECRET
              </label>
              <div className="relative">
                <input
                  type={showAvitoSecret ? 'text' : 'password'}
                  placeholder={config.avitoClientSecret ? "••••••••••••••••••••" : "Вставьте Client Secret из кабинета разработчика"}
                  value={config.avitoClientSecret}
                  onChange={(e) => setConfig({ ...config, avitoClientSecret: e.target.value })}
                  className="w-full pl-3 pr-10 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-500 focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={() => setShowAvitoSecret(!showAvitoSecret)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showAvitoSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              AVITO_NOTIFICATION_CHAT_ID (ID чата Telegram для уведомлений)
            </label>
            <input
              type="text"
              placeholder="Например: -100123456789 или ваш @username"
              value={config.avitoNotificationChatId}
              onChange={(e) => setConfig({ ...config, avitoNotificationChatId: e.target.value })}
              className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-500 focus:outline-hidden"
            />
            <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
              ID чата Telegram (личного или канала), куда бот будет присылать уведомления о новых сообщениях покупателей на Авито. Если пусто, используется основной канал.
            </p>
          </div>
        </div>

        {/* Additional Automations (Discord) */}
        <div className="bg-slate-50/50 border border-slate-100 p-4 rounded-xl space-y-3">
          <h4 className="text-xs font-bold text-slate-700 tracking-wider flex items-center gap-2 uppercase mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block"></span>
            <span>Автоматизация Discord Webhook</span>
          </h4>
          
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              DISCORD_WEBHOOK_URL
            </label>
            <input
              type="text"
              placeholder="Вставьте URL вебхука вашего Discord-канала"
              value={config.discordWebhookUrl}
              onChange={(e) => setConfig({ ...config, discordWebhookUrl: e.target.value })}
              className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
            />
            <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
              Если настроено, все новые посты (новости, дни рождения, уведомления Авито) будут автоматически дублироваться в указанный Discord-канал в реальном времени!
            </p>
          </div>
        </div>

        {/* Actions bar */}
        <div className="pt-2 flex justify-between items-center gap-2">
          <div className="flex items-center gap-1.5 text-[10px] text-amber-500 font-bold">
            <ShieldAlert className="w-4 h-4" />
            <span>Сохранение запишет ключи напрямую в .env на сервере.</span>
          </div>
          
          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/15 font-display"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'Сохранение...' : 'Применить'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
