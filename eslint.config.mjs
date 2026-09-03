import js from '@eslint/js';
import globals from 'globals';

// LingKuma 的 lint 配置。
// 取向：规则要么能挡住真 bug，要么可 --fix 自动修；纯口味且与现存代码相反的规则一律不开，
// 避免为了迎合规范而产出成千上万行与功能无关的格式改动。
export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'docs/**',
      'scripts/**',
      // server/ 是独立 package（自带 package.json 与 Node 运行环境），不纳入扩展侧 lint
      'server/**',
      // 预编译/打包后的第三方库，由 CopyPlugin 原样复制，不参与 lint
      '**/*.min.js',
      'src/plugin/min/**',
      'src/utils/language-detector/**',
      'src/options/chars/**',
      'src/options/webdav/webdav.js'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      // 内容脚本是独立入口的普通脚本，不是 ES module
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.worker
      }
    },
    rules: {
      // 各 a*.js 内容脚本靠 window 隐式全局互相通信（highlightManager、fetchStructuredWordLookup 等），
      // 单文件静态分析无法感知，因此关掉未定义检查，避免整屏噪音掩盖真问题。
      'no-undef': 'off',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 存量代码里对普通对象字面量直接调 hasOwnProperty 的写法很多，且不存在原型污染风险，关掉
      'no-prototype-builtins': 'off',
      // 以下三条命中的都是存量代码里的既有写法（含刻意用 early return 停用的旧函数），
      // 降为 warn：既保留提示，也让 lint 在当前代码上可以作为「新代码不许再犯」的门禁使用
      'no-unreachable': 'warn',
      'no-async-promise-executor': 'warn',
      'no-constant-condition': 'warn',

      // 能挡住真 bug 的规则
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-fallthrough': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-else-if': 'error',
      'no-unsafe-negation': 'error',
      'no-await-in-loop': 'off',
      // 存量 parseInt 调用未显式传基数，ES5 之后不再解析八进制，风险低，仅提示
      radix: 'warn',

      // 可自动修复的格式规则，取值一律对齐仓库现存主流写法
      semi: ['error', 'always'],
      quotes: 'off',
      'comma-dangle': ['error', 'never'],
      'object-curly-spacing': ['error', 'always'],
      'arrow-parens': ['error', 'always'],
      'arrow-spacing': 'error',
      'comma-spacing': 'error',
      'key-spacing': 'error',
      'keyword-spacing': 'error',
      'space-before-blocks': 'error',
      'space-infix-ops': 'error',
      'space-before-function-paren': ['error', { anonymous: 'never', named: 'never', asyncArrow: 'always' }],
      'no-trailing-spaces': 'error',
      'no-multi-spaces': 'error',
      'spaced-comment': ['error', 'always', { markers: ['/'], exceptions: ['-', '=', '*'] }],
      'max-len': ['warn', {
        code: 140,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreRegExpLiterals: true,
        ignoreComments: true
      }]
    }
  }
];
