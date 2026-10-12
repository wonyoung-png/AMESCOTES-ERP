#!/bin/sh
set -eu
test "$(docker network inspect ames-ads_default --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}')" = '172.27.0.0/16'
for destination in 169.254.0.0/16 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
  iptables -C DOCKER-USER -s 172.27.0.0/16 -d "$destination" -j REJECT
done
iptables -C INPUT -s 172.27.0.0/16 -p tcp ! --dport 53 -j REJECT
