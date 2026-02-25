// hooks/useIntersectionObserver.ts
import { useEffect, useState, RefObject } from 'react';

export function useNativeInView(ref: RefObject<Element | null>, margin = '0px') {
    const [isIntersecting, setIntersecting] = useState(false);

    useEffect(() => {
        const target = ref.current;
        if (!target) return;

        // 呼叫瀏覽器原生的 API
        const observer = new IntersectionObserver(
        ([entry]) => {
            setIntersecting(entry.isIntersecting);
        },
        { rootMargin: margin }
        );

        observer.observe(target);
        
        // 組件卸載時清除監聽
        return () => observer.disconnect();
    }, [ref, margin]);

    return isIntersecting;
}