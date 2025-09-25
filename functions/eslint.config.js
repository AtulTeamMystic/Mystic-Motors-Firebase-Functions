// Migrated from .eslintrc.js for ESLint v9+

/** @type {import('eslint').Linter.FlatConfig} */
module.exports = [
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2018,
      sourceType: "module",
  // No explicit globals needed for most ES6+ code
  // If you need to add specific globals, do so here
  globals: {},
    },
    plugins: {},
    rules: {
      "no-restricted-globals": ["error", "name", "length"],
      "prefer-arrow-callback": "error",
      "quotes": ["error", "double", {"allowTemplateLiterals": true}],
    },
  },
  {
    files: ["**/*.spec.*"],
    languageOptions: {
      globals: {
        mocha: true,
      },
    },
    rules: {},
  },
];
