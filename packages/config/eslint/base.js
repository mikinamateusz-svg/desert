/** @type {import("eslint").Linter.Config} */
module.exports = [
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      "no-console": "warn",
      "no-unused-vars": "off", // handled by @typescript-eslint
    },
  },
];
