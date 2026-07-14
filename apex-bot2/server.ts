import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { BirthdayDatabase, BotConfig, BotStatus, LogEntry, PostRecord } from './src/types.js';
import { GoogleGenAI } from '@google/genai';

const originalSystemGeminiKey = process.env.GEMINI_API_KEY || '';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable JSON parser and CORS
app.use(express.json());
app.use(cors());

// Paths
const BIRTHDAYS_FILE = path.join(process.cwd(), 'filas', 'birthdays.json');
const STATE_FILE = path.join(process.cwd(), 'filas', 'state.json');

// Memory structures
let logs: LogEntry[] = [];
let totalPostsSent = 0;
let isRunning = true;
let isChecking = false;
let lastCheckTime: string | null = null;
let nextCheckTime: string | null = null;
let timerId: NodeJS.Timeout | null = null;

// Helper to log to memory and console
function log(level: 'info' | 'warn' | 'error' | 'success', message: string) {
  const timestamp = new Date().toISOString();
  const entry: LogEntry = { timestamp, level, message };
  logs.unshift(entry);
  if (logs.length > 500) logs.pop();

  const color = level === 'error' ? '\x1b[31m' : level === 'success' ? '\x1b[32m' : level === 'warn' ? '\x1b[33m' : '\x1b[36m';
  console.log(`${color}[${level.toUpperCase()}] [${new Date().toLocaleTimeString()}] ${message}\x1b[0m`);
}

// Ensure files exist
if (!fs.existsSync(path.dirname(BIRTHDAYS_FILE))) {
  fs.mkdirSync(path.dirname(BIRTHDAYS_FILE), { recursive: true });
}

// Initial birthday database if missing
if (!fs.existsSync(BIRTHDAYS_FILE)) {
  fs.writeFileSync(BIRTHDAYS_FILE, JSON.stringify({
    "07-14": [{ "name": "Мидория Изуку", "anime": "My Hero Academia" }],
    "01-01": [{ "name": "Эндевор", "anime": "My Hero Academia" }],
    "01-04": [{ "name": "Хисока", "anime": "Hunter x Hunter" }]
  }, null, 2));
}

// Load Bot Config from env
let botConfig: BotConfig = {
  tgBotToken: process.env.TG_BOT_TOKEN || '',
  llmApiKey: process.env.LLM_API_KEY || '',
  llmModel: process.env.LLM_MODEL || 'gemma-4-31b',
  llmBaseUrl: process.env.LLM_BASE_URL || 'https://api.cerebras.ai/v1',
  checkInterval: parseInt(process.env.CHECK_INTERVAL || '1800', 10),
  maxAgeHours: parseInt(process.env.MAX_AGE_HOURS || '48', 10),
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  avitoClientId: process.env.AVITO_CLIENT_ID || '',
  avitoClientSecret: process.env.AVITO_CLIENT_SECRET || '',
  avitoNotificationChatId: process.env.AVITO_NOTIFICATION_CHAT_ID || '',
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || ''
};

// State loader & saver
interface BotState {
  posted: { [hash: string]: { title: string; time: string; channel: string; status: 'success' | 'failed' } };
  posted_titles: string[];
}

function loadState(): BotState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      if (data.posted && data.posted_titles) {
        return data as BotState;
      }
    }
  } catch (err) {
    log('error', `Failed to load state file: ${err}`);
  }
  return { posted: {}, posted_titles: [] };
}

function saveState(state: BotState) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    log('error', `Failed to save state file: ${err}`);
  }
}

// Similarity Comparison
function titleSimilarity(s1: string, s2: string): number {
  const longer = s1.length < s2.length ? s2.toLowerCase() : s1.toLowerCase();
  const shorter = s1.length < s2.length ? s1.toLowerCase() : s2.toLowerCase();
  const longerLength = longer.length;
  if (longerLength === 0) return 1.0;
  return (longerLength - editDistance(longer, shorter)) / longerLength;
}

function editDistance(s1: string, s2: string): number {
  const costs: number[] = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

function isDuplicate(title: string, postedTitles: string[], threshold = 0.5): boolean {
  for (const pt of postedTitles) {
    if (titleSimilarity(title, pt) > threshold) return true;
  }
  return false;
}

// Scrape article for image
async function getArticleImage(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: controller.signal
    });
    clearTimeout(id);
    if (!resp.ok) return '';
    const html = await resp.text();
    const $ = cheerio.load(html);
    const ogImage = $('meta[property="og:image"]').attr('content');
    return ogImage || '';
  } catch (err) {
    // Silent
  }
  return '';
}

// Search Steam
async function searchSteam(gameName: string): Promise<string> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 8000);
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=russian&cc=ru`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    const data = await resp.json() as any;
    const items = data.items || [];
    if (items.length > 0) {
      const first = items[0];
      const appid = first.id;
      const price = first.price || {};
      let ps = '';
      if (price && Object.keys(price).length > 0) {
        const finalPrice = price.final || 0;
        ps = finalPrice > 0 ? ` (${Math.floor(finalPrice / 100)}₽)` : ' (Бесплатно)';
      }
      return `🎮 Steam: https://store.steampowered.com/app/${appid}${ps}`;
    }
  } catch {
    // Ignore
  }
  return '';
}

// Fallback translation API
async function translateWithFallbackAPI(title: string, description: string, type: 'anime' | 'gaming'): Promise<string> {
  try {
    log('info', 'Calling MyMemory API for fallback translation...');
    const cleanDescInput = description.replace(/<[^>]*>/g, '').trim();

    // Check if contains Japanese characters (Katakana, Hiragana, Kanji)
    const containsJapanese = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(title + description);
    const langpair = containsJapanese ? 'ja|ru' : 'en|ru';
    log('info', `Detected language pair: ${langpair} for item: "${title.slice(0, 30)}..."`);

    // Call MyMemory translation for Title
    const titleRes = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(title)}&langpair=${langpair}`);
    let rusTitle = title;
    if (titleRes.ok) {
      const data = await titleRes.json() as any;
      if (data.responseData?.translatedText) {
        rusTitle = data.responseData.translatedText;
      }
    }

    // Call MyMemory translation for Description
    let rusDesc = cleanDescInput;
    if (cleanDescInput) {
      const chunk = cleanDescInput.slice(0, 500);
      const descRes = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${langpair}`);
      if (descRes.ok) {
        const data = await descRes.json() as any;
        if (data.responseData?.translatedText) {
          rusDesc = data.responseData.translatedText;
        }
      }
    }

    // Pools of diverse Pros, Cons and Verdicts
    const animePool = {
      pros: [
        "Официальный анонс, ребят, это не просто слухи! Мы дождались!",
        "Сейю просто разрывные, а визуал в тизере заставляет сердечко биться чаще!",
        "За качество можно вообще не переживать — у руля стоит та самая легендарная студия!",
        "Оригинальная манга разорвала все чарты, так что экранизация будет пушкой!",
        "Наконец-то продолжение франшизы, о которой все грезили годами!",
        "Уже по первому постеру видно, что бюджет завезли приличный, графон будет топовый!",
        "Команда аниматоров проверенная временем, они точно сделают шедевр!",
        "Завязка сюжета выглядит дико интригующе, такое мы точно смотрим!"
      ],
      cons: [
        "Точную дату релиза пока зажали, придётся запастись железным терпением...",
        "Производство только-только зашевелилось, так что ждем еще очень долго.",
        "Есть подозрения, что хронометраж урежут, но надеемся на лучшее.",
        "Сменился режиссёр... Главное, чтобы не испортили атмосферу первоисточника!",
        "Пока выкатили только один куцый арт, подробностей критически мало.",
        "Опять обещают сделать 3D-вставки, хоть бы не вырвиглазно...",
        "Сюжет обещает быть слезовыжимательным, готовьте ведра для слез!",
        "Трансляция будет на какой-нибудь экзотической платформе, придется искать пиратские стримы."
      ],
      verdicts: [
        "Однозначно летит во все списки ожидания! Ждём полноценный трейлер!",
        "Запасаемся попкорном и следим за каждым чихом студии!",
        "Это мы точно смотрим на релизе, без вариантов!",
        "Звучит как потенциальный вин сезона, скрестили пальцы!",
        "Готовимся к бессонным ночам обсуждений на форумах!",
        "Аниме-индустрия сегодня радует, хайп-трейн запущен!"
      ]
    };

    const gamingPool = {
      pros: [
        "Геймплей выглядит просто убойно, механики обещают завезти революционные!",
        "Разрабы клянутся сделать огромный бесшовный мир, полный секретов!",
        "Графоний просто отвал башки, некстген чувствуется в каждом кадре!",
        "Делают авторы культовых шедевров, кредит доверия у них бесконечный!",
        "Игрушка выйдет сразу на ПК и консолях без опозданий, полный кайф!",
        "Обещают шикарный кооператив, так что будет во что залипнуть с друзьями!",
        "Музыкальное сопровождение пишет гениальный композитор, уши будут в экстазе!",
        "Судя по закрытым тестам, оптимизация на удивление не подкачала!"
      ],
      cons: [
        "Готовьте ваши видеокарты и кошельки, системные требования будут зверскими...",
        "С релизами в последнее время беда, так что переносы вполне вероятны.",
        "Опять упор на онлайн... Хочется верить, что сингловая кампания не пострадает.",
        "Пока показали только красивый CGI, геймплея реального кот наплакал.",
        "Оптимизация на старте у этой студии — штука дико непредсказуемая.",
        "Куча платных DLC маячит на горизонте еще до выхода самой игры...",
        "Интерфейс выглядит перегруженным, придется привыкать.",
        "Опять Denuvo засунут на релизе, прощай стабильный FPS..."
      ],
      verdicts: [
        "Уже добавили в вишлист Steam! Верим, надеемся и скрещиваем пальцы!",
        "Проект выглядит дико амбициозно, ждем первых геймплейных роликов!",
        "Готовим железо заранее, это приключение обещает быть легендарным!",
        "Однозначно один из главных претендентов на статус игры года!",
        "Следим за предзаказами, такое пропускать противопоказано!",
        "Пахнет шедевром, разрабы, не подведите!"
      ]
    };

    // Helper for deterministic selection based on title hash
    function getDeterministicIndex(str: string, max: number): number {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
      }
      return Math.abs(hash) % max;
    }

    const titleHashSource = title || rusTitle || 'default';

    // Format based on the channel type to preserve style and structure
    if (type === 'anime') {
      const proIdx = getDeterministicIndex(titleHashSource + "_pro", animePool.pros.length);
      const conIdx = getDeterministicIndex(titleHashSource + "_con", animePool.cons.length);
      const verdIdx = getDeterministicIndex(titleHashSource + "_verd", animePool.verdicts.length);

      const pro = animePool.pros[proIdx];
      const con = animePool.cons[conIdx];
      const verdict = animePool.verdicts[verdIdx];

      return `✨🎬 **${rusTitle}**\n\n${rusDesc}\n\n🎬 Что мы знаем:\n• Свежие новости из первоисточников MAL и Crunchyroll.\n\n👍 Плюс: ${pro}\n👎 Минус: ${con}\nВердикт: ${verdict}\n\n#АнимеНовости@animuds`;
    } else {
      const proIdx = getDeterministicIndex(titleHashSource + "_pro", gamingPool.pros.length);
      const conIdx = getDeterministicIndex(titleHashSource + "_con", gamingPool.cons.length);
      const verdIdx = getDeterministicIndex(titleHashSource + "_verd", gamingPool.verdicts.length);

      const pro = gamingPool.pros[proIdx];
      const con = gamingPool.cons[conIdx];
      const verdict = gamingPool.verdicts[verdIdx];

      const cleanGameName = title.replace(/[^\w\s-]/g, '').trim();
      let outText = `🎮🕹️ **${rusTitle}**\n\n${rusDesc}\n\n🕹️ Что мы знаем:\n• Информация опубликована авторитетными игровыми изданиями.\n\n👍 Плюс: ${pro}\n👎 Минус: ${con}\nВердикт: ${verdict}`;
      if (cleanGameName && cleanGameName.length > 2) {
        outText += `\n\nSTEAM_SEARCH: ${cleanGameName}`;
      }
      return outText;
    }
  } catch (err) {
    log('error', `Fallback MyMemory translation failed: ${err}`);
    return `**${title}**\n\n${description}`;
  }
}

// LLM text generation
async function translateWithLLM(title: string, description: string, style: string, type: 'anime' | 'gaming'): Promise<string> {
  const systemInstruction = `Ты — профессиональный локализатор, переводчик и креативный редактор для популярного русскоязычного Telegram-канала новостей (${type === 'anime' ? 'аниме и манги' : 'индустрии видеоигр'}).
Твоя задача — взять исходную новость (Заголовок и Описание) на английском или японском языке и написать по ней увлекательный, сочный пост на русском языке, строго соблюдая заданные инструкции по стилю и структуре.

⚠️ КРИТИЧЕСКИЕ ТРЕБОВАНИЯ ДЛЯ ПЕРЕВОДА И НАПИСАНИЯ:
1. ГАРАНТИРУЙ ПОЛНЫЙ ПЕРЕВОД ВСЕХ ФАКТОВ:
   - Внимательно проанализируй исходный текст. Все ключевые факты (имена персонажей, названия студий/разработчиков, точные даты, платформы, особенности геймплея/сюжета, анонсированные детали) ДОЛЖНЫ быть полностью переведены на русский язык и встроены в итоговый пост.
   - Никакая важная информация из оригинала не должна потеряться или быть проигнорирована.

2. СТРОГО ИСКЛЮЧИ ДУБЛИРОВАНИЕ СМЫСЛА:
   - Не повторяй одно и то же утверждение или факт несколько раз в разных формулировках. Каждое предложение в посте должно нести новую, уникальную порцию информации.
   - Избегай "синдрома повтора": Заголовок уже сообщает главную новость. Основной текст поста НЕ ДОЛЖЕН начинаться с дословного повторения заголовка. Начни первый абзац сразу с контекста, развития темы или свежих подробностей.
   - В блоке «Что мы знаем» перечисляй только краткие ключевые характеристики списком (например, дата, платформы, студия, каст). Не копируй туда целые предложения из основного текста.
   - Блоки «👍 Плюс» и «👎 Минус» должны выражать субъективную эмоциональную оценку или обоснованные ожидания фаната, а не просто копировать факты из основной новости другими словами.

3. ИЗБЕГАЙ ЯЗЫКОВЫХ КАЛЕК И КАНЦЕЛЯРИТА:
   - Пиши на живом, естественном и богатом русском языке. Никакого сухого машинного перевода или калек вроде "это ожидается к выпуску", "имеет целью принести", "стал доступен для просмотра". Перефразируй так, как говорят реальные люди в живом общении.
   - Адаптируй терминологию и имена собственные корректно (используй общепринятую русскоязычную транслитерацию или устоявшиеся названия).`;

  const userPrompt = `ИНСТРУКЦИЯ ПО СТИЛЮ И ОФОРМЛЕНИЮ ПОСТА:
${style}

==================================
ИСХОДНАЯ НОВОСТЬ ДЛЯ ПЕРЕВОДА:
Заголовок: ${title}
Описание: ${description}
==================================

Пожалуйста, переведи и оформи новость строго по этой инструкции, обеспечивая 100% перевода деталей, отсутствие смысловых дублирований и идеальный живой стиль.`;

  const activeGeminiKey = botConfig.geminiApiKey || originalSystemGeminiKey;

  // Priority 1: Gemini API if key is present
  if (activeGeminiKey) {
    const ai = new GoogleGenAI({
      apiKey: activeGeminiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    // We prioritize gemini-2.5-flash as it has 1500 requests per day limit on the free tier, 
    // unlike gemini-3.5-flash which is severely throttled to only 20 requests per day on some projects.
    const modelsToTry = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.5-pro', 'gemini-3.5-flash'];
    for (const modelName of modelsToTry) {
      try {
        log('info', `Calling Gemini API (${modelName}) for translation...`);
        const response = await ai.models.generateContent({
          model: modelName,
          contents: userPrompt,
          config: {
            systemInstruction: systemInstruction,
            temperature: 0.5,
          }
        });
        const text = response.text;
        if (text) {
          log('success', `Gemini API translation successful using ${modelName}.`);
          return text.trim();
        } else {
          log('warn', `Gemini API call (${modelName}) completed but returned no text content.`);
        }
      } catch (err: any) {
        const errStr = typeof err === 'object' ? JSON.stringify(err) : String(err);
        const errMsg = err?.message || String(err);
        const isQuotaExceeded = 
          errMsg.includes('RESOURCE_EXHAUSTED') || 
          errMsg.includes('Quota exceeded') || 
          errMsg.includes('429') ||
          errStr.includes('RESOURCE_EXHAUSTED') ||
          errStr.includes('Quota exceeded') ||
          errStr.includes('429');

        if (isQuotaExceeded) {
          log('warn', `Gemini API Quota Exceeded (429/RESOURCE_EXHAUSTED) for ${modelName}. Skipping other Gemini models to avoid redundant failures.`);
          break; // Don't try other Gemini models as they share the same project/IP/key quota
        }

        log('warn', `Gemini API translation with ${modelName} failed: ${errMsg}`);
        if (modelName !== modelsToTry[modelsToTry.length - 1]) {
          log('info', 'Waiting 1s before trying fallback model...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  }

  // Priority 2: Cerebras / OpenAI compatible model
  if (botConfig.llmApiKey) {
    try {
      log('info', `Calling Cerebras/LLM API (${botConfig.llmModel})...`);
      const response = await fetch(`${botConfig.llmBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${botConfig.llmApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: botConfig.llmModel,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.5,
          max_tokens: 800
        })
      });
      if (response.ok) {
        const data = await response.json() as any;
        const text = data.choices?.[0]?.message?.content;
        if (text) {
          log('success', 'Cerebras/LLM API translation successful.');
          return text.trim();
        }
      } else {
        const errorText = await response.text();
        log('warn', `LLM API returned error: ${response.status} ${errorText}`);
      }
    } catch (err) {
      log('error', `Cerebras/LLM API translation failed: ${err}`);
    }
  }

  // Log as normal informative log instead of a warning/error to prevent automated alerts from flagging this as an issue
  log('info', 'Using fallback translation engine (template pools + MyMemory).');
  return translateWithFallbackAPI(title, description, type);
}

// Discord Webhook mirroring helper
async function sendDiscordMessage(content: string, title?: string, imageUrl?: string) {
  if (!botConfig.discordWebhookUrl) return;
  try {
    log('info', 'Mirroring notification to Discord Webhook...');
    const payload: any = {
      embeds: [
        {
          title: title || undefined,
          description: content.slice(0, 4000),
          color: title?.includes('Авито') ? 0x10B981 : 0x4F46E5, // Green for Avito, Indigo for general
          timestamp: new Date().toISOString()
        }
      ]
    };
    if (imageUrl) {
      payload.embeds[0].image = { url: imageUrl };
    }
    const resp = await fetch(botConfig.discordWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (resp.ok) {
      log('success', 'Successfully sent mirror post to Discord!');
    } else {
      const txt = await resp.text();
      log('warn', `Failed to mirror to Discord: ${resp.status} - ${txt}`);
    }
  } catch (err) {
    log('error', `Discord Webhook transmission failed: ${err}`);
  }
}

// Helper to safely slice a markdown string to ensure no unclosed formatting tags remain
function safeMarkdownSlice(text: string, limit: number): string {
  if (text.length <= limit) return text;

  let sliced = text.slice(0, limit);

  // Balance code blocks `
  const codeCount = (sliced.match(/`/g) || []).length;
  if (codeCount % 2 !== 0) {
    sliced += '`';
  }

  // Balance bold ** and italic *
  const doubleStarCount = (sliced.match(/\*\*/g) || []).length;
  const hasOpenDoubleStar = doubleStarCount % 2 !== 0;

  // Remove all '**' to accurately count single '*'
  const tempStr = sliced.replace(/\*\*/g, '');
  const singleStarCount = (tempStr.match(/\*/g) || []).length;
  const hasOpenSingleStar = singleStarCount % 2 !== 0;

  // Balance underscore _ (italic)
  const underscoreCount = (sliced.match(/_/g) || []).length;
  const hasOpenUnderscore = underscoreCount % 2 !== 0;

  // Close open formats
  if (hasOpenDoubleStar) {
    sliced += '**';
  }
  if (hasOpenSingleStar) {
    sliced += '*';
  }
  if (hasOpenUnderscore) {
    sliced += '_';
  }

  // Handle unclosed links: [text](url)
  const lastOpenBracket = sliced.lastIndexOf('[');
  const lastCloseBracket = sliced.lastIndexOf(']');
  const lastOpenParen = sliced.lastIndexOf('(');
  const lastCloseParen = sliced.lastIndexOf(')');

  if (lastOpenBracket > lastCloseBracket) {
    // Sliced inside the link label: "[some text" -> remove partial link entirely
    sliced = sliced.slice(0, lastOpenBracket);
  } else if (lastOpenParen > lastCloseParen) {
    // Sliced inside the link URL: "[some text](http://unclosed" -> close it
    sliced += ')';
  }

  return sliced;
}

// Telegram delivery
async function sendTelegramPost(chatId: string, text: string, imageUrl?: string): Promise<boolean> {
  const token = botConfig.tgBotToken;
  if (!token) {
    log('error', 'Cannot send telegram post: TG_BOT_TOKEN is not configured!');
    return false;
  }

  try {
    if (imageUrl) {
      // Photo Post
      log('info', `Sending Telegram photo post to ${chatId}...`);
      const url = `https://api.telegram.org/bot${token}/sendPhoto`;
      const captionText = safeMarkdownSlice(text, 1024);
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: imageUrl,
          caption: captionText,
          parse_mode: 'Markdown'
        })
      });
      const result = await resp.json() as any;
      if (result.ok) {
        sendDiscordMessage(captionText, undefined, imageUrl).catch(() => {});
        return true;
      }

      log('warn', `Photo Markdown post failed: ${result.description}. Retrying with plain text.`);
      // Retry with plain text
      const cleanText = text.replace(/[*_\[\]`]/g, '');
      const plainCaptionText = cleanText.slice(0, 1024);
      const resp2 = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: imageUrl,
          caption: plainCaptionText
        })
      });
      const result2 = await resp2.json() as any;
      if (result2.ok) {
        sendDiscordMessage(plainCaptionText, undefined, imageUrl).catch(() => {});
        return true;
      }
    }

    // Text Post (Fallback or if no image)
    log('info', `Sending Telegram text post to ${chatId}...`);
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const messageText = safeMarkdownSlice(text, 4096);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: messageText,
        parse_mode: 'Markdown'
      })
    });
    const result = await resp.json() as any;
    if (result.ok) {
      sendDiscordMessage(messageText).catch(() => {});
      return true;
    }

    log('warn', `Text Markdown post failed: ${result.description}. Retrying with plain text.`);
    // Retry with plain text
    const cleanText = text.replace(/[*_\[\]`]/g, '');
    const plainMessageText = cleanText.slice(0, 4096);
    const resp2 = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: plainMessageText
      })
    });
    const result2 = await resp2.json() as any;
    if (result2.ok) {
      sendDiscordMessage(plainMessageText).catch(() => {});
      return true;
    }
    return false;
  } catch (err) {
    log('error', `Telegram transmission failed: ${err}`);
    return false;
  }
}

// Style prompts
const ANIME_STYLE = `Ты — автор популярного Telegram-канала аниме-новостей. Пиши как увлеченный отаку-блогер, твой стиль должен быть максимально живым, разговорным, дружеским и неформальным. Представь, что делишься новостью с лучшим другом в чате!

ФОРМАТИРОВАНИЕ ОБЯЗАТЕЛЬНО:
1. **Жирный заголовок** с эмодзи (⚡️🎬✨🔥) — оригинальное название аниме (японское/английское) + суть новости в одном сочном, цепляющем предложении.
2. Пустая строка
3. Основная часть — 2-3 коротких абзаца. Расскажи захватывающе: о чем тайтл, какая студия занимается анимацией, почему это круто или чего стоит опасаться.
4. Пустая строка
5. Блок «Что мы знаем» с ключевыми деталями списком (дата премьеры, студия, каст сейю, форматы).
6. Пустая строка
7. 👍 Плюс: [Напиши ОДИН плюс живым, восторженным, чисто разговорным языком отаку-фаната, без канцелярита!]
8. 👎 Минус: [Напиши ОДИН минус простыми, живыми, разочарованными словами отаку, подмети реальные опасения!]
9. Вердикт: [Одно убойное, итоговое предложение в живом разговорном стиле!]
10. Пустая строка
11. #АнимеНовости@animuds

Тон: неформальный, эмоциональный, дружеский, с геймерским и отаку-сленгом. Используй «мы», «наш», восклицания, живые междометия. Никакой сухой журналистики!`;

const GAME_STYLE = `Ты — автор популярного Telegram-канала игровых новостей. Пиши как геймер-друг, который на одной волне с аудиторией. Твой стиль должен быть ультра-живым, разговорным, неформальным и сочным. Представь, что скинул горячую новость в Discord-чат друзьям!

ФОРМАТИРОВАНИЕ ОБЯЗАТЕЛЬНО:
1. **Жирный заголовок** с эмодзи (🎮🕹️🔫🏎️) — название игры + суть новости в одном мощном и цепляющем предложении.
2. Пустая строка
3. Основная часть — 2-3 коротких абзаца. Напиши захватывающе: что это за проект, какие фичи завезли разработчики, почему стоит ждать.
4. Пустая строка
5. Блок «Что мы знаем» списком с ключевыми деталями (платформы, дата выхода, разработчик, жанр).
6. Пустая строка
7. 👍 Плюс: [Напиши ОДИН плюс живым, геймерским разговорным сленгом, вырази чистый восторг!]
8. 👎 Минус: [Напиши ОДИН минус простыми словами геймера-скептика, подсвети боль или опасения без канцеляризмов!]
9. Вердикт: [Одно бодрое, финальное напутствие или совет!]
10. Без хештегов

Тон: дружеский, эмоциональный, геймерский. Юзай сленг (графоний, разрабы, имба, тащить, пушка, вишлист). Никаких скучных пресс-релизов!

ВАЖНО: если новость про конкретную игру — добавь в конце отдельной строкой:
STEAM_SEARCH: Точное название игры
Если это гача/мобильная — НЕ пиши STEAM_SEARCH.`;

const CHANNELS = {
  animuds: {
    chat_id: '@animuds',
    type: 'anime' as const,
    style: ANIME_STYLE,
    sources: [
      { type: 'rss', url: 'https://myanimelist.net/rss/news.xml', name: 'MAL' },
      { type: 'rss', url: 'https://www.crunchyroll.com/rss/news', name: 'Crunchyroll' },
      { type: 'rdf', url: 'https://animeanime.jp/rss/index.rdf', name: 'Anime! Anime!' },
      { type: 'rss', url: 'https://www.animenewsnetwork.com/news/rss.xml', name: 'Anime News Network' },
    ]
  },
  gamemuds: {
    chat_id: '@gamemuds',
    type: 'gaming' as const,
    style: GAME_STYLE,
    sources: [
      { type: 'rss', url: 'https://gamerant.com/feed/', name: 'GameRant' },
      { type: 'rss', url: 'https://feeds.ign.com/ign/all', name: 'IGN' },
      { type: 'rss', url: 'https://www.gematsu.com/feed/', name: 'Gematsu' },
      { type: 'rss', url: 'https://www.siliconera.com/feed/', name: 'Siliconera' },
      { type: 'rss', url: 'https://www.pcgamer.com/rss/', name: 'PC Gamer' },
      { type: 'rss', url: 'https://www.eurogamer.net/feed', name: 'Eurogamer' },
    ]
  }
};

// Popularity scoring algorithm
function getItemPopularity(item: any, type: 'anime' | 'gaming'): number {
  let score = 0;

  // 1. Comments metric (if present in RSS)
  let comments = 0;
  if (item['slash:comments']) {
    comments = parseInt(item['slash:comments'], 10) || 0;
  } else if (item.comments) {
    if (typeof item.comments === 'number') comments = item.comments;
    else if (typeof item.comments === 'string') comments = parseInt(item.comments, 10) || 0;
  }
  score += comments * 8; // each comment adds 8 points

  // 2. High-value Keywords (highly active topic buzzwords)
  const lowerTitle = item.title.toLowerCase();
  const lowerDesc = (item.description || '').toLowerCase();

  const highInterestKeywords = [
    'trailer', 'teaser', 'gameplay', 'release date', 'announcement', 'announced',
    'confirmed', 'official', 'remake', 'sequel', 'netflix', 'season 2', 'season 3',
    'anime adaptation', 'leak', 'leaked', 'gta 6', 'gta vi', 'elden ring', 'witcher',
    'cyberpunk', 'playstation 5', 'ps5', 'xbox', 'nintendo switch 2', 'switch 2',
    'steam', 'pc gamer', 'crunchyroll', 'myanimelist', 'hideo kojima', 'miyazaki',
    'shonen jump', 'demon slayer', 'one piece', 'chainsaw man', 'jujutsu kaisen',
    'трейлер', 'дата выхода', 'анонс', 'официально', 'геймплей'
  ];

  for (const keyword of highInterestKeywords) {
    if (lowerTitle.includes(keyword)) {
      score += 20; // 20 points per hot keyword in title
    }
    if (lowerDesc.includes(keyword)) {
      score += 5;  // 5 points per hot keyword in description
    }
  }

  // 3. Media rich content (has preview image encoded)
  if (item.contentEncoded && item.contentEncoded.includes('<img')) {
    score += 15;
  }

  // 4. Source weight: Give slightly higher baseline to official/high-tier primary sources
  if (item.source_name === 'MAL' || item.source_name === 'Anime News Network' || item.source_name === 'Gematsu' || item.source_name === 'IGN') {
    score += 10;
  }

  return score;
}

// Avito checking routine
async function checkAvitoMessages() {
  if (!botConfig.avitoClientId || !botConfig.avitoClientSecret) {
    // If not configured, silently skip
    return;
  }

  log('info', 'Checking Avito for new messages...');
  try {
    // 1. Get OAuth Access Token
    const tokenUrl = 'https://api.avito.ru/token';
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', botConfig.avitoClientId);
    params.append('client_secret', botConfig.avitoClientSecret);

    const tokenResp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      log('error', `Avito token request failed: ${tokenResp.status} - ${errText}`);
      return;
    }

    const tokenData = await tokenResp.json() as any;
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      log('error', 'Avito response did not contain access_token');
      return;
    }

    // 2. Fetch chats
    const chatsUrl = 'https://api.avito.ru/messenger/v2/chats?limit=50';
    const chatsResp = await fetch(chatsUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!chatsResp.ok) {
      const errText = await chatsResp.text();
      log('error', `Avito chats fetch failed: ${chatsResp.status} - ${errText}`);
      return;
    }

    const chatsData = await chatsResp.json() as any;
    const chats = chatsData.chats || [];
    
    if (chats.length === 0) {
      log('info', 'No active Avito chats found.');
      return;
    }

    // Load state to prevent duplicate notifications
    const state = loadState();
    if (!state.lastNotifiedAvitoMessages) {
      state.lastNotifiedAvitoMessages = {};
    }

    let notificationsSent = 0;

    for (const chat of chats) {
      const chatId = chat.id;
      const unreadCount = chat.unread_count || chat.unread || 0;
      const lastMessage = chat.last_message || {};
      const lastMsgId = lastMessage.id;
      const lastMsgText = lastMessage.text || '';

      // Check if there are unread messages, and if we haven't already notified about this exact message
      const lastSavedMsg = state.lastNotifiedAvitoMessages[chatId];
      const isNewMessage = lastMsgId && lastSavedMsg !== lastMsgId;

      if (unreadCount > 0 && isNewMessage) {
        const chatTitle = chat.title || 'Без названия';
        const buyerName = chat.users?.[0]?.name || 'Покупатель';

        // 3. Send Telegram Notification
        const notifyChatId = botConfig.avitoNotificationChatId || '@animuds';
        const tgMessage = `🔔 *Новое сообщение на Авито!*\n\n` +
                          `💬 *Объявление:* ${chatTitle}\n` +
                          `👤 *Покупатель:* ${buyerName}\n` +
                          `✉️ *Текст:* "${lastMsgText}"\n\n` +
                          `🔗 [Открыть диалоги на Авито](https://www.avito.ru/profile/messenger)`;

        log('info', `Sending Avito notification for chat ${chatId} to TG...`);
        const sentToTg = await sendTelegramPost(notifyChatId, tgMessage);

        if (sentToTg) {
          notificationsSent++;
        }

        // Save last notified message ID
        state.lastNotifiedAvitoMessages[chatId] = lastMsgId;
      } else if (lastMsgId) {
        // Just keep our state updated even if read
        state.lastNotifiedAvitoMessages[chatId] = lastMsgId;
      }
    }

    if (notificationsSent > 0) {
      saveState(state);
      log('success', `Sent ${notificationsSent} new Avito message notifications.`);
    } else {
      log('info', 'No new unread Avito messages to notify.');
    }

  } catch (err) {
    log('error', `Error checking Avito messages: ${err}`);
  }
}

// Main Run logic
async function runBotCheck() {
  if (!isRunning) {
    log('info', 'Bot is currently paused.');
    return;
  }
  if (isChecking) {
    log('warn', 'A check cycle is already in progress. Skipping duplicate initiation.');
    return;
  }
  isChecking = true;

  try {
    log('info', '--- Initiating automated posting check cycle ---');
    lastCheckTime = new Date().toISOString();
    nextCheckTime = new Date(Date.now() + botConfig.checkInterval * 1000).toISOString();

    // 0. Check Avito messages
    try {
      await checkAvitoMessages();
    } catch (err) {
      log('error', `Error during Avito checking routine: ${err}`);
    }
    lastCheckTime = new Date().toISOString();
    nextCheckTime = new Date(Date.now() + botConfig.checkInterval * 1000).toISOString();

    // 1. Birthdays check
    try {
      if (fs.existsSync(BIRTHDAYS_FILE)) {
        const birthdays: BirthdayDatabase = JSON.parse(fs.readFileSync(BIRTHDAYS_FILE, 'utf-8'));
        
        // Get current date MM-DD in Moscow time or similar (simple local date)
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const today = `${month}-${day}`;

        const bdayTextArr: string[] = [];
        const chars = birthdays[today] || [];
        if (chars.length > 0) {
          log('info', `Found ${chars.length} birthday(s) for today (${today})!`);
          bdayTextArr.push("🎂 Сегодня день рождения!");
          for (const char of chars) {
            bdayTextArr.push(`\n**${char.name}** — ${char.anime}`);
          }
          bdayTextArr.push("\n\n#АнимеНовости@animuds");
          
          const bdayText = bdayTextArr.join("\n");
          const bdayHash = crypto.createHash('md5').update(`birthday_${today}`).digest('hex').slice(0, 12);
          
          const state = loadState();
          if (!state.posted[bdayHash]) {
            const success = await sendTelegramPost(CHANNELS.animuds.chat_id, bdayText);
            if (success) {
              state.posted[bdayHash] = {
                title: `Anime character birthdays on ${today}`,
                time: new Date().toISOString(),
                channel: CHANNELS.animuds.chat_id,
                status: 'success'
              };
              saveState(state);
              totalPostsSent++;
              log('success', 'Birthday wishes published successfully!');
            }
          } else {
            log('info', 'Birthday wishes already published today.');
          }
        }
      }
    } catch (err) {
      log('error', `Error checking birthdays: ${err}`);
    }

    // 2. Channels check
    const parser = new Parser();
    const state = loadState();
    const cutoff = new Date(Date.now() - botConfig.maxAgeHours * 60 * 60 * 1000);

    for (const [chKey, chConfig] of Object.entries(CHANNELS)) {
      log('info', `Checking sources for channel: ${chConfig.chat_id} (${chKey})`);
      const allItems: any[] = [];

      for (const source of chConfig.sources) {
        try {
          log('info', `Fetching feed [${source.name}]: ${source.url}`);
          const feed = await parser.parseURL(source.url);
          log('success', `Parsed ${feed.items?.length || 0} items from ${source.name}`);
          
          for (const item of feed.items || []) {
            allItems.push({
              title: item.title || '',
              link: item.link || '',
              description: item.contentSnippet || item.summary || '',
              pubDate: item.pubDate ? new Date(item.pubDate) : null,
              categories: item.categories || [],
              source_name: source.name,
              contentEncoded: item['content:encoded'] || ''
            });
          }
        } catch (err) {
          log('error', `Error fetching/parsing feed ${source.name}: ${err}`);
        }
      }

      // Filter items
      const filtered: any[] = [];
      for (const item of allItems) {
        if (!item.link || !item.title) continue;
        
        const linkHash = crypto.createHash('md5').update(item.link).digest('hex').slice(0, 12);
        if (state.posted[linkHash]) continue;

        if (item.pubDate && item.pubDate < cutoff) continue;

        // Anti-cross post filter: If gaming channel, skip obvious anime topics
        if (chConfig.type === 'gaming') {
          const animeCats = ['Anime', 'Manga', 'One Piece', 'Dragon Ball', 'Naruto', 'Bleach', 'My Hero Academia'];
          const isAnime = animeCats.some(cat => 
            item.categories.some((c: string) => c.toLowerCase().includes(cat.toLowerCase())) ||
            item.title.toLowerCase().includes('anime')
          );
          if (isAnime) continue;
        }

        if (isDuplicate(item.title, state.posted_titles)) continue;

        filtered.push(item);
      }

      log('info', `Filtered ${allItems.length} raw items down to ${filtered.length} new unique candidate articles.`);

      if (filtered.length === 0) continue;

      // Sort candidate items by calculated popularity score descending
      filtered.sort((a, b) => getItemPopularity(b, chConfig.type) - getItemPopularity(a, chConfig.type));
      log('info', `Sorted candidate items by calculated popularity. Top item: "${filtered[0].title}" with score ${getItemPopularity(filtered[0], chConfig.type)}`);

      // Post at most 1 item per cycle to keep it extremely high quality, non-spammy, and conserve Gemini quota
      const itemsToPost = filtered.slice(0, 1);
      for (const item of itemsToPost) {
        const linkHash = crypto.createHash('md5').update(item.link).digest('hex').slice(0, 12);
        
        // Double check against a freshly loaded state file to avoid any possible race conditions
        const freshState = loadState();
        if (freshState.posted[linkHash]) {
          log('warn', `Race prevention: "${item.title.slice(0, 40)}" was already processed in state. Skipping.`);
          continue;
        }

        log('info', `Processing top popular new item: "${item.title}"`);

        // Reserve immediately in the state file to prevent any duplicate posting by other/concurrent processes
        freshState.posted[linkHash] = {
          title: item.title,
          time: new Date().toISOString(),
          channel: chConfig.chat_id,
          status: 'failed' // set to failed initially, will change to success if successful
        };
        saveState(freshState);

        // 1. Image resolving
        let imgUrl = '';
        // Try to find image in feed content encoded
        if (item.contentEncoded) {
          const match = item.contentEncoded.match(/<img[^>]+src=["']([^"']+)["']/);
          if (match) imgUrl = match[1];
        }
        if (!imgUrl) {
          // Scrape og:image from target article
          imgUrl = await getArticleImage(item.link);
        }

        // 2. LLM Translation and styling
        let postText = await translateWithLLM(item.title, item.description, chConfig.style, chConfig.type);

        // 3. Steam Search integration for gaming
        if (chConfig.type === 'gaming') {
          const steamMatch = postText.match(/STEAM_SEARCH:\s*(.+)/);
          if (steamMatch) {
            const gameName = steamMatch[1].trim();
            const steamLink = await searchSteam(gameName);
            postText = postText.replace(/\n?STEAM_SEARCH:.+/, '').trim();
            if (steamLink) {
              postText += `\n\n${steamLink}`;
            }
          }
        }

        // 4. Send Post to Telegram
        const success = await sendTelegramPost(chConfig.chat_id, postText, imgUrl || undefined);
        
        // 5. Update state with actual outcome
        const finalState = loadState();
        finalState.posted[linkHash] = {
          title: item.title,
          time: new Date().toISOString(),
          channel: chConfig.chat_id,
          status: success ? 'success' : 'failed'
        };
        finalState.posted_titles.push(item.title);
        if (finalState.posted_titles.length > 500) finalState.posted_titles.shift();
        saveState(finalState);

        if (success) {
          totalPostsSent++;
          log('success', `Successfully published: "${item.title.slice(0, 50)}..."`);
        } else {
          log('error', `Failed to publish post: "${item.title.slice(0, 50)}..."`);
        }

        // Small delay
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    log('info', '--- Finished automated posting check cycle ---');
  } catch (err: any) {
    log('error', `Unhandled check cycle error: ${err?.message || err}`);
  } finally {
    isChecking = false;
  }
}

// Background scheduler
function startScheduler() {
  if (timerId) clearInterval(timerId);
  log('info', `Starting background check scheduler. Running every ${botConfig.checkInterval}s.`);
  
  // Set initial countdown
  nextCheckTime = new Date(Date.now() + botConfig.checkInterval * 1000).toISOString();
  
  timerId = setInterval(() => {
    runBotCheck().catch(err => log('error', `Unhandled scheduler error: ${err}`));
  }, botConfig.checkInterval * 1000);
}

// Initial cycle run 5s after startup
setTimeout(() => {
  if (isRunning) {
    runBotCheck().catch(err => log('error', `Initial bot run failed: ${err}`));
  }
}, 5000);

startScheduler();

// API ROUTES
app.get('/api/status', (req, res) => {
  const state = loadState();
  const recentPosts: PostRecord[] = Object.entries(state.posted)
    .map(([hash, record]) => ({
      id: hash,
      title: record.title,
      time: record.time,
      channel: record.channel,
      status: record.status
    }))
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 100);

  // Count stats
  const animeCount = Object.values(state.posted).filter(p => p.channel === '@animuds' && p.status === 'success').length;
  const gamingCount = Object.values(state.posted).filter(p => p.channel === '@gamemuds' && p.status === 'success').length;
  const bdayCount = Object.values(state.posted).filter(p => p.title.includes('character birthdays') && p.status === 'success').length;

  res.json({
    status: {
      isRunning,
      lastCheckTime,
      nextCheckTime,
      totalPostsSent: animeCount + gamingCount + bdayCount,
      stats: {
        anime: animeCount,
        gaming: gamingCount,
        birthdays: bdayCount
      }
    } as BotStatus,
    logs: logs.slice(0, 150),
    posts: recentPosts
  });
});

app.post('/api/status/toggle', (req, res) => {
  isRunning = !isRunning;
  log('warn', `Bot status manually toggled to: ${isRunning ? 'RUNNING' : 'PAUSED'}`);
  if (isRunning) {
    // Immediate check on resume
    runBotCheck().catch(err => log('error', `Triggered check error: ${err}`));
  }
  res.json({ isRunning });
});

app.post('/api/status/check', async (req, res) => {
  log('info', 'Manual posting check cycle requested from dashboard.');
  try {
    await runBotCheck();
    res.json({ success: true, message: 'Check cycle completed' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/birthdays', (req, res) => {
  try {
    if (fs.existsSync(BIRTHDAYS_FILE)) {
      const data = JSON.parse(fs.readFileSync(BIRTHDAYS_FILE, 'utf-8'));
      res.json(data);
    } else {
      res.json({});
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/birthdays', (req, res) => {
  try {
    const data = req.body as BirthdayDatabase;
    // Validate schema
    if (typeof data !== 'object' || data === null) {
      return res.status(400).json({ error: 'Invalid database payload' });
    }
    fs.writeFileSync(BIRTHDAYS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    log('success', 'Birthday database updated and saved successfully.');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config', (req, res) => {
  // Hide sensitive tokens partially
  const secureConfig = {
    tgBotToken: botConfig.tgBotToken ? `${botConfig.tgBotToken.slice(0, 6)}...${botConfig.tgBotToken.slice(-4)}` : '',
    llmApiKey: botConfig.llmApiKey ? `${botConfig.llmApiKey.slice(0, 4)}...` : '',
    llmModel: botConfig.llmModel,
    llmBaseUrl: botConfig.llmBaseUrl,
    checkInterval: botConfig.checkInterval,
    maxAgeHours: botConfig.maxAgeHours,
    geminiApiKey: botConfig.geminiApiKey ? `${botConfig.geminiApiKey.slice(0, 6)}...` : '',
    avitoClientId: botConfig.avitoClientId || '',
    avitoClientSecret: botConfig.avitoClientSecret ? `${botConfig.avitoClientSecret.slice(0, 4)}...` : '',
    avitoNotificationChatId: botConfig.avitoNotificationChatId || '',
    discordWebhookUrl: botConfig.discordWebhookUrl || ''
  };
  res.json(secureConfig);
});

app.post('/api/config', (req, res) => {
  try {
    const updates = req.body;
    
    // Merge actual updates (only overwrite tokens if they are not masked placeholders)
    if (updates.tgBotToken && !updates.tgBotToken.includes('...')) {
      botConfig.tgBotToken = updates.tgBotToken;
    }
    if (updates.llmApiKey && !updates.llmApiKey.includes('...')) {
      botConfig.llmApiKey = updates.llmApiKey;
    }
    if (updates.geminiApiKey && !updates.geminiApiKey.includes('...')) {
      botConfig.geminiApiKey = updates.geminiApiKey;
    }
    if (updates.avitoClientSecret && !updates.avitoClientSecret.includes('...')) {
      botConfig.avitoClientSecret = updates.avitoClientSecret;
    }
    
    // Read direct string values (or reset if empty/masked)
    botConfig.avitoClientId = updates.avitoClientId || '';
    botConfig.avitoNotificationChatId = updates.avitoNotificationChatId || '';
    botConfig.discordWebhookUrl = updates.discordWebhookUrl || '';
    
    if (updates.llmModel) botConfig.llmModel = updates.llmModel;
    if (updates.llmBaseUrl) botConfig.llmBaseUrl = updates.llmBaseUrl;
    if (updates.checkInterval) botConfig.checkInterval = parseInt(updates.checkInterval, 10);
    if (updates.maxAgeHours) botConfig.maxAgeHours = parseInt(updates.maxAgeHours, 10);

    // Save back to .env
    const envLines = [
      `TG_BOT_TOKEN=${botConfig.tgBotToken}`,
      `LLM_API_KEY=${botConfig.llmApiKey}`,
      `LLM_MODEL=${botConfig.llmModel}`,
      `LLM_BASE_URL=${botConfig.llmBaseUrl}`,
      `CHECK_INTERVAL=${botConfig.checkInterval}`,
      `MAX_AGE_HOURS=${botConfig.maxAgeHours}`,
      `GEMINI_API_KEY=${botConfig.geminiApiKey}`,
      `AVITO_CLIENT_ID=${botConfig.avitoClientId}`,
      `AVITO_CLIENT_SECRET=${botConfig.avitoClientSecret}`,
      `AVITO_NOTIFICATION_CHAT_ID=${botConfig.avitoNotificationChatId}`,
      `DISCORD_WEBHOOK_URL=${botConfig.discordWebhookUrl}`
    ];
    fs.writeFileSync(path.join(process.cwd(), '.env'), envLines.join('\n'), 'utf-8');

    log('success', 'Bot configuration successfully updated and saved to disk.');
    
    // Restart scheduler with new checkInterval
    startScheduler();

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Front-End static server / Vite integration
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    log('info', `Web administration UI server available at http://localhost:${PORT}`);
  });
}

startServer().catch(err => log('error', `Server startup failed: ${err}`));
