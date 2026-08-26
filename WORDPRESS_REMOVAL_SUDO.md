# Удаление WordPress файлов с правами доступа

## Проблема:
Файлы WordPress не удаляются из-за "Permission denied".

## Решение через sudo:

```bash
cd ~/projects/pquoc.com
sudo rm -rf wordpress wp-admin wp-content wp-includes
sudo rm -f wp-* index.php license.txt readme.html xmlrpc.php
ls -la  # проверить что осталось только html
```

## Альтернатива - изменить права:

```bash
cd ~/projects/pquoc.com
sudo chown -R vladx:vladx wordpress wp-* 2>/dev/null
rm -rf wordpress wp-admin wp-content wp-includes
rm -f wp-* index.php license.txt readme.html xmlrpc.php
```

## После удаления:

```bash
# Проверить что осталось
ls -la ~/projects/pquoc.com/

# Должно остаться только:
# - html/
# - html_backup_20250630_044839/
# - nginx-conf/
# - format_links_code.js
```

