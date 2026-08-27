# Proxy настройки восстановлены

## Текущее состояние

✅ **SOCKS Proxy:** Включен на `127.0.0.1:1080`
✅ **HTTP Proxy:** Включен на `127.0.0.1:8080`
✅ **SSH SOCKS5 туннель:** Запущен на порту 1080

## Команды для управления

### Запустить SSH SOCKS5 туннель

```bash
ssh -i ~/.ssh/id_ed25519_autoro -D 1080 -N -f vladx@46.250.228.229
```

Параметры:
- `-D 1080` - создает SOCKS5 прокси на порту 1080
- `-N` - не выполнять команды, только туннель
- `-f` - запустить в фоне

### Остановить SSH туннель

```bash
pkill -f "ssh.*-D 1080"
```

### Проверить, работает ли туннель

```bash
ps aux | grep "ssh.*-D 1080" | grep -v grep
lsof -i :1080
```

### Проверить настройки прокси

```bash
# SOCKS proxy
networksetup -getsocksfirewallproxy "Wi-Fi"

# HTTP proxy
networksetup -getwebproxy "Wi-Fi"
```

### Включить/отключить прокси

Включить SOCKS:
```bash
networksetup -setsocksfirewallproxystate "Wi-Fi" on
```

Отключить SOCKS:
```bash
networksetup -setsocksfirewallproxystate "Wi-Fi" off
```

Включить HTTP:
```bash
networksetup -setwebproxystate "Wi-Fi" on
```

Отключить HTTP:
```bash
networksetup -setwebproxystate "Wi-Fi" off
```

## Проверка работы

Проверить, работает ли прокси:

```bash
# Через SOCKS5
curl --socks5 127.0.0.1:1080 http://ifconfig.me

# Через HTTP proxy (если есть сервис на 8080)
curl --proxy http://127.0.0.1:8080 http://ifconfig.me
```

## Примечания

- **SOCKS5 Proxy (1080):** Работает через SSH туннель, который нужно запускать вручную
- **HTTP Proxy (8080):** Возможно, требует отдельного сервиса (например, cloudflared или другой прокси-сервер)

Если HTTP proxy на порту 8080 не работает, можно отключить его и использовать только SOCKS5:

```bash
networksetup -setwebproxystate "Wi-Fi" off
```


