const config = {
    plugins: {
        // Fix: @livekit/components-styles uses CSS Color Level 4 float values like
        // rgb(29.75, 29.75, 29.75). Tailwind v4's Lightning CSS parser rejects fractional
        // rgb(). This plugin runs BEFORE Tailwind and rounds floats to integers.
        "./postcss-round-rgb.cjs": {},
        "@tailwindcss/postcss": {},
    },
};

export default config;
