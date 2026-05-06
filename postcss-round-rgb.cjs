
module.exports = () => ({
    postcssPlugin: "round-rgb-floats",
    Declaration(decl) {
        if (/rgb\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*\)/.test(decl.value)) {
            decl.value = decl.value.replace(
                /rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g,
                (_, r, g, b) =>
                    `rgb(${Math.round(Number(r))}, ${Math.round(Number(g))}, ${Math.round(Number(b))})`
            );
        }
    },
});
module.exports.postcss = true;
