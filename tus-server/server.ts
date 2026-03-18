// server.js
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });  // 用 process.cwd() 代替 __dirname

console.log("DEBUG: S3_IFC_BUCKET =", process.env.S3_IFC_BUCKET); // 👈 檢查這行有沒有印出東西

import express from 'express';
import cors from 'cors';
import { Server, EVENTS } from '@tus/server';
import { S3Store } from '@tus/s3-store';
import axios from 'axios';
import http from 'http';
import { Server as SocketServer } from 'socket.io';
import { QueueEvents } from 'bullmq'; 
import IORedis from 'ioredis';
import {nanoid} from 'nanoid';
import { PrismaClient } from './prisma/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { int } from 'zod';
// 初始化prisma
const adapter = new PrismaPg({connectionString:process.env.POSTGRESDB_URI});
const prisma = new PrismaClient({adapter});


const app = express();
// 建立 HTTP Server (為了綁定 WebSocket)
const server = http.createServer(app);

// 設定 Exporess CORS (關鍵！否則前端會被擋)
// 這裡我們允許來自 localhost:3000 的請求
const corsOptions = {
    origin: '*', 
    methods: ['GET', 'POST', 'PATCH', 'HEAD', 'OPTIONS', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Location', 'Tus-Resumable', 'Upload-Length', 'Upload-Metadata', 'Upload-Offset', 'Upload-Protocol', 'X-HTTP-Method-Override', 'Authorization'],
    exposedHeaders: ['Tus-Resumable', 'Upload-Length', 'Upload-Metadata', 'Upload-Offset', 'Upload-Protocol', 'Location', 'Upload-Expires'],
};

app.use(cors(corsOptions));

// 讓 Express 支援 JSON 解析 (為了接收 Worker 的通知)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const portStr: string = String(process.env.TUS_SERVER_PORT);
const PORT = parseInt(portStr || "3003", 10); // 我們讓這個服務預設跑在 3003 port
const HOST = "0.0.0.0"; // 這樣不管是 localhost 還是 Docker 內部網路都能連上，而且前端連線時用的還是 localhost:3003（因為我們在 docker-compose.yml 中做了 port mapping）
const WORKER_WEBHOOK_URL = `http://${process.env.IFC_FRAGS_CONVERT_WORKER_WEBHOOK_URL}/webhook/convert` || 'http://localhost:3005/webhook/convert';
const TUS_Server_URL = `${process.env.TUS_SERVER_HOST}:${PORT}`;

// 初始化 Socket.io 並設定 Socket 關聯的 CORS Policy
const allowedOrigins = [
  `http://${HOST}:${PORT}`,        // 前端開發網址
  `http://${process.env.TUS_SERVER_URL}:${PORT}`,     // 另一個前端
  `http://${process.env.TARGET_HOST}:${PORT}`,     // 從環境變數讀取的 TUS 網址
];
const io = new SocketServer(server, {
    cors: {
        origin: "*", // 允許前端連線，先不放寬限制 *
        methods: ["GET", "POST"]
        // credentials: true       // OPTIONS: 如果你有用到 Cookie 或 Authorization Header 建議加上
    }
});

// 監聽 Socket 連線 (Debug 用)
io.on('connection', (socket:any) => {
    console.log(`🔌 [Socket] 前端已連線: ${socket.id}`);
});

// 設定 Tus 儲存方式 (存到 MinIO)
// 新版的 @tus/s3-store 中，你通常不需要手動 new S3Client() 再傳進去，
// 而是直接在 s3ClientConfig 物件中傳入 AWS 的設定參數，S3Store 內部會幫你建立 Client
const S3_Endpoint_str = `http://${process.env.S3_HOST}:${process.env.S3_PORT}`;  // 需要加上 http:// 避免host&port 在S3Store 類別中錯誤使用
const store = new S3Store({
    partSize: 5 * 1024 * 1024, // 設定每個分片 5MB (保護上傳記憶體穩定)
    s3ClientConfig:{
        bucket: process.env.S3_IFC_BUCKET!,
        region: process.env.S3_REGION,
        endpoint: S3_Endpoint_str ,
        credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY!,
            secretAccessKey: process.env.S3_SECRET_KEY!,
        },
        forcePathStyle: true, // MinIO 必須設為 true
    } 
});

// 建立 Tus Server 實例
const tusServer = new Server({
    path: '/files',
    datastore: store,
    respectForwardedHeaders: true,
});
// Redis 連線 (給 QueueEvents 用)
const redisEndpoint: string = String(process.env.REDIS_HOST || 'localhost');
const redisportStr: string = String(process.env.REDIS_PORT);
const redisConnection = new IORedis({
    host: redisEndpoint,
    port: parseInt(redisportStr || "6379"),
    maxRetriesPerRequest: null,
});
// 初始化 QueueEvents 監聽器
// 自動連上 Redis，並監聽所有動靜。
// 名稱按照ENV 設置，tus-server 和 ifc-convert-frags-server 同步
const ifcConversionQueue = String(process.env.IFC_CONVERSION_Q);
const queueEvents = new QueueEvents(ifcConversionQueue || 'ifc-conversion-queue', { 
    connection: redisConnection 
});
// 監聽「進度更新」事件
queueEvents.on('progress', ({ jobId, data }:{jobId:string, data:any}) => {
    // jobId: 我們剛剛強制設成了 fileKey (e.g., 'e97210...')
    // data: 就是 worker 裡回報的數字 (e.g., 45)
    
    // console.log(`📊 [Redis] Job ${jobId} 進度: ${data}%`); // Debug 用

    // 透過 Socket 廣播給前端
    io.emit('conversion-progress', {
        fileId: jobId, // 這裡就是 fileKey
        progress: data
    });
});
// 先定義 API 路由 (給 Worker 用的)
// 這樣可以確保 Tus 的 handle 不會對這個請求造成任何干擾
app.post('/notify/done', (req:any, res:any)=> {
    // Debug 用：印出收到的東西，確認 body 是否存在
    console.log("📨 [Debug] /notify/done headers:", req.headers['content-type']);
    console.log("📨 [Debug] /notify/done body:", req.body);
    // 防呆：如果 body 還是 undefined (極端情況)，手動處理或報錯
    if (!req.body) {
        console.error("❌ [Error] req.body is undefined!");
        return res.status(400).json({ error: "No body received" });
    }
    const {  fileKey, fileName, status, message, size } = req.body;
    
    console.log(`📣 [Tus] 收到 Worker 完成通知: ${fileName} (${status})`);

    // 透過 WebSocket 通知前端
    io.emit('conversion-complete', {
        fileName:fileName,
        fileId: fileKey,
        status: status, // 'success' or 'error'
        message: message,
        fragUrl: `/frags/${fileKey}.frag`,// 假設你有對應的下載路由
        ifcUrl: `/ifcfiles/${fileKey}`,
        size: size
    });

    res.json({ received: true });
});

// 監聽「上傳完成」事件
tusServer.on(EVENTS.POST_FINISH, async(req:any, res:any, upload:any) => {
    const fileId = upload.id;
    // 取得檔名 (Uppy 預設會把檔名放在 metadata.filename)
    const fileName = upload.metadata?.filename;

    const userId = upload.metadata?.userid;
    console.log("DEBUG: metadata received:", upload.metadata);

    if (fileName) {
        console.log(`✅ [Tus] 上傳成功: ${fileName}(ID: ${fileId})`);
        
        // 只有 IFC 檔案才通知 Worker
        if (fileName.toLowerCase().endsWith('.ifc')) {
            console.log(`📞 [Tus] 正在通知 Worker 處理: ${fileName}...`);
            
            try{
                const newModel = await prisma.model.create({
                    data:{
                        shortId: nanoid(10),
                        name: fileName,
                        fileId: fileId,
                        status:'processing',
                        ...(userId && {// 連結到使用者 (如果 userId 存在)
                            uploader:{
                                connect:{ id:userId }
                            }
                        })
                    }
                });
                console.log(`📝 [DB] 模型已建立: ${newModel.name} (DB_ID: ${newModel.id})`);

                axios.post(WORKER_WEBHOOK_URL, {
                    fileKey:fileId,
                    fileName:fileName,
                    dbId: newModel.id
                });
                console.log(`📨 [Tus] 通知 Worker 成功！`);
            }catch(err: any){
                if(err) console.error(`❌ [Tus] DB 寫入或通知失敗:`, err.message);
                
            }
        }
    }
});

// 掛載上傳路由
// 注意：Tus 需要處理 HEAD, PATCH, POST 等請求，所以用 app.all
// 處理 "建立上傳" (POST /files)
// 處理 "後續操作" (PATCH/HEAD/DELETE /files/xxxx)
app.post(/files/, (req: any, res: any) => {
    const path = req.url || "none"; // 例如 "/api/hello?name=next"
    console.log(`[Tus] Receive files requestion POST ... ${path}`);
    tusServer.handle(req, res);
});
app.patch(/files/, (req: any, res: any) => {
    const path = req.url || "none"; // 例如 "/api/hello?name=next"
    console.log(`[Tus] Receive files requestion PATCH ... ${path}`);
    tusServer.handle(req, res);
});
app.head(/files/, (req: any, res: any) => {
    const path = req.url || "none"; // 例如 "/api/hello?name=next"
    console.log(`[Tus] Receive files requestion HEAD ... ${path}`);
    tusServer.handle(req, res);
});
app.delete(/files/, (req: any, res: any) => {
    const path = req.url || "none"; // 例如 "/api/hello?name=next"
    console.log(`[Tus] Receive files requestion DELETE ... ${path}`);
    tusServer.handle(req, res);
});

// 拒絕其他所有請求 (GET, POST, etc.)
// app.all(/(.*)/, (req, res) => {
//     res.status(403).json({
//         success: false,
//         message: `${process.env.TUS_SERVER_HOST} 無法受理此請求 (Request Not Accepted)`,
//         timestamp: new Date().toISOString()
//     });
// });

// 啟動伺服器
server.listen(PORT, HOST, () => {
    console.log(`--------------------------------------------------`);
    console.log(`📂 Connecting to MinIO at: ${process.env.S3_ENDPOINT}`);
    console.log(`📦 Target Bucket: ${process.env.S3_IFC_BUCKET }`);
    console.log(`🔗 Worker Webhook Target: ${WORKER_WEBHOOK_URL}`);
    console.log(`🚀 Tus Server + Socket running on http://localhost:${PORT}`);
    console.log(`--------------------------------------------------`);
});