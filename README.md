# Bies Modle Library

## Dockerize
```bash
1. prod: docker-compose.yml
2. staging: docker-compose-staging.yml
```

## Get Start
> create image (可以跳過)
```bash
docker compose build
```

> staging
```bash
docker compose -f docker-compose-staging.yml up -d
```

> prod
```bash
docker compose up -ds
```