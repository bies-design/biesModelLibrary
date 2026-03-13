#!/bin/bash 
echo "start network default dns setting"

if [ -e "/run/systemd/resolve/resolv.conf" ]; then
  # if has default setting
  sed -i.bak 's/^DNS=/DNS=8.8.8.8 168.95.1.1 61.31.1.1 208.67.222.222 /g' "/run/systemd/resolve/resolv.conf" 2>&1
  # if no default setting
  sed -i.bak 's/^#DNS=.*/DNS=8.8.8.8 168.95.1.1 61.31.1.1 208.67.222.222/g' "/run/systemd/resolve/resolv.conf" 2>&1
  
elif [ ! -e "/etc/resolv.conf" ]; then
  touch /etc/resolv.conf
  chmod +rw /etc/resolv.conf
  echo "nameserver 8.8.8.8 " | tee -a /etc/resolv.conf >/dev/null
  echo "nameserver 168.95.1.1 " | tee -a /etc/resolv.conf >/dev/null
  echo "nameserver 61.31.1.1 " | tee -a /etc/resolv.conf >/dev/null
  echo "nameserver 208.67.222.222 " | tee -a /etc/resolv.conf >/dev/null
else
  cat /etc/resolv.conf
fi
