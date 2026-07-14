export interface Birthday {
  name: string;
  anime: string;
}

export interface BirthdayDatabase {
  [date: string]: Birthday[];
}

export interface PostRecord {
  id: string;
  title: string;
  time: string;
  link?: string;
  channel: string;
  status: 'success' | 'failed';
  summary?: string;
}

export interface BotConfig {
  tgBotToken: string;
  llmApiKey: string;
  llmModel: string;
  llmBaseUrl: string;
  checkInterval: number; // in seconds
  maxAgeHours: number;
  geminiApiKey: string;
  avitoClientId: string;
  avitoClientSecret: string;
  avitoNotificationChatId: string;
  discordWebhookUrl: string;
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export interface BotStatus {
  isRunning: boolean;
  lastCheckTime: string | null;
  nextCheckTime: string | null;
  totalPostsSent: number;
  stats: {
    anime: number;
    gaming: number;
    birthdays: number;
  };
}
