#!/bin/sh
set -eu
# This host's dedicated runner network; validate it again when recreating the network.
iptables -N DOCKER-USER 2>/dev/null || iptables -S DOCKER-USER >/dev/null
for destination in 169.254.0.0/16 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
  iptables -C DOCKER-USER -s 172.27.0.0/16 -d "$destination" -j REJECT 2>/dev/null ||
    iptables -I DOCKER-USER 1 -s 172.27.0.0/16 -d "$destination" -j REJECT
done
# Docker/AWS may resolve public names through a private resolver.
for protocol in udp tcp; do
  iptables -C DOCKER-USER -s 172.27.0.0/16 -p "$protocol" --dport 53 -j ACCEPT 2>/dev/null ||
    iptables -I DOCKER-USER 1 -s 172.27.0.0/16 -p "$protocol" --dport 53 -j ACCEPT
done
iptables -D INPUT -s 172.27.0.0/16 -p tcp -j REJECT 2>/dev/null || true
iptables -C INPUT -s 172.27.0.0/16 -p tcp ! --dport 53 -j REJECT 2>/dev/null ||
  iptables -I INPUT 1 -s 172.27.0.0/16 -p tcp ! --dport 53 -j REJECT
