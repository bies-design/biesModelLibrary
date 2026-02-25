// components/post/ActionButtons.tsx
"use client";
import React from 'react';
import { Download, Share2 } from 'lucide-react';
import { toast } from 'sonner'; // 建議安裝 sonner 做提示音

export default function ActionButtons({ post }: { post: any }) {
    const handleDownload = () => {
        const file = post.models?.[0] || post.pdfIds?.[0];
        if (file) {
            window.open(`${process.env.NEXT_PUBLIC_S3_ENDPOINT}/downloads/${file.fileKey}`, '_blank');
        }
    };

    const handleShare = () => {
        navigator.clipboard.writeText(window.location.href);
        toast.success("Link copied to clipboard!");
    };

    return (
        <div className="flex flex-col gap-3">
            <button onClick={handleDownload} className="w-full flex items-center justify-center gap-2 bg-[#D70036] hover:bg-[#b0002c] text-white py-3.5 rounded-xl font-medium transition active:scale-95">
                <Download size={18} /> Download
            </button>
            <button onClick={handleShare} className="w-full flex items-center justify-center gap-2 bg-[#27272A] hover:bg-[#3F3F46] text-white py-3.5 rounded-xl font-medium border border-[#3F3F46] transition active:scale-95">
                <Share2 size={18} /> Share Link
            </button>
        </div>
    );
} 