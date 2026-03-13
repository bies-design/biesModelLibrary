import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import * as Minio from 'minio';
import { Job, JobScheduler, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from './prisma/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// 引入核心套件 (ESM)
import * as FRAGS from "@thatopen/fragments";
import * as WEBIFC from "web-ifc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 讀取上一層的 .env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

//初始化prisma
const adapter = new PrismaPg({ connectionString: process.env.POSTGRESDB_URI});
const prisma = new PrismaClient({ adapter });

// === Redis 連線設定 ===
// 這是 BullMQ 用來連線 Redis 
const redisEndpoint: string = String(process.env.REDIS_HOST || 'localhost');
const redisportStr: string = String(process.env.REDIS_PORT);
const redisConnection = new IORedis({
    host: redisEndpoint,
    port: parseInt(redisportStr || '6379', 10),
    maxRetriesPerRequest: null, // BullMQ 要求必須設為 null
})

// === 1. 初始化 MinIO 客戶端 ===
const s3Endpoint: string = String(process.env.S3_HOST || 'localhost');
const s3portStr: string = String(process.env.S3_PORT); 
const minioClient = new Minio.Client({
    endPoint: s3Endpoint,               // 沒有 http:// or https:// 前墜，直接主機名稱或 IP
    port: parseInt(s3portStr || '9000', 10),
    useSSL: false,
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY
});

const IFC_BUCKET = process.env.S3_IFC_BUCKET;
const FRAG_BUCKET = process.env.S3_FRAGS_BUCKET;

// === 2. 初始化 IfcImporter ===
const serializer = new FRAGS.IfcImporter();
serializer.wasm.path = "/"

// bull module 是直接輔助node 使用和管理 Redis I/O 
// 這個 Queue 用來讓 Webhook 把任務丟進去
// 名稱按照ENV 設置，tus-server 和 ifc-convert-frags-server 同步
const ifcConversionQueue4jobs = String(process.env.IFC_CONVERSION_Q);
const conversionQueue = new Queue(ifcConversionQueue4jobs || 'ifc-conversion-queue', { 
    connection: redisConnection 
});

const str_Ifc2FragsConvertPort = String(process.env.IFC_FRAGS_CONVERT_WORKER_PORT);
const PORT = parseInt(str_Ifc2FragsConvertPort || "3005");

async function executeConversionTask(job:any, fileKey:any, fileName:any, dbId:any) {
    console.log(`🚀 [Job Start] 開始處理: ${fileName} (Key: ${fileKey})(DB_ID:${dbId})`);
    
    // 1. 下載 IFC
    const stat = await minioClient.statObject(IFC_BUCKET as any, fileKey);
    const totalSize = stat.size;
    let downloadedSize = 0;

    console.log(`⬇️ [MinIO] 正在下載...`);
    const fileStream = await minioClient.getObject(IFC_BUCKET as any, fileKey);
    const chunks = [];
    for await (const chunk of fileStream) {
        chunks.push(chunk);
        downloadedSize += chunk.length;

        // 下載進度：0% ~ 40%
        const percentage = Math.round((downloadedSize / totalSize) * 40);

        // 簡單節流：每 5% 更新一次
        if (percentage % 10 === 0){
            await job.updateProgress(percentage);
        }
    }

    const fileBuffer = Buffer.concat(chunks);
    console.log(`📦 [Worker] 下載完成，大小: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB `);

    // ==========================================
    // ⚙️ 轉換階段 (使用 progressCallback)
    // ==========================================
    console.log(`⚙️ [Convert] 開始轉檔 (.frag)...`);
    // 定義節流變數，避免 Redis 被call爛
    let lastReportTime = 0;
    const start = performance.now();
    
    const modelData = await serializer.process({
        bytes: new Uint8Array(fileBuffer),
        progressCallback:(progress)=>{
            //progress 0-1
            const now = Date.now();
            // 節流：每 1 秒才允許更新一次 Redis
            if((now - lastReportTime) > 1000){
                lastReportTime = now;

                // 轉換階段進度映射：40% ~ 90%
                // 公式： 40 + (progress * 0.5)
                const totalProgress = Math.round(40 + (progress * 50));

                job.updateProgress(totalProgress).catch((e:any) => console.error(e));
            }
            console.log(`正在進行${job.id}轉檔,總進度為${progress}`);
        }
    });
    const duration = (performance.now() - start) / 1000;
    console.log(`✅ [Convert] 轉檔成功！耗時: ${duration.toFixed(2)}s`);
    // ==========================================
    // ⬆️ 上傳階段
    // ==========================================
    // 手動更新到 90% (轉檔完成)
    await job.updateProgress(90);
    const fragKey = fileKey + '.frag'; 
    const fragBuffer = Buffer.from(modelData);

    const bucketExists = await minioClient.bucketExists(FRAG_BUCKET as any);
    if (!bucketExists) {
        await minioClient.makeBucket(FRAG_BUCKET as any);
    }

    console.log(`⬆️ [MinIO] 上傳 .frag 檔案: ${fragKey}`);
    await minioClient.putObject(FRAG_BUCKET as any, fragKey, fragBuffer);

    if(dbId){
        try{
            await prisma.model.update({
                where:{id:dbId},
                data:{
                    status:'completed',
                    size:totalSize.toString()
                }
            });
            console.log(`📝 [DB] Model ${fragKey}狀態更新為 Completed`);
        }catch(e:any){
            console.error(`⚠️ [DB] Model ${fragKey} 更新狀態失敗: ${e.message}`)
        }
    }

        // 完成！更新到 100%
    await job.updateProgress(100);

    console.log(`🎉 [Job Done] 任務完成！`);
    return { fileKey, fileName, fragKey, totalSize }; // 回傳結果給 Worker 事件
}

// bull module 是直接輔助node 使用和管理 Redis I/O 
// 會去檢查redis還有沒有工作，並在背景「一個接一個」執行任務；如同工人一樣
// 名稱按照ENV 設置，tus-server 和 ifc-convert-frags-server 同步
const ifcConversionQueue2Work = String(process.env.IFC_CONVERSION_Q);
const worker = new Worker(ifcConversionQueue2Work || 'ifc-conversion-queue', async (job) => {
    // job.data 包含我們在 Webhook 裡丟進去的 { fileKey, fileName }
    const { fileKey, fileName, dbId } = job.data;
    
    // 執行轉檔
    return await executeConversionTask(job, fileKey, fileName, dbId);

}, {
    connection: redisConnection,
    concurrency: 1 // 🔥 關鍵！同時只能有 1 個任務在跑 (避免 OOM)
});

// 監聽 Worker 事件 (通知 Tus Server)

// 成功時通知
worker.on('completed', async (job, result) => {
    const { fileKey, fileName } = job.data;
    console.log(`📞 [Worker] Job ${job.id} 完成，通知 Tus Server...`);

    try {
        const tusServUrl = "http://" + String(process.env.TUS_SERVER_HOST) +
         ":" + String(process.env.TUS_SERVER_PORT) + "/notify/done";
        await fetch(tusServUrl || 'http://localhost:3003/notify/done', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fileKey: fileKey,
                fileName: fileName,
                status: 'success',
                size: result.totalSize.toString()
            })
        });
    } catch (e:any) {
        console.error("❌ 無法通知 Server (Success):", e.message);
    }
});
// 失敗時通知
worker.on('failed', async (job, err) => {
    if(!job) return;
    const { fileKey, fileName, dbId } = job.data;
    console.error(`❌ [Worker] Job ${job.id} 失敗: ${err.message}`);

    if(dbId){
        try {
            await prisma.model.update({
                where:{id:dbId},
                data:{
                    status:'error',
                    errorMessage:err.message
                }
            });
            console.log(`📝 [DB] ${dbId} 狀態更新為 Error`);
        }catch(dbErr:any){
            console.error(`⚠️ [DB] ${dbId} 更新失敗狀態錯誤: ${dbErr.message}`);
        }
    }
    try {
        const tusServUrl = "http://" + String(process.env.TUS_SERVER_HOST) +
         ":" + String(process.env.TUS_SERVER_PORT) + "/notify/done";
        await fetch(tusServUrl || 'http://localhost:3003/notify/done', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fileKey: fileKey,
                fileName: fileName,
                status: 'error',
                message: err.message
            })
        });
    } catch (e:any) {
        console.error("❌ 無法通知 Server (Error):", e.message);
    }
});

// === 設定 Web Server(Webhook 入口) ===
const app = express();
app.use(cors());
app.use(bodyParser.json());

app.post('/webhook/convert', async(req, res) => {
    const { fileKey, fileName, dbId } = req.body;
    
    if (!fileKey || !fileName) {
        return res.status(400).send({ error: 'Missing fileKey or fileName' });
    }

    // 把任務加入佇列，然後馬上回應
    try {
        await conversionQueue.add('convert-job', { 
            fileKey, 
            fileName,
            dbId
        },{
            jobId: fileKey, //強制把 Job ID 設定成跟 fileKey 一樣！
            // 設定自動清理 (重要!!!!!!)
            removeOnComplete: {
                age: 3600, // 保留 1 小時內的紀錄 (秒)
                count: 100 // 或者最多保留最新的 100 筆
            },
            removeOnFail: {
                age: 24 * 3600, // 失敗的保留 24 小時讓我們查修
                count: 50
            }
        });

        console.log(`📨 [Webhook] 已將 ${fileName} 加入佇列等待處理(DB_ID: ${dbId})`);
        
        // 這裡回應 200，告訴 Tus Server "我收到了，正在排隊中"
        // 前端會顯示 "Converting..." (因為 Tus Server 尚未廣播 success)
        res.status(200).send({ status: 'Queued', message: 'Job added to queue' });

    } catch (err) {
        console.error("❌ 無法加入佇列:", err);
        res.status(500).send({ error: 'Queue Error' });
    }
});

// 拒絕其他所有請求 (GET, POST, etc.)
app.all(/(.*)/, (req, res) => {
    res.status(403).json({
        success: false,
        message: `${process.env.IFC_FRAGS_CONVERT_WORKER_HOST} 無法受理此請求 (Request Not Accepted)`,
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`--------------------------------------------------`);
    console.log(`👷 IfcImporter Worker (ESM) Listening on port ${PORT}`);
    console.log(`👷 IfcImporter Work List on port ${redisConnection.options.port}`);
    console.log(`🐂 BullMQ Worker Started with Concurrency: 1`);
    console.log(`--------------------------------------------------`);
});