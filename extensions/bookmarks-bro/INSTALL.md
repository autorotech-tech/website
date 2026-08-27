# Keep It For Me — установка (multi-browser)

**Build:** `0.1.3-testing` · **Manifest:** `0.3.3`  
**Архив:** `extensions/bookmarks-bro-0.3.3.zip`  
**Канон:** `extensions/bookmarks-bro/`

Синхронизация: закладки браузера → `POST /api/v1/bookmarks/sync/start` → worker/enrich → Unified KB / Obsidian.  
Каждый браузер/профиль — отдельный `browser_profiles` row; URL дедупятся по workspace.

Поддерживаются: **Chrome, Edge, Brave, Opera, Firefox**. Safari и публикация в магазинах — вне текущего scope.

## Общие шаги

1. Распакуйте `bookmarks-bro-0.3.3.zip` **или** используйте папку `extensions/bookmarks-bro`.
2. В настройках расширения: **API Base** = `https://swoop.autoro.tech` (staging).
3. **Login** → **Sync → Vector + Obsidian**.
4. Для «всех браузеров»: установите расширение и залогиньтесь в **каждом** браузере/профиле отдельно.

## Chrome

1. `chrome://extensions`
2. Developer mode → **Load unpacked** → папка `bookmarks-bro`
3. Или перетащите zip (Chrome распакует) / Load unpacked после unzip

## Microsoft Edge

1. `edge://extensions`
2. Developer mode → **Load unpacked** → папка `bookmarks-bro`

## Brave

1. `brave://extensions`
2. Developer mode → **Load unpacked** → папка `bookmarks-bro`
3. В sync profile должен уйти `browserType=brave` (см. Options / job payload)

## Opera

1. `opera://extensions`
2. Developer mode → **Load unpacked** → папка `bookmarks-bro`
3. Ожидается `browserType=opera`

## Firefox

1. `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → выберите `manifest.json` из папки `bookmarks-bro`
3. Gecko id: `bookmarks-bro@autoro.tech` (уже в manifest)
4. Temporary add-on сбрасывается после перезапуска Firefox — для постоянного использования нужна подпись / AMO (не в этом релизе)

## Проверка

См. [TESTING.md](./TESTING.md): Login → Sync → embeddings/KB → (опционально) Obsidian.
