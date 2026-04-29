#!/usr/bin/env bash
# 01-recon.sh — Read-only inventory of the freshly provisioned VM.
# Usage from local Mac:   ssh root@178.105.4.16 'bash -s' < scripts/01-recon.sh
# Writes nothing. Result emitted as structured sections on stdout.

set -u

echo "==================== System ===================="
echo "Hostname:       $(hostname)"
echo "Distribution:   $(lsb_release -ds 2>/dev/null || cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2-)"
echo "Kernel:         $(uname -srm)"
echo "Architecture:   $(uname -m)"
echo "Uptime:         $(uptime -p)"
echo "Timezone:       $(timedatectl | grep 'Time zone' | awk '{print $3}')"
echo

echo "==================== CPU and Memory ===================="
echo "CPU cores:      $(nproc)"
echo "Memory:"
free -h | sed 's/^/  /'
echo

echo "==================== Block devices ===================="
lsblk -o NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,UUID
echo
echo "Disk usage:"
df -h --output=source,size,used,avail,pcent,target | grep -v tmpfs | sed 's/^/  /'
echo

echo "==================== Network ===================="
echo "IPv4 addresses:"
ip -4 addr show | grep -E 'inet ' | awk '{print "  " $NF " -> " $2}'
echo "IPv6 addresses:"
ip -6 addr show | grep -E 'inet6 ' | grep -v 'scope link' | awk '{print "  " $NF " -> " $2}'
echo "Default routes:"
ip route show default | sed 's/^/  /'
echo

echo "==================== SSH configuration ===================="
echo "Active sshd directives (selection):"
grep -E '^(Port|PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|AllowUsers)' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null | sed 's/^/  /' || echo "  (no override file found)"
echo "Authorized keys for root:"
if [ -f /root/.ssh/authorized_keys ]; then
  awk '{print "  " $1 " " $3}' /root/.ssh/authorized_keys
else
  echo "  /root/.ssh/authorized_keys not found"
fi
echo

echo "==================== Firewall ===================="
if command -v ufw >/dev/null 2>&1; then
  echo "ufw present:"
  ufw status verbose | sed 's/^/  /'
else
  echo "ufw not installed"
fi
echo
if command -v iptables >/dev/null 2>&1; then
  echo "iptables rules (full):"
  iptables -L -n | sed 's/^/  /' | head -40
fi
echo

echo "==================== Packages and updates ===================="
echo "Pending updates:"
apt list --upgradable 2>/dev/null | tail -n +2 | wc -l | awk '{print "  " $1 " packages upgradable"}'
echo "unattended-upgrades:"
if dpkg -l unattended-upgrades 2>/dev/null | grep -q '^ii'; then
  echo "  installed"
  if [ -f /etc/apt/apt.conf.d/20auto-upgrades ]; then
    echo "  20auto-upgrades:"
    cat /etc/apt/apt.conf.d/20auto-upgrades | sed 's/^/    /'
  fi
else
  echo "  NOT installed"
fi
echo

echo "==================== Docker and Compose ===================="
if command -v docker >/dev/null 2>&1; then
  echo "Docker:        $(docker --version)"
else
  echo "Docker:        NOT installed"
fi
if docker compose version >/dev/null 2>&1; then
  echo "Compose:       $(docker compose version --short 2>/dev/null) (plugin)"
else
  echo "Compose:       NOT installed"
fi
echo

echo "==================== Users ===================="
echo "Local users with login shell:"
awk -F: '$7 ~ /\/(bash|zsh|sh)$/ && $3 >= 1000 || $1 == "root" {print "  " $1 " (uid " $3 ", shell " $7 ")"}' /etc/passwd
echo

echo "==================== Cron and systemd timers ===================="
echo "Active systemd timers:"
systemctl list-timers --no-pager 2>/dev/null | head -20 | sed 's/^/  /'
echo
echo "root crontab:"
crontab -l 2>/dev/null | sed 's/^/  /' || echo "  (no root crontab)"
echo

echo "==================== Inventory complete ===================="
