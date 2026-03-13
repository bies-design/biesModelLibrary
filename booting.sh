#!/bin/bash

## ARGC
ARGC=$1
SUB_ARGC=$2

## color
. /usr/local/bash_color.sh

# 執行網路配置
if [ -f "/usr/local/utility_loopback.sh" ]; then
    bash /usr/local/utility_loopback.sh
fi
printf "network ${Green} loopback ready ${NC} ...\n"

if [ -f "/usr/local/utility_namespace_dns.sh" ]; then
    bash /usr/local/utility_namespace_dns.sh
fi
printf "network ${Green} namespace ready ${NC} ...\n"

# 原有的啟動邏輯...

## task
printf "task receive ${Cyan} ${ARGC} ${NC} ...\n"

if [ "${ARGC}" == "dev" ]; then
    printf "task ${BIYellow} development ${NC} mode ...\n"
else
    printf "task ${BIYellow} production ${NC} mode ...\n"
fi

cd /usr/local/app

if [ -f "./${ARGC}" ]; then
    printf "task ${Blue} ${ARGC} ${NC} ${UPurple} start ... ${NC}\n"
    todos -d ./${ARGC}
    bash ./${ARGC} ${SUB_ARGC}
else
    printf "task ${Red} ${ARGC} not found ${NC} !\n"
fi
