// =======================
// 修改后的 AI 语言检测函数：使用自定义提示词(如有配置)进行语言检测
// =======================
async function fetchLanguageDetection(word, sentence) {
  // 优化：优先检查本地缓存，避免云服务器查询延迟
  let existingDetails = null;
  let hasLanguage = false;

  // 1. 首先检查本地缓存（最快）
  if (highlightManager?.wordDetailsFromDB) {
    existingDetails = highlightManager.wordDetailsFromDB[word.toLowerCase()];
    if (existingDetails && existingDetails.language && existingDetails.language !== 'auto') {
      hasLanguage = true;
      console.log("本地缓存中存在语言", existingDetails.language);
      return existingDetails.language;
    }
  }

  // 2. 如果本地缓存没有，再查询数据库（可能触发云服务器请求）
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getWordDetails", word: word }, resolve);
    });
    existingDetails = response?.details;

    if (existingDetails && existingDetails.language && existingDetails.language !== 'auto') {
      hasLanguage = true;
      console.log("数据库中存在语言", existingDetails.language);
      return existingDetails.language;
    }
  } catch (error) {
    console.log("获取数据库语言信息失败，继续AI检测:", error);
  }

  console.log("数据库中不存在语言，开始AI检测");
  hasLanguage = false;

  // 获取 AI 配置
  const result = await new Promise((resolve) =>
    chrome.storage.local.get('aiConfig', resolve)
  );

  // 构建提示词
  let customPrompt = result?.aiConfig?.aiLanguageDetectionPrompt;
  let promptText = customPrompt
    ? customPrompt.replace('{sentence}', sentence).replace('{word}', word)
    : `请判断以下句子中单词 '${word}' 在句子'${sentence}'中所使用的语言，仅返回ISO 639语言代码标准(如en, de, fr等)`;

  const messages = [{
    role: "user",
    content: promptText
  }];

  try {
    const data = await makeAIRequest({ word, sentence, messages });

    // const languageValue = (data.choices?.[0]?.message?.content || "auto").trim();

    // 检查 AI 请求是否成功并且返回了有效内容
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      console.log("AI语言检测请求成功，但未返回有效内容:", data);
      return false; // 如果没有有效内容，则返回 false
    }

    const languageValue = content.trim();





    if (!hasLanguage) {

      console.log("写入单词数据库语言值", languageValue);
      // 确保等待消息处理完成
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: "ChangeWordLanguage",
            word: word,
            details: { language: languageValue } // 修改为传递完整的details对象
          },
          (response) => {

            if (highlightManager && highlightManager.wordDetailsFromDB) {
              highlightManager.wordDetailsFromDB[word.toLowerCase()] = {
                ...highlightManager.wordDetailsFromDB[word.toLowerCase()],
                language: languageValue
              };
            }



            console.log("数据库写入响应:", response);
            resolve(response);
          }
        );
      });
    }

    console.log("即将写入数据库的语言值 languageValue:", languageValue);
    return languageValue.length > 7 ? "?" : languageValue;
  } catch (err) {
    console.error("语言检测失败", err);
    return false;
  }
}







function addTranslationToLocalCache(word, translation) {
  // 添加本地缓存
  if (!highlightManager || !highlightManager.wordDetailsFromDB) {
    console.warn("highlightManager或wordDetailsFromDB未初始化");
    return;
  }

  const lowerCaseWord = word.toLowerCase();

  // 如果单词不存在于缓存中，创建新的词条
  if (!highlightManager.wordDetailsFromDB[lowerCaseWord]) {
    highlightManager.wordDetailsFromDB[lowerCaseWord] = {
      word: word,
      translations: [],
      status: '1' // 新单词默认状态为1（学习中）
    };
  }

  // 如果translations数组不存在，创建新数组
  if (!highlightManager.wordDetailsFromDB[lowerCaseWord].translations) {
    highlightManager.wordDetailsFromDB[lowerCaseWord].translations = [];
  }

  // 添加新的翻译
  highlightManager.wordDetailsFromDB[lowerCaseWord].translations.push(translation);
  console.log("本地缓存已更新，添加AI释义", highlightManager.wordDetailsFromDB[lowerCaseWord]);

  // 触发爆炸窗口刷新（使用自定义事件）
  window.dispatchEvent(new CustomEvent('wordCacheUpdated', {
    detail: { word: lowerCaseWord }
  }));
}



// 新增通用 AI 请求函数 - 修改为通过 background script 执行，避免 Firefox CSP 限制
function makeAIRequest({ word, sentence, stream = false, messages, model = null, temperature = 1, jsonMode = false }) {
  return new Promise((resolve, reject) => {
    // 将 AI 请求转发到 background script
    chrome.runtime.sendMessage({
      action: "makeAIRequest",
      requestData: { word, sentence, stream, messages, model, temperature, jsonMode }
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (response.error) {
        reject(new Error(response.error));
        return;
      }

      resolve(response);
    });
  });
}

const STRUCTURED_LOOKUP_CHUNK_SIZE = 12;
// 与 options.js 中 DEFAULT_PROMPTS 对应的默认提示词副本，仅用于判断用户是否自定义过提示词。
// 比较前会经 normalizePromptForCompare 折叠空白，因此这里可以自由换行排版。
const STRUCTURED_LOOKUP_STOCK_PROMPTS = {
  aiPrompt: `# 角色 你是翻译专家，根据上下文判断单词或短语并翻译。
# 输出规则（严格执行）
**情况一：固定短语** 若 {word} 在句中构成固定短语/习语，输出格式为： " 完整短语: 中文翻译 " 示例："break the ice: 打破僵局"
**情况二：独立单词** 若 {word} 只是独立单词，输出格式为： " 中文翻译 " 示例："打破"
# 禁止事项
- 禁止输出"单词："、"英文："、"翻译："，"中文翻译："等任何前缀标签
- 禁止输出分析、解释、语法说明
- 禁止输出引号
- 只输出翻译结果，别的什么都不要说
# 任务 判断句子 {sentence} 中，{word} 是独立单词还是固定短语的一部分，按上述格式输出翻译。`,
  aiPrompt2: `# 角色 你是一位精通德语 日语 英语的语法解析专家，擅长根据上下文精确判断对应单词的解析精要
# 任务 根据提供的 [句子]，判断 [待解析词] 在该语境下的具体语法作用，形变规则等
# 核心规则 返回20字左右精要解析。
# 输入 - 句子: {sentence} - 待解析词: {word}
# 输出格式 直接返回解析内容`,
  aiLanguageDetectionPrompt: `请判断以下句子中单词 '{word}' 在句子'{sentence}'中所使用的语言，`
    + `仅返回ISO 639-1国际标准化组织ISO 639语言代码标准(如en, de, fr等)`,
  aiSentenceTranslationPrompt: `请将句子: '{sentence}'翻译为中文，`
    + `并将句子中单词"'{word}'"对应的中文的部分用Markdown加粗显示。只返回翻译结果，不要额外说明。`,
  aiTagAnalysisPrompt: `你将要按照下列要求，分析单词在句子中的一些信息，用作某单词的tag，请按照下列要求进行分析：
1. 词性(pos): 在句子中的词性
2. 性别(gender): 如果是名词，返回 der/die/das
3. 复数形式(plural): 如果是名词，返回其复数形式
4. 变位(conjugation): 如果是动词，返回其原形
5. 附加信息1(自定义key): 任何其他重要信息，请自行判断添加，可参考示例。
6. 附加信息2(自定义key): 任何其他重要信息，请自行判断添加，可参考示例。
7. ... ...
示例：
德语：{"pos":"n", "gender":"der", "plural":"Häuser", "conjugation":"gehen"}
英语：{"pos":"n", "plural":"houses", "conjugation":"null"}
日语：{"pos":"n", "gender":"null", "plural":"null", "conjugation":"null", "注音":"いえ、うち","罗马音":"ie,uchi"}
中文：{"pos":"n", "gender":"null", "plural":"null", "conjugation":"null", "pinyin":"fáng zi"}
"请分析句子"{sentence}"中的单词"{word}"。返回JSON格式，包含：
仅返回JSON，无需解释，不要加markdown代码块标记，注意不同语言，非日语不要返回注意和罗马音和拼音。`
};

function normalizePromptForCompare(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function isCustomLookupPrompt(key, value) {
  if (!value || !String(value).trim()) {return false;}
  const stock = STRUCTURED_LOOKUP_STOCK_PROMPTS[key];
  if (!stock) {return true;}
  return normalizePromptForCompare(value) !== normalizePromptForCompare(stock);
}

function isInvalidAITranslation(text) {
  if (text == null) {return true;}
  const t = String(text).trim();
  return !t || ['暂无翻译', '翻译失败', '翻译进行中...', 'AI 释义加载失败'].includes(t);
}

function sendRuntimeMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
      } else {
        resolve(response || {});
      }
    });
  });
}

function parseStructuredLookupJson(content) {
  if (!content || typeof content !== 'string') {return null;}
  let text = content.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error('[structuredLookup] JSON 解析失败:', err, content);
    return null;
  }
}

function buildStructuredLookupMessages({ sentence, items, sentenceTranslationCount, extraFieldInstructions }) {
  const itemLines = items.map((item) => {
    const fields = Array.isArray(item.fields) ? item.fields.join(',') : '';
    return `- ${item.word} [fields: ${fields || 'none'}]`;
  }).join('\n');

  const extraBlock = extraFieldInstructions
    ? `\n用户自定义字段说明（仅作风格参考，仍必须遵守上面的 JSON 格式，不要改成纯文本）：\n${extraFieldInstructions}\n`
    : '';

  const promptText = `你是语言学习助手。根据句子和待查词，只返回一个 JSON 对象，不要 markdown 代码块，不要解释。

句子：
"""${sentence}"""

待查词：
${itemLines || '(无单词，仅翻译整句)'}

整句翻译条数：${sentenceTranslationCount || 0}（0 表示不要 sentenceTranslations）

返回格式：
{"words":[{"word":"与输入完全一致","language":"ISO 639-1 如 en/de/ja","translation":"该词在本句中的中文释义；固定短语用「完整短语: 中文」","grammar":"约20字语法精要","tags":{"pos":"n","gender":"das或null","plural":"复数或null","conjugation":"原形或null"}}],"sentenceTranslations":["整句中文，目标词对应中文用 **加粗**"]}

规则：
- words 必须覆盖每一个输入 word，word 字段与输入一致
- 某词 fields 未包含的键请省略，不要编造
- translation 不要「单词：」「翻译：」等前缀，不要包引号
- tags 无则 null；非日语不要注音/罗马音/拼音
- sentenceTranslations 需要几条就返回几条且互不相同；条数为 0 时返回 []
${extraBlock}`;

  return [{ role: 'user', content: promptText }];
}

function collectCustomLookupInstructions(aiConfig, sentence) {
  if (!aiConfig) {return '';}
  const mapping = [
    ['aiPrompt', 'translation'],
    ['aiPrompt2', 'grammar'],
    ['aiLanguageDetectionPrompt', 'language'],
    ['aiTagAnalysisPrompt', 'tags'],
    ['aiSentenceTranslationPrompt', 'sentenceTranslations']
  ];
  const parts = [];
  mapping.forEach(([key, field]) => {
    const raw = aiConfig[key];
    if (!isCustomLookupPrompt(key, raw)) {return;}
    const text = String(raw)
      .replace(/\{sentence\}/g, sentence)
      .replace(/\{word\}/g, '(对应 JSON 中的 word 字段)');
    parts.push(`- ${field}: ${text}`);
  });
  return parts.join('\n');
}

function formatStructuredTagStrings(word, tags) {
  if (!tags || typeof tags !== 'object') {return [];}

  const isMultiWordResponse = !Object.prototype.hasOwnProperty.call(tags, 'pos') &&
    Object.keys(tags).some((key) => tags[key] && typeof tags[key] === 'object' && !Array.isArray(tags[key]));

  const tagStrings = [];
  const pushTag = (value) => {
    if (value == null || value === '' || value === 'null') {return;}
    const text = typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : JSON.stringify(value);
    if (text && !tagStrings.includes(text)) {tagStrings.push(text);}
  };

  if (isMultiWordResponse) {
    Object.entries(tags).forEach(([wordKey, wordData]) => {
      if (!wordData || typeof wordData !== 'object') {return;}
      Object.entries(wordData).forEach(([key, value]) => {
        if (value == null || value === '' || value === 'null') {return;}
        pushTag(`${wordKey}-${key}: ${value}`);
      });
    });
    return tagStrings;
  }

  if (tags.pos != null && tags.pos !== 'null') {
    const posTags = Array.isArray(tags.pos) ? tags.pos : [tags.pos];
    posTags.forEach((pos) => pushTag(pos));
  }
  if (tags.gender != null && tags.gender !== 'null') {
    pushTag(tags.gender);
  }
  if (tags.plural != null && tags.plural !== 'null') {
    pushTag(`pl: ${tags.plural}`);
  }
  if (tags.conjugation != null && tags.conjugation !== 'null' && tags.conjugation !== word) {
    pushTag(`inf: ${tags.conjugation}`);
  }

  Object.entries(tags).forEach(([key, value]) => {
    if (['pos', 'gender', 'plural', 'conjugation'].includes(key)) {return;}
    if (value == null || value === '' || value === 'null') {return;}
    let formattedValue;
    if (Array.isArray(value)) {formattedValue = value.join(', ');}
    else if (typeof value === 'object') {formattedValue = JSON.stringify(value);}
    else {formattedValue = String(value);}
    pushTag(`${key}: ${formattedValue}`);
  });

  return tagStrings;
}

async function applyStructuredLanguage(word, language) {
  if (!language || language === false) {return null;}
  const languageValue = String(language).trim();
  if (!languageValue) {return null;}
  // 与 fetchLanguageDetection 保持一致：原值入库，只在展示层把异常长的值折叠为 '?'
  const displayValue = languageValue.length > 7 ? '?' : languageValue;

  await sendRuntimeMessage({
    action: 'ChangeWordLanguage',
    word,
    details: { language: languageValue }
  });

  if (typeof highlightManager !== 'undefined' && highlightManager?.wordDetailsFromDB) {
    const lower = word.toLowerCase();
    highlightManager.wordDetailsFromDB[lower] = {
      ...highlightManager.wordDetailsFromDB[lower],
      language: languageValue
    };
  }
  return displayValue;
}

async function applyStructuredTranslation(word, translation) {
  if (isInvalidAITranslation(translation)) {return false;}
  const aiTranslation = String(translation).trim();

  const detailsResponse = await sendRuntimeMessage({ action: 'getWordDetails', word });
  const existingTranslations = detailsResponse?.details?.translations || [];
  const translationExists = existingTranslations.some(
    (trans) => String(trans).toLowerCase().trim() === aiTranslation.toLowerCase()
  );
  if (translationExists) {return false;}

  const persistSettings = await new Promise((resolve) => {
    chrome.storage.local.get(['autoAddAITranslations', 'autoAddAITranslationsFromUnknown'], resolve);
  });

  let shouldPersist = persistSettings.autoAddAITranslations === true;
  if (!shouldPersist && persistSettings.autoAddAITranslationsFromUnknown) {
    const count = typeof getTranslationCount === 'function' ? getTranslationCount(word) : 0;
    const status = highlightManager?.wordDetailsFromDB?.[word.toLowerCase()]?.status;
    const statusNum = status === undefined || status === null ? 0 : parseInt(status, 10);
    shouldPersist = count === 0 && statusNum !== 5;
  }
  if (!shouldPersist) {return false;}

  const addResponse = await sendRuntimeMessage({
    action: 'addTranslation',
    word,
    translation: aiTranslation
  });
  if (addResponse && addResponse.error) {
    console.error('[structuredLookup] 添加翻译失败:', addResponse.error);
    return false;
  }

  addTranslationToLocalCache(word, aiTranslation);
  window.dispatchEvent(new CustomEvent('aiTranslationAdded', {
    detail: { word, translation: aiTranslation }
  }));
  return true;
}

async function applyStructuredTags(word, tags) {
  const tagStrings = formatStructuredTagStrings(word, tags);
  if (!tagStrings.length) {return [];}

  for (const tag of tagStrings) {
    await sendRuntimeMessage({ action: 'addTag', word, tag });
  }

  if (typeof highlightManager !== 'undefined' && highlightManager?.wordDetailsFromDB) {
    const lower = word.toLowerCase();
    if (!highlightManager.wordDetailsFromDB[lower]) {
      highlightManager.wordDetailsFromDB[lower] = { word, tags: [] };
    }
    if (!highlightManager.wordDetailsFromDB[lower].tags) {
      highlightManager.wordDetailsFromDB[lower].tags = [];
    }
    tagStrings.forEach((tag) => {
      if (!highlightManager.wordDetailsFromDB[lower].tags.includes(tag)) {
        highlightManager.wordDetailsFromDB[lower].tags.push(tag);
      }
    });
  }

  window.dispatchEvent(new CustomEvent('wordCacheUpdated', {
    detail: { word: word.toLowerCase() }
  }));
  return tagStrings;
}

function chunkStructuredItems(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks.length ? chunks : [[]];
}

function findStructuredWordResult(wordsMap, word) {
  if (!wordsMap || !word) {return null;}
  if (wordsMap[word]) {return wordsMap[word];}
  const lower = word.toLowerCase();
  if (wordsMap[lower]) {return wordsMap[lower];}
  const match = Object.keys(wordsMap).find((key) => key.toLowerCase() === lower);
  return match ? wordsMap[match] : null;
}

async function requestStructuredLookupChunk({ sentence, items, sentenceTranslationCount, extraFieldInstructions }) {
  const messages = buildStructuredLookupMessages({
    sentence,
    items,
    sentenceTranslationCount,
    extraFieldInstructions
  });
  const firstWord = items[0]?.word || '';
  const data = await makeAIRequest({
    word: firstWord,
    sentence,
    messages,
    stream: false,
    jsonMode: true
  });
  const content = data?.choices?.[0]?.message?.content || '';
  const parsed = parseStructuredLookupJson(content);
  if (!parsed || typeof parsed !== 'object') {
    // 抛错而不是返回空对象，让上层能区分「AI 返回失败」与「该字段确实没有内容」
    throw new Error(`结构化查词返回内容无法解析为 JSON: ${String(content).slice(0, 200)}`);
  }

  const wordsArray = Array.isArray(parsed.words) ? parsed.words : [];
  const words = {};
  wordsArray.forEach((entry) => {
    if (!entry || !entry.word) {return;}
    words[String(entry.word).toLowerCase()] = entry;
  });

  let sentenceTranslations = [];
  if (Array.isArray(parsed.sentenceTranslations)) {
    sentenceTranslations = parsed.sentenceTranslations
      .map((item) => String(item || '').trim())
      .filter((item) => item && item !== '暂无翻译' && item !== '翻译失败');
  } else if (parsed.sentenceTranslation) {
    const one = String(parsed.sentenceTranslation).trim();
    if (one) {sentenceTranslations = [one];}
  }

  return { words, sentenceTranslations };
}

/**
 * 结构化批量查词：一次请求返回多个单词的释义/语法/语言/标签，以及可选整句翻译。
 * @param {{ sentence: string, items: Array<{word: string, fields: string[]}>, sentenceTranslationCount?: number, persist?: boolean }} options
 */
async function fetchStructuredWordLookup({ sentence, items = [], sentenceTranslationCount = 0, persist = true } = {}) {
  const normalizedItems = (items || [])
    .filter((item) => item && item.word)
    .map((item) => ({
      word: String(item.word),
      fields: Array.from(new Set((item.fields || []).filter(Boolean)))
    }))
    .filter((item) => item.fields.length > 0);

  const count = Math.max(0, Number(sentenceTranslationCount) || 0);
  if (!normalizedItems.length && count < 1) {
    return { words: {}, sentenceTranslations: [] };
  }

  const itemsKey = normalizedItems
    .map((item) => `${item.word.toLowerCase()}:${item.fields.slice().sort().join(',')}`)
    .join(';');
  const inflightKey = `${sentence}||${itemsKey}||${count}`;
  if (!window.structuredLookupInflight) {
    window.structuredLookupInflight = new Map();
  }
  if (window.structuredLookupInflight.has(inflightKey)) {
    return window.structuredLookupInflight.get(inflightKey);
  }

  const lookupPromise = (async () => {
    const aiConfig = await new Promise((resolve) => {
      chrome.storage.local.get('aiConfig', (result) => resolve(result?.aiConfig || {}));
    });
    const extraFieldInstructions = collectCustomLookupInstructions(aiConfig, sentence);
    const chunks = chunkStructuredItems(normalizedItems, STRUCTURED_LOOKUP_CHUNK_SIZE);
    const merged = { words: {}, sentenceTranslations: [] };
    const failedWords = new Set();
    let sentenceTranslationFailed = false;
    let lastError = null;

    for (let i = 0; i < chunks.length; i++) {
      const chunkCount = i === 0 ? count : 0;
      if (!chunks[i].length && chunkCount < 1) {
        continue;
      }

      // 失败重试一次：模型偶发返回非 JSON 时，重来一次通常就能拿到合法结果
      let chunkResult = null;
      for (let attempt = 0; attempt < 2 && !chunkResult; attempt++) {
        try {
          chunkResult = await requestStructuredLookupChunk({
            sentence,
            items: chunks[i],
            sentenceTranslationCount: chunkCount,
            extraFieldInstructions
          });
        } catch (err) {
          lastError = err;
          console.error(`[structuredLookup] 分块请求失败（第 ${attempt + 1} 次尝试）:`, err);
        }
      }

      // 重试后仍失败：把该分块的词标记为失败，供调用方区分「AI 失败」与「确实无内容」
      if (!chunkResult) {
        chunks[i].forEach((item) => failedWords.add(item.word.toLowerCase()));
        if (chunkCount > 0) {
          sentenceTranslationFailed = true;
        }
        continue;
      }

      Object.assign(merged.words, chunkResult.words);
      if (chunkResult.sentenceTranslations?.length) {
        chunkResult.sentenceTranslations.forEach((trans) => {
          if (!merged.sentenceTranslations.includes(trans)) {
            merged.sentenceTranslations.push(trans);
          }
        });
      }
    }

    const resultWords = {};
    // 各单词之间互不影响，并发持久化，避免十几个词串行等待消息往返
    await Promise.all(normalizedItems.map(async (item) => {
      const lowerWord = item.word.toLowerCase();
      const raw = findStructuredWordResult(merged.words, item.word) || {};
      const wordResult = {
        word: item.word,
        failed: failedWords.has(lowerWord),
        translation: item.fields.includes('translation') ? (raw.translation ?? null) : null,
        grammar: item.fields.includes('grammar') ? (raw.grammar ?? null) : null,
        language: item.fields.includes('language') ? (raw.language ?? null) : null,
        tags: item.fields.includes('tags') ? (raw.tags ?? null) : null,
        translationPersisted: false
      };

      if (persist) {
        try {
          if (item.fields.includes('language') && wordResult.language) {
            const savedLanguage = await applyStructuredLanguage(item.word, wordResult.language);
            if (savedLanguage) {
              wordResult.language = savedLanguage;
            }
          }
          if (item.fields.includes('translation') && wordResult.translation) {
            wordResult.translationPersisted = await applyStructuredTranslation(item.word, wordResult.translation);
          }
          if (item.fields.includes('tags') && wordResult.tags) {
            await applyStructuredTags(item.word, wordResult.tags);
          }
        } catch (err) {
          // 单个词写库失败不应中断其余单词
          console.error('[structuredLookup] 持久化失败:', item.word, err);
        }
      }

      resultWords[lowerWord] = wordResult;
    }));

    return {
      words: resultWords,
      sentenceTranslations: merged.sentenceTranslations,
      failedWords: Array.from(failedWords),
      sentenceTranslationFailed,
      error: lastError ? String(lastError.message || lastError) : null
    };
  })();

  window.structuredLookupInflight.set(inflightKey, lookupPromise);
  try {
    return await lookupPromise;
  } finally {
    window.structuredLookupInflight.delete(inflightKey);
  }
}

// 检查是否使用Orion TTS模式（通过用户设置）
async function isOrionMode() {
  try {
    const orionTTSEnabled = await getStorageValue('useOrionTTS');
    // console.log('[isOrionMode] useOrionTTS设置:', orionTTSEnabled);
    return orionTTSEnabled === true;
  } catch (error) {
    console.error('[isOrionMode] 获取useOrionTTS设置失败:', error);
    return false;
  }
}

// 辅助函数：获取存储值
function getStorageValue(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, function(result) {
      resolve(result[key]);
    });
  });
}

// 修改流式分析函数
async function streamAnalysis(word, sentence) {
  // 获取分析结果的DOM元素，用来流式输出
  const analysisResult = analysisWindow.querySelector('.analysis-result');

  // 获取用户自定义的 AI 提示词
  chrome.storage.local.get('aiConfig', async function(result) {
    let customAnalysisPrompt = result?.aiConfig?.aiAnalysisPrompt;
    let promptText = customAnalysisPrompt
      ? customAnalysisPrompt.replace('{sentence}', sentence).replace('{word}', word)
      : `直译： 我敬畏地观察着两位可怕的战士一次又一次地交叉他们的剑。 解析： - Ich beobachte ehrfürchtig: "我敬畏地观察"。   - Ich: "我"，主语。   - beobachte: "观察"，动词"beobachten"的第一人称单数形式。   - ehrfürchtig: "敬畏地"，副词，表示对某事物的尊敬或畏惧。 - wie die beiden furchterregenden Krieger immer wieder ihre Klingen kreuzen: "两位可怕的战士一次又一次地交叉他们的剑"。   - wie: "如何"，引导方式状语从句。   - die beiden furchterregenden Krieger: "这两位可怕的战士"。     - die beiden: "这两位"，指示代词。     - furchterregenden: "可怕的"，形容词，表示"令人恐惧"。     - Krieger: "战士"，名词，指战斗者。   - immer wieder: "一次又一次"，副词短语，表示重复发生。   - ihre Klingen kreuzen: "交叉他们的剑"。     - ihre: "他们的"，物主代词。     - Klingen: "剑"，名词，表示剑或刀刃。     - kreuzen: "交叉"，动词，表示交叉或交锋。 借鉴上面解析格式，用中文解析下列英语/德语等其他语言的句子: ${sentence}

      `;

    const messages = [{
      role: "user",
      content: promptText
    }];

    // 检测是否使用Orion模式
    const useOrionMode = await isOrionMode();

    // 在界面上显示调试信息
    // analysisResult.innerHTML = `useOrionTTS设置: ${useOrionMode}<br>正在初始化...`;

    if (useOrionMode) {
      // Orion模式使用原来的实现方式（直接在content script中处理流式数据）
      useLegacyStreamAnalysis(word, sentence, messages, analysisResult);
    } else {
      // 非Orion模式使用background实现方式
      useBackgroundStreamAnalysis(word, sentence, messages, analysisResult);
    }
  });
}

// Orion模式的实现方式（直接在content script中处理）
function useLegacyStreamAnalysis(word, sentence, messages, analysisResult) {
  // analysisResult.innerHTML += '<br>开始Orion模式分析...';

  // 直接在content script中处理AI请求和流式数据
  chrome.runtime.sendMessage({ action: "getAIConfig" }, (response) => {
    if (chrome.runtime.lastError) {
      analysisResult.innerHTML = `配置获取失败: ${chrome.runtime.lastError.message}`;
      return;
    }

    const config = response?.config || {};
    // analysisResult.innerHTML += `<br>配置获取成功，API URL: ${config.apiBaseURL || '未设置'}`;

    // 检查 API Key 是否配置
    if (!config.apiKey) {
      analysisResult.innerHTML = "AI API Key 或 Token 未配置，请在插件设置中填写";
      return;
    }

    if (!config.apiBaseURL) {
      analysisResult.innerHTML = "AI API BaseURL 未配置，请在插件设置中填写";
      return;
    }

    // analysisResult.innerHTML += '<br>开始发起AI请求...';

    fetch(config.apiBaseURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
        "x-gemini-legacy-support": "true"
      },
      body: JSON.stringify({
        model: config.apiModel,
        messages: messages,
        stream: true,
        temperature: 1
      })
    })
    .then((response) => {
      // analysisResult.innerHTML += `<br>收到响应，状态: ${response.status}`;
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      // analysisResult.innerHTML += '<br>开始处理流式数据...';

      const reader = response.body.getReader();
      let buffer = '';
      let isFirstChunk = true;

      function processText({ done, value }) {
        if (done) {
          // 处理最后可能残留的数据
          if (buffer.trim()) {
            try {
              const data = JSON.parse(buffer);
              const content = data.choices?.[0]?.delta?.content;
              if (content) {
                analysisResult.innerHTML += formatContent(content);
                analysisResult.scrollTop = analysisResult.scrollHeight;
              }
            } catch (e) {
              console.log("解析最后数据块失败:", e);
            }
          }
          return;
        }

        // 将新的数据块添加到缓冲区
        const chunk = new TextDecoder().decode(value);
        buffer += chunk;

        // 处理数据流
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留最后一个不完整的行

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') {
              continue;
            }

            try {
              const data = JSON.parse(dataStr);
              const content = data.choices?.[0]?.delta?.content;

              if (content) {
                if (isFirstChunk) {
                  analysisResult.innerHTML = ''; // 清空 "分析中..." 的文本
                  isFirstChunk = false;
                }
                analysisResult.innerHTML += formatContent(content);
                analysisResult.scrollTop = analysisResult.scrollHeight;
              }
            } catch (e) {
              console.log("解析流式数据失败:", e, "原始数据:", dataStr);
            }
          }
        }

        // 继续读取
        return reader.read().then(processText);
      }

      return reader.read().then(processText);
    })
    .catch((err) => {
      // analysisResult.innerHTML = `<br>Orion模式流式请求失败: ${err.message}<br>尝试非流式请求...`;
      analysisResult.innerHTML = '正在分析（非流式模式）...';

      // 尝试非流式请求
      fetch(config.apiBaseURL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
          "x-gemini-legacy-support": "true"
        },
        body: JSON.stringify({
          model: config.apiModel,
          messages: messages,
          stream: false,
          temperature: 1
        })
      })
      .then((response) => response.json())
      .then((data) => {
        const content = data.choices?.[0]?.message?.content || '分析失败';
        analysisResult.innerHTML = formatContent(content);
        analysisResult.scrollTop = analysisResult.scrollHeight;
      })
      .catch((nonStreamErr) => {
        analysisResult.innerHTML = `分析出错: ${nonStreamErr.message}`;
      });
    });
  });
}

// 标准模式的实现方式（通过background处理）
function useBackgroundStreamAnalysis(word, sentence, messages, analysisResult) {
  // 设置流式处理的上下文
  window.currentStreamContext = {
    type: 'analysis',
    element: analysisResult,
    word: word,
    sentence: sentence
  };

  // 通过background处理流式请求
  makeAIRequest({ word, sentence, stream: true, messages })
    .then((response) => {
      // 如果返回的是流式响应标识，说明background正在处理流式数据
      if (response.success && response.stream) {
        console.log('流式请求已启动，等待background发送数据');
        return;
      }

      // 如果不是流式响应，按原来的方式处理
      const reader = response.body.getReader();
      let buffer = '';
      let isFirstChunk = true;

      function processText({ done, value }) {
        if (done) {
          // 处理最后可能残留的数据
          if (buffer) {
            try {
              const data = JSON.parse(buffer);
              const content = data.choices?.[0]?.delta?.content;
              if (content) {
                analysisResult.innerHTML += formatContent(content);
                analysisResult.scrollTop = analysisResult.scrollHeight;
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
          return;
        }

        // 将新的数据块添加到缓冲区
        const chunk = new TextDecoder().decode(value);
        buffer += chunk;

        // 处理数据流
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留最后一个不完整的行

        lines.forEach((line) => {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const content = data.choices?.[0]?.delta?.content;
              if (content) {
                if (isFirstChunk) {
                  analysisResult.innerHTML = ''; // 清空 "分析中..." 的文本
                  isFirstChunk = false;
                }
                analysisResult.innerHTML += formatContent(content);
                analysisResult.scrollTop = analysisResult.scrollHeight;
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        });

        // 继续读取
        return reader.read().then(processText);
      }

      return reader.read().then(processText);
    })
    .catch((err) => {
      console.log('流式请求失败，尝试非流式请求:', err.message);
      // 如果流式请求失败（比如在Firefox中），尝试非流式请求
      if (err.message.includes('流式请求暂时不支持')) {
        analysisResult.innerHTML = '正在分析（非流式模式）...';
        makeAIRequest({ word, sentence, stream: false, messages })
          .then((data) => {
            const content = data.choices?.[0]?.message?.content || '分析失败';
            analysisResult.innerHTML = formatContent(content);
            analysisResult.scrollTop = analysisResult.scrollHeight;
          })
          .catch((nonStreamErr) => {
            analysisResult.innerHTML = `分析出错: ${nonStreamErr.message}`;
            console.error('非流式AI分析也失败:', nonStreamErr);
          });
      } else {
        analysisResult.innerHTML = `分析出错: ${err.message}`;
        console.error('AI分析失败:', err);
      }
    });
}




// 新增函数：使用 AI 翻译例句，并对当前单词在翻译中进行加粗标记（Markdown格式）
function fetchSentenceTranslation(word, sentence) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "getAIConfig" }, (response) => {

      // aiSentenceTranslationPrompt
      // 构造提示语，请求 AI 翻译句子，并将句子中单词进行加粗显示
      let customPrompt = response?.config?.aiSentenceTranslationPrompt;
      console.log("aiSentenceTranslationPromptcustomPrompt:", customPrompt);
      let promptText = customPrompt
                         ? customPrompt.replace('{sentence}', sentence).replace('{word}', word)
                         : `请将句子: ${sentence}翻译为中文，并将句子中单词"${word}"对应的中文的部分用Markdown加粗显示。只返回翻译结果，不要额外说明。\n`;

      const messages = [{
        role: "user",
        content: promptText
      }];

      makeAIRequest({ word, sentence, messages })
        .then((data) => {
          const result = data.choices?.[0]?.message?.content || "暂无翻译";
          resolve(result);
        })
        .catch((err) => {
          console.error("句子翻译失败", err);
          resolve("翻译失败");
        });
    });
  });
}

// 新增：对话式分析函数（支持持续性对话）
async function streamChatAnalysis(word, sentence, conversationHistory, analysisResult) {
  // 获取用户自定义的 AI 提示词
  chrome.storage.local.get('aiConfig', async function(result) {
    let customChatPrompt = result?.aiConfig?.chatPrompt || '请根据以下句子和对话历史回答用户的问题：\n\n句子：{sentence}\n\n对话历史：{history}\n\n用户问题：{question}';

    // 构建对话历史字符串
    const historyStr = conversationHistory.map((msg) => `${msg.role === 'user' ? '用户' : 'AI'}: ${msg.content}`).join('\n');

    // 获取最后一个用户问题
    const lastUserMessage = conversationHistory[conversationHistory.length - 1];
    const question = lastUserMessage ? lastUserMessage.content : '';

    let promptText = customChatPrompt
      .replace('{sentence}', sentence)
      .replace('{history}', historyStr)
      .replace('{question}', question);

    // 构建完整的消息数组（包含对话历史）
    const messages = [
      {
        role: "system",
        content: `你是一个语言学习助手，专门帮助用户理解句子中的单词和语法。当前句子是：${sentence}`
      },
      ...conversationHistory,
      {
        role: "user",
        content: promptText
      }
    ];

    // 检测是否使用Orion模式
    const useOrionMode = await isOrionMode();

    if (useOrionMode) {
      // Orion模式使用原来的实现方式（直接在content script中处理流式数据）
      useLegacyChatAnalysis(word, sentence, messages, analysisResult, conversationHistory);
    } else {
      // 非Orion模式使用background实现方式
      useBackgroundChatAnalysis(word, sentence, messages, analysisResult, conversationHistory);
    }
  });
}

// Orion模式的对话分析实现方式
function useLegacyChatAnalysis(word, sentence, messages, analysisResult, conversationHistory) {
  // 直接在content script中处理AI请求和流式数据
  chrome.runtime.sendMessage({ action: "getAIConfig" }, (response) => {
    const config = response.config || {};

    // 检查 API Key 是否配置
    if (!config.apiKey) {
      analysisResult.innerHTML += `<div class="error-message">AI API Key 或 Token 未配置，请在插件设置中填写</div>`;
      return;
    }

    // 添加 AI 回复的占位符
    const aiResponseDiv = document.createElement('div');
    aiResponseDiv.className = 'ai-message';
    aiResponseDiv.innerHTML = '<strong>AI:</strong> ';
    analysisResult.appendChild(aiResponseDiv);
    analysisResult.scrollTop = analysisResult.scrollHeight;

    const responseContentSpan = document.createElement('span');
    aiResponseDiv.appendChild(responseContentSpan);

    fetch(config.apiBaseURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
        "x-gemini-legacy-support": "true"
      },
      body: JSON.stringify({
        model: config.apiModel,
        messages: messages,
        stream: true,
        temperature: 1
      })
    })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      let buffer = '';
      let isFirstChunk = true;

      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              // 流式传输完成
              return;
            }

            const chunk = new TextDecoder().decode(value);
            buffer += chunk;

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const dataStr = line.slice(6).trim();
                if (dataStr === '[DONE]') {continue;}

                try {
                  const data = JSON.parse(dataStr);
                  const content = data.choices?.[0]?.delta?.content;

                  if (content) {
                    responseContentSpan.innerHTML += formatContent(content);
                    analysisResult.scrollTop = analysisResult.scrollHeight;
                  }
                } catch (e) {
                  console.log("解析流式数据失败:", e);
                }
              }
            }
          }
        } catch (error) {
          console.error("流式处理错误:", error);
          responseContentSpan.innerHTML += ` 错误: ${error.message}`;
        }
      };

      processStream();
    })
    .catch((err) => {
      console.error('对话分析失败:', err);
      responseContentSpan.innerHTML += ` 错误: ${err.message}`;
    });
  });
}

// 标准模式的对话分析实现方式（通过background处理）
function useBackgroundChatAnalysis(word, sentence, messages, analysisResult, conversationHistory) {
  // 添加 AI 回复的占位符
  const aiResponseDiv = document.createElement('div');
  aiResponseDiv.className = 'ai-message';
  aiResponseDiv.innerHTML = '<strong>AI:</strong> ';
  analysisResult.appendChild(aiResponseDiv);
  analysisResult.scrollTop = analysisResult.scrollHeight;

  const responseContentSpan = document.createElement('span');
  aiResponseDiv.appendChild(responseContentSpan);

  // 设置流式处理的上下文
  window.currentStreamContext = {
    type: 'chat',
    element: responseContentSpan,
    word: word,
    sentence: sentence,
    conversationHistory: conversationHistory
  };

  // 通过background处理流式请求
  makeAIRequest({ word, sentence, stream: true, messages })
    .then((response) => {
      if (response.success && response.stream) {
        console.log('对话流式请求已启动，等待background发送数据');
        return;
      }

      // 如果不是流式响应，按原来的方式处理
      const reader = response.body.getReader();
      let buffer = '';
      let isFirstChunk = true;

      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              return;
            }

            const chunk = new TextDecoder().decode(value);
            buffer += chunk;

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const dataStr = line.slice(6).trim();
                if (dataStr === '[DONE]') {continue;}

                try {
                  const data = JSON.parse(dataStr);
                  const content = data.choices?.[0]?.delta?.content;

                  if (content) {
                    responseContentSpan.innerHTML += formatContent(content);
                    analysisResult.scrollTop = analysisResult.scrollHeight;
                  }
                } catch (e) {
                  console.log("解析流式数据失败:", e);
                }
              }
            }
          }
        } catch (error) {
          console.error("流式处理错误:", error);
          responseContentSpan.innerHTML += ` 错误: ${error.message}`;
        }
      };

      processStream();
    })
    .catch((err) => {
      console.error('对话分析失败:', err);
      responseContentSpan.innerHTML += ` 错误: ${err.message}`;
    });
}

// 为侧边栏进行流式分析
async function sidebarStreamAnalysis(word, sentence) {
  // 获取用户自定义的AI提示词
  chrome.storage.local.get('aiConfig', async function(result) {
    let customSidebarPrompt = result?.aiConfig?.sidebarAIPrompt;
    let promptText = customSidebarPrompt
      ? customSidebarPrompt.replace('{sentence}', sentence)
      : `直译： 我敬畏地观察着两位可怕的战士一次又一次地交叉他们的剑。 解析： - Ich beobachte ehrfürchtig: "我敬畏地观察"。   - Ich: "我"，主语。   - beobachte: "观察"，动词"beobachten"的第一人称单数形式。   - ehrfürchtig: "敬畏地"，副词，表示对某事物的尊敬或畏惧。 - wie die beiden furchterregenden Krieger immer wieder ihre Klingen kreuzen: "两位可怕的战士一次又一次地交叉他们的剑"。   - wie: "如何"，引导方式状语从句。   - die beiden furchterregenden Krieger: "这两位可怕的战士"。     - die beiden: "这两位"，指示代词。     - furchterregenden: "可怕的"，形容词，表示"令人恐惧"。     - Krieger: "战士"，名词，指战斗者。   - immer wieder: "一次又一次"，副词短语，表示重复发生。   - ihre Klingen kreuzen: "交叉他们的剑"。     - ihre: "他们的"，物主代词。     - Klingen: "剑"，名词，表示剑或刀刃。     - kreuzen: "交叉"，动词，表示交叉或交锋。 借鉴上面解析格式，用中文解析下列英语/德语等其他语言的句子： ${sentence}`;

    const messages = [{
      role: "user",
      content: promptText
    }];

    // 检测是否使用Orion模式
    const useOrionMode = await isOrionMode();

    if (useOrionMode) {
      // console.log('检测到Orion模式，侧边栏使用原来的实现方式');
      // Orion模式使用原来的实现方式（直接在content script中处理流式数据）
      useLegacySidebarStreamAnalysis(word, sentence, messages);
    } else {
      // console.log('非Orion模式，侧边栏使用background实现方式');
      // 非Orion模式使用background实现方式
      useBackgroundSidebarStreamAnalysis(word, sentence, messages);
    }
  });
}

// Orion模式的侧边栏实现方式（直接在content script中处理）
function useLegacySidebarStreamAnalysis(word, sentence, messages) {
  // 直接在content script中处理AI请求和流式数据
  chrome.runtime.sendMessage({ action: "getAIConfig" }, (response) => {
    const config = response.config || {};

    // 检查 API Key 是否配置
    if (!config.apiKey) {
      chrome.runtime.sendMessage({
        action: "streamUpdate",
        data: {
          content: "AI API Key 或 Token 未配置，请在插件设置中填写",
          isFirstChunk: true
        }
      });
      return;
    }

    console.log("[aiFragen.js] Safari模式 - 侧边栏发起 AI 请求到:", config.apiBaseURL);

    fetch(config.apiBaseURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
        "x-gemini-legacy-support": "true"
      },
      body: JSON.stringify({
        model: config.apiModel,
        messages: messages,
        stream: true,
        temperature: 1
      })
    })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      let buffer = '';
      let isFirstChunk = true;

      function processText({ done, value }) {
        if (done) {
          // 处理最后可能残留的数据
          if (buffer.trim()) {
            try {
              const data = JSON.parse(buffer);
              const content = data.choices?.[0]?.delta?.content;
              if (content) {
                chrome.runtime.sendMessage({
                  action: "streamUpdate",
                  data: {
                    content: content,
                    isFirstChunk: false
                  }
                });
              }
            } catch (e) {
              console.log("解析最后数据块失败:", e);
            }
          }
          return;
        }

        // 将新的数据块添加到缓冲区
        const chunk = new TextDecoder().decode(value);
        buffer += chunk;

        // 处理数据流
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留最后一个不完整的行

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') {
              continue;
            }

            try {
              const data = JSON.parse(dataStr);
              const content = data.choices?.[0]?.delta?.content;

              if (content) {
                chrome.runtime.sendMessage({
                  action: "streamUpdate",
                  data: {
                    content: content,
                    isFirstChunk: isFirstChunk
                  }
                });

                if (isFirstChunk) {
                  isFirstChunk = false;
                }
              }
            } catch (e) {
              console.log("解析流式数据失败:", e, "原始数据:", dataStr);
            }
          }
        }

        // 继续读取
        return reader.read().then(processText);
      }

      return reader.read().then(processText);
    })
    .catch((err) => {
      console.log('Safari模式侧边栏流式请求失败，尝试非流式请求:', err.message);
      chrome.runtime.sendMessage({
        action: "streamUpdate",
        data: {
          content: '正在分析（非流式模式）...',
          isFirstChunk: true
        }
      });

      // 尝试非流式请求
      fetch(config.apiBaseURL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
          "x-gemini-legacy-support": "true"
        },
        body: JSON.stringify({
          model: config.apiModel,
          messages: messages,
          stream: false,
          temperature: 1
        })
      })
      .then((response) => response.json())
      .then((data) => {
        const content = data.choices?.[0]?.message?.content || '分析失败';
        chrome.runtime.sendMessage({
          action: "streamUpdate",
          data: {
            content: content,
            isFirstChunk: true
          }
        });
      })
      .catch((nonStreamErr) => {
        chrome.runtime.sendMessage({
          action: "streamUpdate",
          data: {
            content: `分析出错: ${nonStreamErr.message}`,
            isFirstChunk: true
          }
        });
        console.error('Safari模式侧边栏非流式AI分析也失败:', nonStreamErr);
      });
    });
  });
}

// 标准模式的侧边栏实现方式（通过background处理）
function useBackgroundSidebarStreamAnalysis(word, sentence, messages) {
  // 设置流式处理的上下文
  window.currentStreamContext = {
    type: 'sidebar',
    word: word,
    sentence: sentence
  };

  // 通过background处理流式请求
  makeAIRequest({ word, sentence, stream: true, messages })
    .then((response) => {
      // 如果返回的是流式响应标识，说明background正在处理流式数据
      if (response.success && response.stream) {
        console.log('侧边栏流式请求已启动，等待background发送数据');
        return;
      }

      // 如果不是流式响应，按原来的方式处理
      const reader = response.body.getReader();
      let buffer = '';
      let isFirstChunk = true;

      function processText({ done, value }) {
        if (done) {
          // 处理最后可能残留的数据
          if (buffer) {
            try {
              const data = JSON.parse(buffer);
              const content = data.choices?.[0]?.delta?.content;
              if (content) {
                // 发送到侧边栏
                chrome.runtime.sendMessage({
                  action: "streamUpdate",
                  data: {
                    content: content,
                    isFirstChunk: false
                  }
                });
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
          return;
        }

        // 将新的数据块添加到缓冲区
        const chunk = new TextDecoder().decode(value);
        buffer += chunk;

        // 处理数据流
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留最后一个不完整的行

        lines.forEach((line) => {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const content = data.choices?.[0]?.delta?.content;
              if (content) {
                // 发送到侧边栏
                chrome.runtime.sendMessage({
                  action: "streamUpdate",
                  data: {
                    content: content,
                    isFirstChunk: isFirstChunk
                  }
                });

                if (isFirstChunk) {
                  isFirstChunk = false;
                }
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        });

        // 继续读取
        return reader.read().then(processText);
      }

      return reader.read().then(processText);
    })
    .catch((err) => {
      console.log('侧边栏流式请求失败，尝试非流式请求:', err.message);
      // 如果流式请求失败（比如在Firefox中），尝试非流式请求
      if (err.message.includes('流式请求暂时不支持')) {
        chrome.runtime.sendMessage({
          action: "streamUpdate",
          data: {
            content: '正在分析（非流式模式）...',
            isFirstChunk: true
          }
        });

        makeAIRequest({ word, sentence, stream: false, messages })
          .then((data) => {
            const content = data.choices?.[0]?.message?.content || '分析失败';
            chrome.runtime.sendMessage({
              action: "streamUpdate",
              data: {
                content: content,
                isFirstChunk: true
              }
            });
          })
          .catch((nonStreamErr) => {
            chrome.runtime.sendMessage({
              action: "streamUpdate",
              data: {
                content: `分析出错: ${nonStreamErr.message}`,
                isFirstChunk: true
              }
            });
            console.error('侧边栏非流式AI分析也失败:', nonStreamErr);
          });
      } else {
        // 向侧边栏发送错误信息
        chrome.runtime.sendMessage({
          action: "streamUpdate",
          data: {
            content: `分析出错: ${err.message}`,
            isFirstChunk: true
          }
        });
        console.error('AI分析失败:', err);
      }
    });
}
