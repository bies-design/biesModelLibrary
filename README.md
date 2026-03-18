# Bies Modle Library

## Dockerize
當前支援的專案取向
```bash
1. prod: docker-compose.yml
2. staging: docker-compose-staging.yml
```

## Get Start
setting env
```bash
cp .env.example .env
vim .env          # <--可以用任何你習慣的文字編輯器
```

staging 
```bash
docker compose -f docker-compose-staging.yml up -d
```

 create image (only for prod.) ... not ready
```bash
docker compose build
```

 prod ... not ready
```bash
docker compose up -d
```

## Manager
> 以下都是預設的說明方式，請按照當前.env 設定調整<br/>
1. MinIO (原生後台)
```bash
http://localhost:9001 
account: S3_ACCESS_KEY
password: S3_SECRET_KEY
```

2. PostgresSQL --> Adminer
```bash
http://localhost:6543
資料庫系統:[PostgreSQL v]
伺服器    :[PostgresSQL]
帳號      :[POSTGRESDB_USER]
密碼      :[POSTGRESDB_PASSWORD]
資料庫    :[POSTGRESDB_DB]
```

3. Redis --> redis-insight
```bash
http://localhost:9527
>>> switch...
1. Use recommened settings
2. I have read and understood the Terms
>>> Submit
>>> + Connect existing database
Connection URL: {
  redis://default@REDIS_HOST:REDIS_SRV_PORT
}
>>> Add database
```
接下來就點擊剛剛建立好的連線設置