import requests, json, time, os, re, hashlib, xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from bs4 import BeautifulSoup

TG_BOT_TOKEN = os.environ.get("TG_BOT_TOKEN", "")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "gemma-4-31b")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.cerebras.ai/v1")
CHECK_INTERVAL = int(os.environ.get("CHECK_INTERVAL", "600"))
MAX_AGE_HOURS = int(os.environ.get("MAX_AGE_HOURS", "48"))

ANIME_STYLE = """Ты — автор популярного Telegram-канала аниме-новостей. Пиши как друг-отаку, который реально в теме.

ФОРМАТИРОВАНИЕ ОБЯЗАТЕЛЬНО:
1. **Жирный заголовок** с эмодзи (⚡️🎬✨🔥) — название аниме + суть новости в 1 предложении
2. Пустая строка
3. Основная часть — 2-3 абзаца, каждый 2-3 предложения. Давай контекст: что за франшиза, кто студия/режиссёр, когда выходит.
4. Пустая строка
5. Блок «Что мы знаем» с ключевыми деталями (дата, платформа, студия, каст)
6. Пустая строка
7. 👍 [1 плюс] / 👎 [1 минус] / Вердикт: [1 предложение]
8. Пустая строка
9. #АнимеНовости@animuds

Тон: разговорный, дружелюбный, с мнением. Используй «мы» и «наш».
БЕЗ корпоративщины. Конкретика и эмоция."""

GAME_STYLE = """Ты — автор популярного Telegram-канала игровых новостей. Пиши как геймер-друг, который реально разбирается.

ФОРМАТИРОВАНИЕ ОБЯЗАТЕЛЬНО:
1. **Жирный заголовок** с эмодзи (🎮🕹️🔫🏎️) — название игры + суть новости в 1 предложении
2. Пустая строка
3. Основная часть — 2-3 абзаца, каждый 2-3 предложения. Давай контекст.
4. Пустая строка
5. Блок «Что мы знаем» с ключевыми деталями
6. Пустая строка
7. 👍 [1 плюс] / 👎 [1 минус] / Вердикт: [1 предложение]
8. Без хештегов

Тон: разговорный, дружелюбный. Используй «мы» и «наш».
БЕЗ корпоративщины. Конкретика и эмоция.

ВАЖНО: если новость про конкретную игру — добавь в конце отдельной строкой:
STEAM_SEARCH: Точное название игры
Если это гача/мобильная — НЕ пиши STEAM_SEARCH."""

CHANNELS = {
    "animuds": {
        "chat_id": "@animuds",
        "type": "anime",
        "style": ANIME_STYLE,
        "sources": [
            {"type": "rss", "url": "https://myanimelist.net/rss/news.xml", "name": "MAL"},
            {"type": "rss", "url": "https://www.crunchyroll.com/rss/news", "name": "Crunchyroll"},
            {"type": "rdf", "url": "https://animeanime.jp/rss/index.rdf", "name": "Anime! Anime!"},
        ],
    },
    "gamemuds": {
        "chat_id": "@gamemuds",
        "type": "gaming",
        "style": GAME_STYLE,
        "sources": [
            {"type": "rss", "url": "https://gamerant.com/feed/", "name": "GameRant"},
            {"type": "rss", "url": "https://feeds.ign.com/ign/all", "name": "IGN"},
            {"type": "rss", "url": "https://www.gematsu.com/feed/", "name": "Gematsu"},
            {"type": "rss", "url": "https://www.siliconera.com/feed/", "name": "Siliconera"},
        ],
    },
}

STATE_FILE = os.environ.get("STATE_FILE", "/tmp/auto_poster_state.json")
BIRTHDAYS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "birthdays.json")
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
RDF_NS = {'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'rss': 'http://purl.org/rss/1.0/', 'dc': 'http://purl.org/dc/elements/1.1/', 'content': 'http://purl.org/rss/1.0/modules/content/'}

def load_birthdays():
    try:
        with open(BIRTHDAYS_FILE, 'r') as f: return json.load(f)
    except: return {}

def check_birthdays():
    birthdays = load_birthdays()
    today = datetime.now().strftime("%m-%d")
    chars = birthdays.get(today, [])
    if not chars: return None
    lines = ["🎂 Сегодня день рождения!"]
    for char in chars:
        lines.append("\n**{0}** — {1}".format(char['name'], char['anime']))
    lines.append("\n\n#АнимеНовости@animuds")
    return "\n".join(lines)

def load_state():
    try:
        with open(STATE_FILE, 'r') as f: return json.load(f)
    except: return {"posted": {}, "posted_titles": []}

def save_state(state):
    with open(STATE_FILE, 'w') as f: json.dump(state, f, ensure_ascii=False)

def url_hash(url): return hashlib.md5(url.encode()).hexdigest()[:12]

def title_similarity(t1, t2):
    return SequenceMatcher(None, t1.lower(), t2.lower()).ratio()

def is_duplicate(title, posted_titles, threshold=0.5):
    for pt in posted_titles:
        if title_similarity(title, pt) > threshold: return True
    return False

def parse_date(date_str):
    if not date_str: return None
    formats = ['%a, %d %b %Y %H:%M:%S %z', '%Y-%m-%dT%H:%M:%S%z', '%Y-%m-%dT%H:%M:%SZ', '%Y-%m-%d']
    for fmt in formats:
        try: return datetime.strptime(date_str.strip(), fmt)
        except: continue
    return None

def parse_rss(source):
    items = []
    try:
        resp = requests.get(source["url"], timeout=15, headers=HEADERS)
        root = ET.fromstring(resp.text)
        if source.get("type") == "rdf":
            for item in root.findall('.//rss:item', RDF_NS):
                title = item.findtext('rss:title', '', RDF_NS).strip()
                link = item.findtext('rss:link', '', RDF_NS).strip()
                desc_raw = item.findtext('rss:description', '', RDF_NS) or ''
                desc = re.sub(r'<[^>]+>', '', desc_raw).strip()[:500]
                pub_date = item.findtext('dc:date', '', RDF_NS) or ''
                if title and link:
                    items.append({"title": title, "link": link, "description": desc, "image_url": "", "categories": [], "source_name": source["name"], "pub_date": pub_date})
        else:
            for item in root.findall('.//item'):
                title = item.findtext('title', '').strip()
                link = item.findtext('link', '').strip()
                desc_raw = item.findtext('description', '') or ''
                desc = re.sub(r'<[^>]+>', '', desc_raw).strip()[:500]
                pub_date = item.findtext('pubDate', '') or ''
                img_url = ''
                ns_media = {'media': 'http://search.yahoo.com/mrss/'}
                thumb = item.find('media:thumbnail', ns_media)
                if thumb is not None: img_url = thumb.get('url', '')
                if not img_url and desc_raw:
                    m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', desc_raw)
                    if m: img_url = m.group(1)
                if not img_url:
                    ce = item.findtext('content:encoded', '', RDF_NS)
                    if ce:
                        m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', ce)
                        if m: img_url = m.group(1)
                categories = [c.text for c in item.findall('category') if c.text]
                if title and link:
                    items.append({"title": title, "link": link, "description": desc, "image_url": img_url, "categories": categories, "source_name": source["name"], "pub_date": pub_date})
    except Exception as e:
        print("Error parsing {0}: {1}".format(source.get('name','?'), e))
    return items

def get_article_image(url):
    try:
        resp = requests.get(url, timeout=15, headers=HEADERS)
        soup = BeautifulSoup(resp.text, 'html.parser')
        og = soup.find('meta', property='og:image')
        if og and og.get('content'): return og.get('content')
    except: pass
    return ''

def search_steam(game_name):
    try:
        resp = requests.get("https://store.steampowered.com/api/storesearch/?term={0}&l=russian&cc=ru".format(game_name), timeout=10, headers=HEADERS)
        items = resp.json().get('items', [])
        if items:
            first = items[0]
            appid = first.get('id', '')
            price = first.get('price', {})
            ps = ''
            if price:
                f = price.get('final', 0)
                ps = " ({0}₽)".format(f//100) if f > 0 else " (Бесплатно)"
            return "🎮 Steam: https://store.steampowered.com/app/{0}{1}".format(appid, ps)
    except: pass
    return ''

def translate_with_llm(title, description, style, channel_type):
    if not LLM_API_KEY: return "**{0}**\n\n{1}".format(title, description)
    prompt = "{0}\n\nНОВОСТЬ (английский):\nЗаголовок: {1}\nОписание: {2}".format(style, title, description)
    try:
        resp = requests.post("{0}/chat/completions".format(LLM_BASE_URL),
            headers={"Authorization": "Bearer {0}".format(LLM_API_KEY)},
            json={"model": LLM_MODEL, "messages": [{"role": "user", "content": prompt}], "max_tokens": 800, "temperature": 0.5},
            timeout=30)
        return resp.json()['choices'][0]['message']['content'].strip()
    except Exception as e:
        print("LLM error: {0}".format(e))
        return "**{0}**\n\n{1}".format(title, description)

def download_image(url):
    try:
        resp = requests.get(url, timeout=15, headers=HEADERS, stream=True)
        if resp.status_code == 200 and 'image' in resp.headers.get('content-type', ''): return resp.content
    except: pass
    return None

def send_photo_post(chat_id, text, image_bytes):
    try:
        resp = requests.post("https://api.telegram.org/bot{0}/sendPhoto".format(TG_BOT_TOKEN),
            data={"chat_id": chat_id, "caption": text[:1024], "parse_mode": "Markdown"}, files={"photo": ("image.jpg", image_bytes)}, timeout=30)
        result = resp.json()
        if result.get('ok'):
            print("  ✅ Posted with image to {0}".format(chat_id))
            return True
        clean = re.sub(r'[*_\[\]]', '', text)
        resp2 = requests.post("https://api.telegram.org/bot{0}/sendPhoto".format(TG_BOT_TOKEN),
            data={"chat_id": chat_id, "caption": clean[:1024]}, files={"photo": ("image.jpg", image_bytes)}, timeout=30)
        if resp2.json().get('ok'):
            print("  ✅ Posted with image (no markdown) to {0}".format(chat_id))
            return True
        return send_text_post(chat_id, text)
    except: return send_text_post(chat_id, text)

def send_text_post(chat_id, text):
    try:
        resp = requests.post("https://api.telegram.org/bot{0}/sendMessage".format(TG_BOT_TOKEN),
            json={"chat_id": chat_id, "text": text[:4096], "parse_mode": "Markdown"}, timeout=15)
        result = resp.json()
        if result.get('ok'):
            print("  ✅ Posted text to {0}".format(chat_id))
            return True
        clean = re.sub(r'[*_\[\]]', '', text)
        resp2 = requests.post("https://api.telegram.org/bot{0}/sendMessage".format(TG_BOT_TOKEN),
            json={"chat_id": chat_id, "text": clean[:4096]}, timeout=15)
        if resp2.json().get('ok'):
            print("  ✅ Posted text (no markdown) to {0}".format(chat_id))
            return True
        print("  ❌ Failed: {0}".format(result.get('description')))
        return False
    except Exception as e:
        print("  ❌ Error: {0}".format(e))
        return False

def process_channel(channel_key, channel_config):
    state = load_state()
    posted = state.get('posted', {})
    posted_titles = state.get('posted_titles', [])
    cutoff = datetime.now() - timedelta(hours=MAX_AGE_HOURS)

    all_items = []
    for source in channel_config["sources"]:
        items = parse_rss(source)
        print("  {0}: {1} items".format(source['name'], len(items)))
        all_items.extend(items)

    filtered = []
    for item in all_items:
        h = url_hash(item["link"])
        if h in posted: continue
        pub = parse_date(item.get("pub_date", ""))
        if pub and pub.replace(tzinfo=None) < cutoff: continue
        if channel_config["type"] == "gaming":
            anime_cats = ['Anime', 'Manga', 'One Piece', 'Dragon Ball', 'Naruto', 'Bleach', 'My Hero Academia']
            if any(cat in item.get("categories", []) for cat in anime_cats): continue
        if is_duplicate(item["title"], posted_titles): continue
        filtered.append(item)

    print("  → {0} new unique items".format(len(filtered)))

    new_posts = 0
    for item in filtered:
        print("\n  NEW: {0}".format(item['title'][:60]))

        img_url = item.get("image_url", "")
        if not img_url: img_url = get_article_image(item["link"])

        post_text = translate_with_llm(item["title"], item["description"], channel_config["style"], channel_config["type"])

        if channel_config["type"] == "gaming":
            steam_match = re.search(r'STEAM_SEARCH:\s*(.+)', post_text)
            if steam_match:
                game_name = steam_match.group(1).strip()
                steam_link = search_steam(game_name)
                post_text = re.sub(r'\n?STEAM_SEARCH:.+', '', post_text).strip()
                if steam_link: post_text += "\n\n{0}".format(steam_link)

        image_bytes = download_image(img_url) if img_url else None
        if image_bytes:
            success = send_photo_post(channel_config["chat_id"], post_text, image_bytes)
        else:
            success = send_text_post(channel_config["chat_id"], post_text)

        if success:
            h = url_hash(item["link"])
            posted[h] = {"title": item["title"][:60], "time": datetime.now().isoformat()}
            posted_titles.append(item["title"])
            new_posts += 1
            time.sleep(3)

    state['posted'] = posted
    state['posted_titles'] = posted_titles[-500:]
    save_state(state)
    return new_posts

if __name__ == "__main__":
    print("🤖 Auto-poster v2 started!")
    print("Channels: {0}".format(list(CHANNELS.keys())))
    print("Check interval: {0}s".format(CHECK_INTERVAL))
    print("Max age: {0}h".format(MAX_AGE_HOURS))
    print("LLM: {0} @ {1}".format(LLM_MODEL, LLM_BASE_URL))
    if not LLM_API_KEY: print("⚠️ No LLM_API_KEY — posts in English (no translation)")
    if not TG_BOT_TOKEN:
        print("❌ No TG_BOT_TOKEN — cannot post!")
        exit(1)

    while True:
        try:
            bday_text = check_birthdays()
            if bday_text:
                bday_hash = url_hash("birthday_{0}".format(datetime.now().strftime('%Y-%m-%d')))
                state = load_state()
                if bday_hash not in state.get('posted', {}):
                    send_text_post("@animuds", bday_text)
                    state['posted'][bday_hash] = {"title": "birthday", "time": datetime.now().isoformat()}
                    save_state(state)
                    print("🎂 Birthday post sent!")

            for ch_key, ch_config in CHANNELS.items():
                print("\n[{0}] Checking {1}...".format(datetime.now().strftime('%H:%M:%S'), ch_key))
                count = process_channel(ch_key, ch_config)
                print("  → {0} new posts".format(count))
        except Exception as e:
            print("Error: {0}".format(e))
        time.sleep(CHECK_INTERVAL)
