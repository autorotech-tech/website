# Исправление: Core Tunnel подключен, но браузер не работает

## Проблема

Core Tunnel подключен (Connected), но интернет в браузере не работает.

## Причина

Скорее всего проблема в том, что включен **HTTPS Proxy на порту 8080**, но сервиса на этом порту нет. Браузер пытается использовать HTTPS proxy, который не работает, и из-за этого не может загружать страницы.

## Решение

### Шаг 1: Отключить HTTPS Proxy (8080)

HTTPS Proxy на порту 8080 включен, но сервиса на этом порту нет. Нужно отключить его:

```bash
networksetup -setsecurewebproxystate "Wi-Fi" off
networksetup -setwebproxystate "Wi-Fi" off
```

Или через System Settings:
1. System Settings → Network → Wi-Fi → Details → Proxies
2. Отключить **"Secure web proxy (HTTPS)"** (переключатель в OFF)
3. Отключить **"Web proxy (HTTP)"** если включен (переключатель в OFF)
4. Оставить включенным только **"SOCKS proxy"** на `127.0.0.1:1080`
5. Нажать OK

### Шаг 2: Проверить SOCKS Proxy

Убедитесь, что SOCKS Proxy включен и работает:

```bash
# Проверить настройки
networksetup -getsocksfirewallproxy "Wi-Fi"

# Проверить работу
curl --socks5 127.0.0.1:1080 http://ifconfig.me
```

Должно показать IP сервера: `46.250.228.229`

### Шаг 3: Правильная конфигурация

После исправления должно быть:

✅ **SOCKS proxy:** Включен на `127.0.0.1:1080`
❌ **Web proxy (HTTP):** Отключен
❌ **Secure web proxy (HTTPS):** Отключен

## Проверка работы

После отключения HTTPS proxy:

1. Перезапустите браузер
2. Попробуйте открыть любой сайт
3. Проверьте, что работает

## Альтернативное решение: Если нужно использовать HTTP/HTTPS proxy

Если действительно нужен HTTP/HTTPS proxy, нужно запустить сервис на порту 8080. Но для Core Tunnel это обычно не требуется - достаточно только SOCKS proxy на 1080.

## Итоговая команда для исправления

```bash
# Отключить HTTP и HTTPS proxy
networksetup -setwebproxystate "Wi-Fi" off
networksetup -setsecurewebproxystate "Wi-Fi" off

# Проверить, что SOCKS proxy включен
networksetup -getsocksfirewallproxy "Wi-Fi"

# Должно быть:
# Enabled: Yes
# Server: 127.0.0.1
# Port: 1080
```

После этого браузер должен заработать через SOCKS proxy на порту 1080.


