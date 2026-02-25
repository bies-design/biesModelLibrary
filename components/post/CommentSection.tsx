// components/post/CommentSection.tsx
"use client";
import React, { useState } from 'react';

export default function CommentSection() {
    const [comment, setComment] = useState("");

    return (
        <div className="mt-8 pt-8 border-t border-[#3F3F46]">
            <h2 className="text-xl text-white mb-6">Comments <span className="text-[#A1A1AA] text-base">(0)</span></h2>
            <div className="flex gap-4 items-center">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-pink-500 to-yellow-500" />
                <input 
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    type="text" 
                    placeholder="Come and comment now" 
                    className="flex-1 bg-[#27272A] border border-[#3F3F46] rounded-full px-6 py-3 text-sm focus:border-[#D70036] outline-none"
                />
                <button className="bg-[#D70036] text-white px-6 py-3 rounded-full text-sm font-medium hover:bg-[#b0002c]">
                    Post
                </button>
            </div>
        </div>
    );
}