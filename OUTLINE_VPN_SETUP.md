# Outline VPN — установка и настройка

## Обзор

Outline VPN (от Jigsaw/Google) — это Shadowsocks-based VPN. Сервер запускается в Docker-контейнере. Поддерживаются **Mac, Windows, Android, iOS, Linux**.

**Сервер:** `46.250.228.229`  
**SSH:** `ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229`

---

## Способ 1: Через Outline Manager (рекомендуется)

### Шаг 1: Outline Manager на Mac

1. Скачайте Outline Manager: https://getoutline.org/get-started/
2. Установите и запустите.
3. Нажмите **«+»** (Add new server).
4. Выберите **«Set up Outline anywhere»** (или «Настроить Outline где угодно»).
5. Введите данные сервера:
   - **Адрес:** `46.250.228.229`
   - **Пользователь:** `vladx`
   - **SSH-ключ:** выберите файл `~/.ssh/id_ed25519_autoro`
6. Нажмите **«Подключиться»** — Manager сам установит Docker (если нет), скрипт и поднимет Outline.
7. После установки Manager покажет сервер. Создайте **Access Key** (кнопка **«+»**).
8. Скопируйте строку подключения (ss://...) — это ключ для клиентов.

### Шаг 2: Outline Client — Mac

1. Скачайте: https://getoutline.org/get-started/ или [Mac App Store](https://apps.apple.com/app/outline-secure-internet-access/id1356177741).
2. Вставьте ключ из Manager (ss://...) и подключитесь.

### Шаг 3: Outline Client — Windows

1. Скачайте: https://getoutline.org/get-started/ или [Microsoft Store](https://apps.microsoft.com/store/detail/outline-secure-internet-access/9NBLGGH4Z3WM).
2. Вставьте ключ (ss://...) и подключитесь.

### Шаг 4: Outline Client — Android

1. Установите из [Google Play](https://play.google.com/store/apps/details?id=org.outline.android.client).
2. Вставьте ключ (ss://...) и подключитесь.

---

## Способ 2: Ручная установка через SSH

Если нужен полный контроль, можно поднять сервер вручную.

### Вариант A: Одна команда с вашего Mac

```bash
# Скачивание и запуск (при вопросах вводите Y и Enter)
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 'curl -fsSL -o /tmp/outline_install.sh https://raw.githubusercontent.com/Jigsaw-Code/outline-server/master/src/server_manager/install_scripts/install_server.sh && yes | sudo bash /tmp/outline_install.sh --hostname=46.250.228.229'
```

Скрипт запускается неинтерактивно. Ключ появится в конце вывода и будет в `/opt/outline/access.txt` на сервере.

### Вариант B: Через локальный скрипт

1. Подключитесь к серверу:
   ```bash
   ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
   ```

2. Скопируйте скрипт (с вашего Mac в другом терминале):
   ```bash
   scp -i ~/.ssh/id_ed25519_autoro outline_vpn_install.sh vladx@46.250.228.229:~/
   ```

3. На сервере:
   ```bash
   sudo bash ~/outline_vpn_install.sh
   ```

### Вариант C: Пошаговая установка

```bash
# Подключение
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Установка Docker (если ещё нет)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Выйдите и зайдите снова для применения группы: exit, затем снова ssh ...

# Установка Outline (в /opt/outline)
export SHADOWBOX_DIR=/opt/outline
wget -qO /tmp/install_outline.sh https://raw.githubusercontent.com/Jigsaw-Code/outline-server/master/src/server_manager/install_scripts/install_server.sh
yes | sudo bash /tmp/install_outline.sh --hostname=46.250.228.229
```

После установки ключ будет в `/opt/outline/access.txt`.

### Открытие портов (Firewall)

Outline использует:
- порт **API** (управление) — случайный или заданный через `--api-port`;
- порт **ключей** (Shadowsocks) — обычно 8388 или случайный.

```bash
# UFW (если используется)
sudo ufw allow 8081/tcp   # API (если --api-port=8081)
sudo ufw allow 8388/tcp   # Shadowsocks
sudo ufw allow 8388/udp   # Shadowsocks UDP
sudo ufw reload

# Или iptables
sudo iptables -A INPUT -p tcp --dport 8081 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 8388 -j ACCEPT
sudo iptables -A INPUT -p udp --dport 8388 -j ACCEPT
```

Проверьте также правила firewall у хостинг-провайдера (G-Core и т.п.).

---

## Подключение Manager к уже установленному серверу

Если сервер уже установлен вручную, Manager можно подключить по конфигу:

1. Скопируйте содержимое `access.txt` с сервера.
2. В Outline Manager выберите **«Add server»** → **«I already have a setup key»**.
3. Вставьте скопированный JSON из `access.txt`.

---

## Формат ключа для клиентов

Пример ключа:

```
ss://BASE64_ENCODED_STRING@46.250.228.229:8388/?outline=1
```

Один ключ — один «пользователь». Можно создать несколько ключей в Manager.

---

## Полезные команды на сервере

```bash
# Статус контейнеров
docker ps | grep -E shadowbox|watchtower

# Логи
docker logs shadowbox

# Перезапуск
docker restart shadowbox

# Конфиг и ключи
sudo cat /opt/outline/access.txt
sudo ls /opt/outline/persisted-state/
```

---

## Ключ на порту 11092 (как у рабочего VPN npvn0t.com)

Рабочий VPN npvn0t.com использует порт **11092**. На нашем сервере создан ключ на том же порту — проверьте, не блокирует ли ваш провайдер этот порт:

```
ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpQd2ptYWtkSlA3Y2RDVWgxOElEbFJJ@46.250.228.229:11092/?outline=1
```

---

## Диагностика: ProxyConnectionFailure / context deadline exceeded

Если клиент не подключается с ошибкой «context deadline exceeded» — соединение не доходит до сервера. Почти всегда это **файрвол**.

### 1. Проверка с вашего Mac

Выполните в терминале:

```bash
nc -zv -w 5 46.250.228.229 4430
```

- **Connection succeeded** — порт открыт, проблема скорее в приложении.
- **Connection refused** или **timed out** — порт закрыт на стороне хостинга или провайдера.

### 2. Открыть порты у хостинг-провайдера

Для G-Core, Selectel, Timeweb и других:

1. Войдите в панель управления сервером / облаком.
2. Найдите раздел **Firewall**, **Security Groups** или **Сетевой экран**.
3. Добавьте правила для **входящего** трафика:
   - TCP **33997** (API)
   - TCP **4825, 8080, 4430** (Shadowsocks)
   - UDP **4825, 8080, 4430** (Shadowsocks)

### 3. Порты для тестов

Сейчас активны ключи на портах **4825, 8080, 4430**. Попробуйте порт 4430 (похож на HTTPS):

```
ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpVU2pnb0NNVFN2b1dEQU1UODlodGd4@46.250.228.229:4430/?outline=1
```

### 4. Тест с другой сети

Подключитесь к мобильному интернету (раздача с телефона) и проверьте подключение. Если заработает — ограничения в вашей домашней/офисной сети.

---

## Возможные проблемы

### Не подключается с Mac/Windows/Android

1. Откройте порты на сервере и у провайдера.
2. Проверьте IP в ключе — должен быть `46.250.228.229`.
3. Убедитесь, что `shadowbox` запущен: `docker ps | grep shadowbox`.

### Manager не может подключиться по SSH

1. Проверьте SSH вручную:  
   `ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229`
2. У пользователя должен быть доступ к Docker (группа `docker`).
3. Права на ключ: `chmod 600 ~/.ssh/id_ed25519_autoro`.

### Архитектура сервера

Outline Server рассчитан на **x86_64**. На ARM (например, Oracle Cloud ARM) нужен другой подход.

---

## Ссылки

- [getoutline.org](https://getoutline.org) — сайт проекта
- [Outline Manager](https://getoutline.org/get-started/) — скачать Manager
- [Outline Client](https://getoutline.org/get-started/#step-3) — скачать клиенты
- [GitHub outline-server](https://github.com/Jigsaw-Code/outline-server) — исходный код
