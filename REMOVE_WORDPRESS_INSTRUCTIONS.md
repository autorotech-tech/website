# Инструкции по удалению WordPress контейнеров и файлов

## 🎯 Цель:
1. Остановить и удалить контейнеры WordPress для **pquoc.com**
2. Удалить папку `projects/pquoc.com/wordpress`
3. Остановить и удалить контейнеры WordPress для **autoro.tech**
4. Удалить папку `projects/autoro.tech/wordpress` и БД

## ⚡ Быстрое выполнение (скопируйте и выполните на сервере):

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# 1. Найти все WordPress контейнеры
docker ps -a | grep -i wordpress
docker ps -a | grep -i pquoc

# 2. Остановить и удалить контейнеры pquoc (замените NAMES на реальные)
docker ps -a | grep -i pquoc | awk '{print $1}' | xargs -r docker stop
docker ps -a | grep -i pquoc | awk '{print $1}' | xargs -r docker rm

# 3. Удалить папку pquoc.com/wordpress
sudo rm -rf /home/vladx/projects/pquoc.com/wordpress

# 4. Остановить и удалить контейнеры WordPress для autoro.tech
docker ps -a | grep -i autoro | grep -i wordpress | awk '{print $1}' | xargs -r docker stop
docker ps -a | grep -i autoro | grep -i wordpress | awk '{print $1}' | xargs -r docker rm

# 5. Удалить папку autoro.tech/wordpress
sudo rm -rf /home/vladx/projects/autoro.tech/wordpress

# 6. Проверить что все удалено
docker ps -a | grep -i wordpress
ls -la /home/vladx/projects/pquoc.com/ | grep wordpress
ls -la /home/vladx/projects/autoro.tech/ | grep wordpress
```

## 📋 Шаг 1: Найти все WordPress контейнеры (детально)

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Найти контейнеры WordPress
docker ps -a | grep -i wordpress

# Найти контейнеры pquoc
docker ps -a | grep -i pquoc

# Найти контейнеры autoro
docker ps -a | grep -i autoro
```

## 📋 Шаг 2: Остановить и удалить WordPress для pquoc.com

```bash
# Остановить контейнеры (замените CONTAINER_NAME на реальные имена)
docker stop $(docker ps -a -q --filter "name=wordpress-pquoc") 2>/dev/null
docker stop $(docker ps -a -q --filter "name=pquoc") 2>/dev/null

# Или по конкретным именам (найдите их в выводе docker ps -a)
# docker stop CONTAINER_NAME_1 CONTAINER_NAME_2

# Удалить контейнеры
docker rm $(docker ps -a -q --filter "name=wordpress-pquoc") 2>/dev/null
docker rm $(docker ps -a -q --filter "name=pquoc") 2>/dev/null

# Удалить папку (нужен sudo пароль: iddqdidkfa)
sudo rm -rf /home/vladx/projects/pquoc.com/wordpress

# Проверить что папка удалена
ls -la /home/vladx/projects/pquoc.com/
```

## 📋 Шаг 3: Остановить и удалить WordPress для autoro.tech

```bash
# Остановить контейнеры WordPress для autoro.tech
docker stop $(docker ps -a -q --filter "name=autoro.*wordpress") 2>/dev/null
docker stop $(docker ps -a -q --filter "name=wordpress.*autoro") 2>/dev/null

# Или по конкретным именам
# docker stop CONTAINER_NAME_1 CONTAINER_NAME_2

# Удалить контейнеры
docker rm $(docker ps -a -q --filter "name=autoro.*wordpress") 2>/dev/null
docker rm $(docker ps -a -q --filter "name=wordpress.*autoro") 2>/dev/null

# Удалить папку (нужен sudo пароль: iddqdidkfa)
sudo rm -rf /home/vladx/projects/autoro.tech/wordpress

# Проверить что папка удалена
ls -la /home/vladx/projects/autoro.tech/
```

## 📋 Шаг 4: Найти и удалить БД WordPress для autoro.tech

```bash
# Найти контейнеры БД (MySQL/MariaDB)
docker ps -a | grep -i mysql
docker ps -a | grep -i mariadb

# Если найдены контейнеры БД для WordPress autoro.tech:
# docker stop CONTAINER_NAME_DB
# docker rm CONTAINER_NAME_DB

# Или удалить volumes с данными БД
docker volume ls | grep -i wordpress
docker volume ls | grep -i autoro

# Удалить volumes (если нужно)
# docker volume rm VOLUME_NAME
```

## 📋 Шаг 5: Проверка результатов

```bash
# Проверить что контейнеры удалены
docker ps -a | grep -i wordpress

# Проверить что папки удалены
ls -la /home/vladx/projects/pquoc.com/ | grep wordpress
ls -la /home/vladx/projects/autoro.tech/ | grep wordpress

# Должно показать "No such file or directory" или пустой вывод
```

## 🔧 Альтернативный способ: Использовать docker-compose (если есть)

Если WordPress запущен через docker-compose:

```bash
# Перейти в папку с docker-compose.yml
cd /home/vladx/projects/pquoc.com/wordpress
# ИЛИ
cd /home/vladx/projects/autoro.tech/wordpress

# Остановить и удалить
docker-compose down -v

# Удалить папку
cd ..
sudo rm -rf wordpress
```

## ⚠️ ВАЖНО:

1. **Перед удалением проверьте** что контейнеры действительно связаны с WordPress
2. **Убедитесь** что удаляете правильные контейнеры
3. **Сделайте backup** если есть важные данные (хотя вы уже подтверждали удаление)

## 🎯 Быстрая команда для поиска всех связанных контейнеров:

```bash
# Найти все контейнеры содержащие "wordpress" или "pquoc"
docker ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}" | grep -E "wordpress|pquoc"

# Найти volumes связанные с WordPress
docker volume ls | grep -E "wordpress|pquoc"
```

