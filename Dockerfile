FROM node:24.14.0-slim

# 系統軟體
RUN apt-get update
RUN apt-get install -y \
    bash vim curl wget \
    procps net-tools \
    tzdata git tofrodos
RUN rm -rf /var/lib/apt/lists/*

# 專案支援
RUN mkdir -p /usr/local/app
WORKDIR /usr/local

## setting network
COPY utility_loopback.sh .
RUN chmod +x ./utility_loopback.sh

COPY utility_namespace_dns.sh .
RUN chmod +x ./utility_namespace_dns.sh

ENV PATH="${PATH}:/usr/local/bin"
RUN ls -l /usr/local/bin/ && echo "/usr/local/bin exist" || mkdir /usr/local/bin

COPY booting.sh .
COPY bash_color.sh .
RUN chmod +x ./booting.sh
RUN ln -s /usr/local/booting.sh /usr/local/bin/booting

## change CRLF to LF
RUN todos -d ./*.sh

# 设置虚拟显示环境变量
# ENV DISPLAY=":99"

# EXPOSE 80
# EXPOSE 3000

# ENTRYPOINT [ "./booting.sh" ]
