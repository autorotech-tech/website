# Выполнение удаления WordPress

Из-за проблем с SSH окружением, выполните команды **вручную на сервере**:

## 🔧 Команды для выполнения:

```bash
# 1. Подключиться к серверу
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# 2. Найти все WordPress и pquoc контейнеры
docker ps -a | grep -i wordpress
docker ps -a | grep -i pquoc

# 3. Остановить и удалить контейнеры pquoc
# (Скопируйте NAMES из вывода выше и замените CONTAINER_NAME)
docker stop CONTAINER_NAME_1 CONTAINER_NAME_2
docker rm CONTAINER_NAME_1 CONTAINER_NAME_2

# Или автоматически:
docker ps -a | grep -i pquoc | awk '{print $1}' | while read id; do docker stop $id; docker rm $id; done

# 4. Удалить папку pquoc.com/wordpress (sudo пароль: iddqdidkfa)
sudo rm -rf /home/vladx/projects/pquoc.com/wordpress

# 5. Остановить и удалить контейнеры WordPress для autoro.tech
docker ps -a | grep -i autoro | grep -i wordpress

# (Скопируйте NAMES и замените CONTAINER_NAME)
docker stop CONTAINER_NAME_1 CONTAINER_NAME_2
docker rm CONTAINER_NAME_1 CONTAINER_NAME_2

# Или автоматически:
docker ps -a | grep -i autoro | grep -i wordpress | awk '{print $1}' | while read id; do docker stop $id; docker rm $id; done

# 6. Удалить папку autoro.tech/wordpress
sudo rm -rf /home/vladx/projects/autoro.tech/wordpress

# 7. Проверить что все удалено
docker ps -a | grep -i wordpress
ls -la /home/vladx/projects/pquoc.com/ | grep wordpress
ls -la /home/vladx/projects/autoro.tech/ | grep wordpress

# 8. Проверить volumes (если нужно удалить)
docker volume ls | grep -i wordpress
docker volume ls | grep -i pquoc
```

## ⚡ Альтернатива: Создать скрипт на сервере

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Создать скрипт
cat > /tmp/rm_wp.sh << 'EOF'
#!/bin/bash
echo "Поиск контейнеров..."
docker ps -a | grep -i wordpress
docker ps -a | grep -i pquoc

echo "Удаление контейнеров pquoc..."
docker ps -a | grep -i pquoc | awk '{print $1}' | xargs -r docker stop
docker ps -a | grep -i pquoc | awk '{print $1}' | xargs -r docker rm

echo "Удаление папки pquoc.com/wordpress..."
sudo rm -rf /home/vladx/projects/pquoc.com/wordpress

echo "Удаление контейнеров WordPress autoro.tech..."
docker ps -a | grep -i autoro | grep -i wordpress | awk '{print $1}' | xargs -r docker stop
docker ps -a | grep -i autoro | grep -i wordpress | awk '{print $1}' | xargs -r docker rm

echo "Удаление папки autoro.tech/wordpress..."
sudo rm -rf /home/vladx/projects/autoro.tech/wordpress

echo "Проверка..."
docker ps -a | grep -i wordpress
ls -la /home/vladx/projects/pquoc.com/ | grep wordpress
ls -la /home/vladx/projects/autoro.tech/ | grep wordpress
EOF

chmod +x /tmp/rm_wp.sh
/tmp/rm_wp.sh
```

