# Auto-poster для @animuds и @gamemuds

## Деплой на Railway

1. Создай новый проект на https://railway.app
2. Deploy from local folder (или подключи GitHub-репо)
3. В Variables добавь переменные из .env.example
4. Railway подхватит railway.toml и запустит `python auto_poster.py`

## Переменные

- `TG_BOT_TOKEN` — токен @Apexxxxxbost_bot
- `LLM_API_KEY` — ключ Cerebras
- `LLM_MODEL=gemma-4-31b`
- `LLM_BASE_URL=https://api.cerebras.ai/v1`
- `CHECK_INTERVAL=600` (10 мин)
- `MAX_AGE_HOURS=48`
- `STATE_FILE=/tmp/auto_poster_state.json`
