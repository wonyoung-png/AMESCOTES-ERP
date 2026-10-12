#!/bin/sh
set -eu
# This host's dedicated runner network; validate it again when recreating the network.
iptables -N DOCKER-USER 2>/dev/null || iptables -S DOCKER-USER >/dev/null
for destination in 169.254.0.0/16 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
  iptables -C DOCKER-USER -s 172.27.0.0/16 -d "$destination" -j REJECT 2>/dev/null ||
    iptables -I DOCKER-USER 1 -s 172.27.0.0/16 -d "$destination" -j REJECT
done
