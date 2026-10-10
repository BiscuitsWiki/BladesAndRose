#!/bin/sh
# 「血与刃的白蔷薇」账号表备份（服务器上由 root cron 每天执行）
#
#   安装：sudo cp backup-accounts.sh /opt/bar/backup-accounts.sh && sudo chmod +x /opt/bar/backup-accounts.sh
#   定时：sudo crontab -e  →  30 3 * * * /opt/bar/backup-accounts.sh >> /var/log/bar-backup.log 2>&1
#   恢复：sudo cp /opt/backup/bar/accounts-<时间戳>.json /var/lib/docker/volumes/bar_data/_data/accounts.json
#
# 账号表是容器内唯一需要长期保留的数据（对局与房间都在内存里，重启即清空）；
# 文件本身很小（几百字节～几 KB），因此直接按份留存最近 14 份、按时间倒序裁剪。
set -eu

SRC=/var/lib/docker/volumes/bar_data/_data/accounts.json
DEST=/opt/backup/bar
KEEP=14

if [ ! -f "$SRC" ]; then
  echo "$(date '+%F %T') 未找到账号表 $SRC，跳过本次备份"
  exit 0
fi

mkdir -p "$DEST"
STAMP=$(date '+%F-%H%M%S')
cp "$SRC" "$DEST/accounts-$STAMP.json"

# 只保留最近 $KEEP 份（ls -t 按修改时间倒序）
ls -1t "$DEST"/accounts-*.json 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f "$old"
done

echo "$(date '+%F %T') 已备份 $SRC → $DEST/accounts-$STAMP.json（保留最近 $KEEP 份）"