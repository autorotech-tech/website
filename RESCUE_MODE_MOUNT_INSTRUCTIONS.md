# Правильное монтирование диска в Rescue Mode

## 🔍 Анализ вашей системы:

Из `lsblk` видно:
- `sda1` - 1MB (обычно это BIOS boot partition)
- `sda2` - 2GB (скорее всего swap или boot)
- `sda3` - 73GB (это **основной раздел** с вашей системой)
- `sda4` - **НЕ СУЩЕСТВУЕТ** ❌

## ✅ Правильная инструкция:

### Шаг 1: Определить файловую систему

```bash
# Проверить тип файловой системы на sda3
blkid /dev/sda3
# или
file -s /dev/sda3
```

### Шаг 2: Примонтировать основной раздел

```bash
# Создать точку монтирования
mkdir -p /mnt

# Примонтировать sda3 (основной раздел)
mount /dev/sda3 /mnt
```

### Шаг 3: Если есть отдельный boot раздел (sda2)

```bash
# Проверить что на sda2
blkid /dev/sda2

# Если это boot раздел (ext4, xfs), примонтировать:
mkdir -p /mnt/boot
mount /dev/sda2 /mnt/boot
```

### Шаг 4: Примонтировать системные директории для chroot

```bash
# Примонтировать dev, proc, sys
mount --bind /dev /mnt/dev
mount --bind /proc /mnt/proc
mount --bind /sys /mnt/sys

# Если есть /run
mount --bind /run /mnt/run
```

### Шаг 5: Chroot в систему

```bash
chroot /mnt /bin/bash
```

### Шаг 6: Теперь вы в основной системе!

```bash
# Проверить что вы в правильной системе
hostname
# Должно показать: vmi2607864 (не rescue)

# Проверить файлы
ls -la /home/vladx/
```

## 🔧 Что делать дальше:

### A. Найти и примонтировать новый раздел (если докупили место):

```bash
# 1. Посмотреть все разделы
lsblk -f
# Найти новый раздел (без MOUNTPOINT)

# 2. Определить тип файловой системы
blkid /dev/sdaX  # где X - номер нового раздела

# 3. Если не отформатирован - отформатировать
# mkfs.ext4 /dev/sdaX  # ОСТОРОЖНО! Только если раздел пустой!

# 4. Создать точку монтирования
mkdir -p /storage  # или другое имя

# 5. Примонтировать
mount /dev/sdaX /storage

# 6. Получить UUID и добавить в /etc/fstab
blkid /dev/sdaX
# Записать UUID, затем:
echo "UUID=<uuid>  /storage  ext4  defaults  0  2" >> /etc/fstab

# 7. Проверить
mount -a
df -h | grep storage
```

### B. Сбросить пароль root:

```bash
passwd root
# Ввести новый пароль дважды
```

### B. Удалить WordPress файлы:

```bash
cd /home/vladx/projects/pquoc.com
rm -rf wordpress wp-admin wp-content wp-includes
rm -f wp-* index.php license.txt readme.html xmlrpc.php
ls -la
```

### C. Очистить Docker:

```bash
# Выйти из chroot сначала
exit

# Вернуться в chroot
chroot /mnt /bin/bash

# Очистить Docker
docker system prune -f --volumes
docker builder prune -a -f
```

### D. Проверить конфигурацию Nginx:

```bash
cat /home/vladx/projects/autoro.tech/html/default.conf | head -20
```

## ⚠️ Важно:

1. **sda3** - это ваш основной раздел (73GB)
2. **sda4 не существует** - не пытайтесь его монтировать
3. **startxfce4** недоступен в этом rescue mode - работайте через командную строку
4. После всех операций **перезагрузите** сервер в обычном режиме

## 🔄 После завершения работы:

```bash
# Выйти из chroot
exit

# Отмонтировать все
umount /mnt/dev
umount /mnt/proc
umount /mnt/sys
umount /mnt/boot  # если монтировали
umount /mnt

# Перезагрузить сервер
reboot
```

## 📋 Полная последовательность команд:

```bash
# 1. Проверить разделы
lsblk

# 2. Примонтировать основной раздел
mount /dev/sda3 /mnt

# 3. Примонтировать boot (если нужно)
blkid /dev/sda2
# Если это boot, то:
mkdir -p /mnt/boot && mount /dev/sda2 /mnt/boot

# 4. Примонтировать системные директории
mount --bind /dev /mnt/dev
mount --bind /proc /mnt/proc
mount --bind /sys /mnt/sys

# 5. Chroot
chroot /mnt /bin/bash

# 6. Теперь вы в основной системе - выполняйте нужные команды
passwd root
cd /home/vladx/projects/pquoc.com
rm -rf wordpress wp-admin wp-content wp-includes
rm -f wp-* index.php license.txt readme.html xmlrpc.php

# 7. Выйти и перезагрузить
exit
umount /mnt/dev /mnt/proc /mnt/sys
umount /mnt/boot  # если монтировали
umount /mnt
reboot
```

