//hero.ts
import {heroui} from "@heroui/react";

export default heroui({
    themes: {
        light: {
        colors: {
            // 這裡修改你想要的 primary 顏色
            warning: {
            DEFAULT: "#FF5733",    // 主色 (例如：亮橘色)
            foreground: "#FFFFFF", // 主色按鈕上的文字顏色
            },
            // 你也可以修改 secondary, success, warning, danger 等
        },
        },
        dark: {
        colors: {
            warning: {
            DEFAULT: "#FFC300",    // 暗黑模式下的主色 (例如：亮黃色)
            foreground: "#000000",
            },
        },
        },
    },
});