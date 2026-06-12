const isTest = !!process.env.VITEST || process.env.NODE_ENV === "test";

const config = isTest
  ? { plugins: [] }
  : {
      plugins: ["@tailwindcss/postcss"],
    };

export default config;
