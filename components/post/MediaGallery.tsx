// components/post/MediaGallery.tsx
"use client";
import React, { useState, useRef } from 'react';
import Image from 'next/image';
import Viewer3D, { Viewer3DRef } from '@/components/viewer/Viewer3D';
import { Rotate3D, FileText } from 'lucide-react';

export default function MediaGallery({ post }: { post: any }) {
    const [activeSource, setActiveSource] = useState('cover'); // 'cover' | '3D' | idx
    const viewerRef = useRef<Viewer3DRef>(null);

    const minioUrl = process.env.NEXT_PUBLIC_S3_ENDPOINT || "http://127.0.0.1:9000";

    const handleLoad3D = async () => {
        setActiveSource('3D');
        // 等待下一幀以確保 Viewer3D 已掛載，然後載入模型
        setTimeout(async () => {
            if (post.models?.[0]) {
                const response = await fetch(`${minioUrl}/models/${post.models[0].fileKey}`);
                const buffer = await response.arrayBuffer();
                viewerRef.current?.loadModel(buffer, post.models[0].name);
            }
        }, 100);
    };

    return (
        <div className="flex flex-col gap-4">
            {/* 主展示區 */}
            <div className="w-full aspect-video bg-[#27272A] rounded-xl overflow-hidden relative border border-[#3F3F46]">
                {activeSource === '3D' ? (
                    <Viewer3D ref={viewerRef} allFiles={[]} />
                ) : (
                    <Image 
                        src={`${minioUrl}/images/${activeSource === 'cover' ? post.coverImage : post.images[activeSource as number]}`}
                        alt="Preview" fill className="object-cover" unoptimized 
                    />
                )}
            </div>

            {/* 縮圖輪播 */}
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                {/* 3D 入口 (如果是 3D 貼文) */}
                {post.type === '3D' && (
                    <div onClick={handleLoad3D} className={`w-[120px] shrink-0 aspect-video rounded-lg border-2 flex items-center justify-center bg-black/40 ${activeSource === '3D' ? 'border-[#D70036]' : 'border-transparent'}`}>
                        <Rotate3D className="text-white" />
                    </div>
                )}
                {/* 圖片縮圖 */}
                <div onClick={() => setActiveSource('cover')} className={`w-[120px] shrink-0 aspect-video relative rounded-lg border-2 ${activeSource === 'cover' ? 'border-[#D70036]' : 'border-transparent'}`}>
                    <Image src={`${minioUrl}/images/${post.coverImage}`} alt="thumb" fill className="object-cover rounded-md" unoptimized />
                </div>
            </div>
        </div>
    );
}