import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 針對 next/image 的設定
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "127.0.0.1", // <--- 這裡也要改！
        port: "9000",
        pathname: "/**",
      },
      {
        protocol: "http",      // 開發環境 MinIO 通常是 http
        hostname: "localhost", // 你的 MinIO 主機
        port: "9000",          // 你的 MinIO port
        pathname: "/**",       // 允許所有路徑
      },
      // 💡 預留區：等你上正式環境 (Production) 時，記得把正式網域也加進來
      // {
      //   protocol: "https",
      //   hostname: "your-production-minio.com",
      //   pathname: "/**",
      // },
    ],
  },
};

export default nextConfig;
