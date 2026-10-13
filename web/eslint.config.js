// Lint rules for the frontend. Project rules from CLAUDE.md are enforced here so they do not depend
// on someone remembering them: student answers are shown to teachers, so HTML-string DOM APIs are
// banned (XSS), and the UI never uses blocking browser dialogs.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const HTML_SINKS = ["innerHTML", "outerHTML", "insertAdjacentHTML"].map((property) => ({
  property,
  message: "Build DOM with el() from dom.ts; HTML strings can run student-written script as the teacher.",
}));

export default tseslint.config(
  { ignores: ["dist/", "src/database.types.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "no-restricted-properties": ["error", ...HTML_SINKS, { object: "document", property: "write", message: "Use el()." }],
      "no-restricted-globals": ["error",
        ...["alert", "confirm", "prompt"].map((name) => ({ name, message: "Use an in-page message or confirmButton() from dom.ts." }))],
      "no-console": ["error", { allow: ["error", "warn"] }],
      eqeqeq: ["error", "always"],
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }], // async DOM handlers are fine
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["*.js"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: globals.node },
  },
);
