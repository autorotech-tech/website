# Безопасное монтирование нового раздела на рабочем сервере

## 🎯 Цель:
Примонтировать новый раздел, который вы докупили у провайдера, **НЕ сломав** существующую систему.

## ⚠️ КРИТИЧЕСКИ ВАЖНО:
- Это **рабочий сервер** с запущенными сервисами
- **НЕ форматируйте** существующие разделы
- **НЕ удаляйте** строки из /etc/fstab
- **Делайте backup** перед изменениями

## 📋 Пошаговая инструкция:

### Шаг 1: Войти в chroot (если еще не вошли)

```bash
# В rescue mode
mount /dev/sda3 /mnt
mount --bind /dev /mnt/dev
mount --bind /proc /mnt/proc
mount --bind /sys /mnt/sys
chroot /mnt /bin/bash
```

### Шаг 2: Найти новый раздел

```bash
# Посмотреть все разделы с файловыми системами
lsblk -f

# Или более детально:
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT,UUID
```

**Что искать:**
- Раздел **БЕЗ MOUNTPOINT** (не примонтирован)
- Обычно это `sda4`, `sda5` или следующий номер
- Может быть без FSTYPE (если не отформатирован)

### Шаг 3: Если нового раздела НЕТ - создать его

```bash
# ⚠️ ВАЖНО: Сначала проверьте что есть свободное место!
fdisk -l /dev/sda
parted /dev/sda print free

# Если есть свободное место, создать раздел:
fdisk /dev/sda

# В интерактивном режиме fdisk:
# p - посмотреть текущие разделы
# n - создать новый раздел
# p - primary partition
# 4 - номер раздела (или следующий доступный)
# Enter - начальный сектор (автоматически после последнего раздела)
# Enter - конечный сектор (использовать все доступное место)
# w - записать изменения и выйти

# После создания проверить:
lsblk -f
# Должен появиться sda4 (или другой номер)
```

### Шаг 4: Определить тип файловой системы нового раздела

```bash
# Замените sdaX на номер вашего нового раздела
blkid /dev/sdaX
```

**Результаты:**
- Если показывает UUID и TYPE - раздел **отформатирован**
- Если показывает только DEVICE - раздел **НЕ отформатирован**

### Шаг 5: Если раздел НЕ отформатирован

```bash
# ⚠️ ВНИМАНИЕ: Убедитесь что это правильный раздел!
# Проверьте размер: должен соответствовать докупленному месту

# Отформатировать в ext4 (рекомендуется)
mkfs.ext4 /dev/sdaX

# Или в xfs (если предпочитаете)
# mkfs.xfs /dev/sdaX
```

### Шаг 6: Создать точку монтирования

```bash
# Выберите место для монтирования
# Варианты:
# - /storage (для дополнительного хранилища)
# - /data (для данных)
# - /mnt/storage (временное)

mkdir -p /storage
```

### Шаг 7: Примонтировать раздел

```bash
# Временно примонтировать для проверки
mount /dev/sdaX /storage

# Проверить что примонтировалось
df -h | grep storage
ls -la /storage
```

### Шаг 8: Получить UUID раздела

```bash
blkid /dev/sdaX
# Запишите UUID (например: UUID="12345678-1234-1234-1234-123456789abc")
```

### Шаг 9: Добавить в /etc/fstab для автозагрузки

```bash
# 1. Сделать backup
cp /etc/fstab /etc/fstab.backup.$(date +%Y%m%d_%H%M%S)

# 2. Отредактировать fstab
nano /etc/fstab
# или
vi /etc/fstab

# 3. Добавить в КОНЕЦ файла (НЕ удаляя существующие строки!):
UUID=ваш-uuid-здесь  /storage  ext4  defaults  0  2

# Формат строки:
# UUID=<uuid>  <mount_point>  <filesystem>  <options>  <dump>  <pass>
# 
# Параметры:
# - defaults: стандартные опции (rw, suid, dev, exec, auto, nouser, async)
# - 0: не делать backup через dump
# - 2: проверять файловую систему при загрузке (после root, который имеет 1)
```

**Пример правильной строки:**
```
UUID=550e8400-e29b-41d4-a716-446655440000  /storage  ext4  defaults  0  2
```

### Шаг 10: Проверить перед перезагрузкой

```bash
# 1. Проверить синтаксис /etc/fstab
mount -a

# Если ошибок нет - все ОК
# Если есть ошибки - исправить немедленно!

# 2. Проверить что раздел примонтирован
df -h | grep storage
mount | grep storage

# 3. Установить права доступа
chown vladx:vladx /storage
chmod 755 /storage

# 4. Создать тестовый файл
echo "test" > /storage/test.txt
cat /storage/test.txt
rm /storage/test.txt
```

### Шаг 11: Выйти из chroot и перезагрузить

```bash
# Выйти из chroot
exit

# Отмонтировать все
umount /mnt/dev
umount /mnt/proc
umount /mnt/sys
umount /mnt

# Перезагрузить сервер в обычном режиме
reboot
```

## 🔍 Примеры вывода команд:

### lsblk:

```
NAME   SIZE FSTYPE MOUNTPOINT UUID
sda    75G
├─sda1  1M                     (BIOS boot)
├─sda2  2G  ext4   /boot       abc-123-def
├─sda3 73G  ext4   /           xyz-456-ghi
└─sda4 50G                     <-- НОВЫЙ РАЗДЕЛ (без MOUNTPOINT)
```

В этом случае `sda4` - новый раздел для монтирования.

### fdisk -l (показывает свободное место):

```
Disk /dev/sda: 100 GiB, 107374182400 bytes  <-- ОБЩИЙ РАЗМЕР
...
Device     Start       End   Sectors  Size Type
/dev/sda1   2048      4095      2048    1M BIOS boot
/dev/sda2   4096   4196351   4192256    2G Linux filesystem
/dev/sda3  4196352 157286399 153090048   73G Linux filesystem
                                    ^^^^  <-- КОНЕЦ sda3
157286400 2147483647 1990197248  950G  <-- СВОБОДНОЕ МЕСТО!
```

В этом случае нужно создать sda4 на свободном месте.

### parted print free:

```
Number  Start   End     Size    Type     File system  Flags
 1      1049kB  2097kB  1049kB  primary
 2      2097kB  2147MB  2145MB   primary  ext4
 3      2147MB  80.5GB  78.4GB   primary  ext4
        80.5GB  100GB   19.5GB            free space  <-- СВОБОДНОЕ МЕСТО
```

В этом случае можно создать раздел на свободном месте (80.5GB - 100GB).

## ⚠️ Частые ошибки:

### ❌ НЕ ДЕЛАЙТЕ:
1. Форматировать существующие разделы (sda1, sda2, sda3)
2. Удалять строки из /etc/fstab
3. Монтировать новый раздел поверх существующих
4. Использовать `/dev/sdaX` вместо UUID в fstab (UUID надежнее)

### ✅ ДЕЛАЙТЕ:
1. Всегда делайте backup /etc/fstab
2. Проверяйте `mount -a` перед перезагрузкой
3. Используйте UUID в fstab (не /dev/sdaX)
4. Проверяйте размер раздела перед форматированием

## 🔐 Безопасность:

После монтирования можно настроить права:

```bash
# Для пользователя vladx
chown -R vladx:vladx /storage

# Для группы (если нужно)
chgrp -R vladx /storage

# Права доступа
chmod 755 /storage  # для директории
chmod 644 /storage/*  # для файлов (если нужно)
```

## 📝 После перезагрузки:

После перезагрузки сервера в обычном режиме:

```bash
# Проверить что раздел примонтирован автоматически
df -h | grep storage

# Проверить что сервисы работают
docker ps
systemctl status autoro-site
```

## 🎯 Резюме команд:

```bash
# В chroot после монтирования sda3
lsblk -f
blkid /dev/sda4  # замените на ваш номер
mkdir -p /storage
mount /dev/sda4 /storage
blkid /dev/sda4  # записать UUID
cp /etc/fstab /etc/fstab.backup
echo "UUID=<uuid>  /storage  ext4  defaults  0  2" >> /etc/fstab
mount -a
chown vladx:vladx /storage
chmod 755 /storage
```

