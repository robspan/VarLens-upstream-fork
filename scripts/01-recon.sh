#!/usr/bin/env bash
# 01-recon.sh — Read-only Bestandsaufnahme der frisch provisionierten VM.
# Aufruf vom lokalen Mac:   ssh root@178.105.4.16 'bash -s' < scripts/01-recon.sh
# Schreibt nichts. Ergebnis als strukturierte Sektionen auf stdout.

set -u

echo "==================== System ===================="
echo "Hostname:       $(hostname)"
echo "Distribution:   $(lsb_release -ds 2>/dev/null || cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2-)"
echo "Kernel:         $(uname -srm)"
echo "Architektur:    $(uname -m)"
echo "Uptime:         $(uptime -p)"
echo "Timezone:       $(timedatectl | grep 'Time zone' | awk '{print $3}')"
echo

echo "==================== CPU und Speicher ===================="
echo "CPU-Cores:      $(nproc)"
echo "Speicher:"
free -h | sed 's/^/  /'
echo

echo "==================== Block-Devices ===================="
lsblk -o NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,UUID
echo
echo "Disk-Belegung:"
df -h --output=source,size,used,avail,pcent,target | grep -v tmpfs | sed 's/^/  /'
echo

echo "==================== Netzwerk ===================="
echo "IPv4-Adressen:"
ip -4 addr show | grep -E 'inet ' | awk '{print "  " $NF " -> " $2}'
echo "IPv6-Adressen:"
ip -6 addr show | grep -E 'inet6 ' | grep -v 'scope link' | awk '{print "  " $NF " -> " $2}'
echo "Default-Routen:"
ip route show default | sed 's/^/  /'
echo

echo "==================== SSH-Konfiguration ===================="
echo "Aktive sshd-Direktiven (Auswahl):"
grep -E '^(Port|PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|AllowUsers)' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null | sed 's/^/  /' || echo "  (keine override-Datei gefunden)"
echo "Authorized Keys für root:"
if [ -f /root/.ssh/authorized_keys ]; then
  awk '{print "  " $1 " " $3}' /root/.ssh/authorized_keys
else
  echo "  /root/.ssh/authorized_keys nicht gefunden"
fi
echo

echo "==================== Firewall ===================="
if command -v ufw >/dev/null 2>&1; then
  echo "ufw vorhanden:"
  ufw status verbose | sed 's/^/  /'
else
  echo "ufw nicht installiert"
fi
echo
if command -v iptables >/dev/null 2>&1; then
  echo "iptables-Regeln (gesamt):"
  iptables -L -n | sed 's/^/  /' | head -40
fi
echo

echo "==================== Pakete und Updates ===================="
echo "Geplante Updates:"
apt list --upgradable 2>/dev/null | tail -n +2 | wc -l | awk '{print "  " $1 " Pakete upgradebar"}'
echo "unattended-upgrades:"
if dpkg -l unattended-upgrades 2>/dev/null | grep -q '^ii'; then
  echo "  installiert"
  if [ -f /etc/apt/apt.conf.d/20auto-upgrades ]; then
    echo "  20auto-upgrades:"
    cat /etc/apt/apt.conf.d/20auto-upgrades | sed 's/^/    /'
  fi
else
  echo "  NICHT installiert"
fi
echo

echo "==================== Docker und Compose ===================="
if command -v docker >/dev/null 2>&1; then
  echo "Docker:        $(docker --version)"
else
  echo "Docker:        NICHT installiert"
fi
if docker compose version >/dev/null 2>&1; then
  echo "Compose:       $(docker compose version --short 2>/dev/null) (Plugin)"
else
  echo "Compose:       NICHT installiert"
fi
echo

echo "==================== Benutzer ===================="
echo "Lokale Benutzer mit Login-Shell:"
awk -F: '$7 ~ /\/(bash|zsh|sh)$/ && $3 >= 1000 || $1 == "root" {print "  " $1 " (uid " $3 ", shell " $7 ")"}' /etc/passwd
echo

echo "==================== Cron und Systemd-Timer ===================="
echo "Aktive systemd-Timer:"
systemctl list-timers --no-pager 2>/dev/null | head -20 | sed 's/^/  /'
echo
echo "Crontab root:"
crontab -l 2>/dev/null | sed 's/^/  /' || echo "  (keine root-Crontab)"
echo

echo "==================== Bestandsaufnahme abgeschlossen ===================="
