/**
 * Pure validators for the /api/recognize-food endpoint.
 *
 * Kept dependency-free and CommonJS so both `server/api.cjs` and the
 * Vitest suite can `require` them directly.
 *
 * SECURITY BOUNDARY
 * -----------------
 * Everything that decides whether an incoming HTTP request is allowed
 * to influence the upstream Qwen call lives here. The handlers in
 * `api.cjs` should only translate the result of these functions into
 * HTTP responses; they should not re-implement validation.
 */

const MAX_BODY_BYTES = 6 * 1024 * 1024;

const ALLOWED_IMAGE_PREFIXES = [
  "data:image/jpeg;base64,",
  "data:image/png;base64,",
  "data:image/webp;base64,",
];

const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"];

const FORBIDDEN_IMAGE_PREFIXES = [
  "data:image/svg",
  "data:image/svg+xml",
  "data:image/bmp",
  "data:image/gif",
  "data:image/tiff",
];

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

const HTTP_IMAGE_RE = /^https?:\/\//i;

const MAX_BODY_BYTES_FOR_HUMAN = "6 MB";

/**
 * Strip the Data URL prefix from a base64 image string and validate
 * the resulting payload.
 *
 * Returns:
 *   { ok: true, mime, base64 }
 *   { ok: false, code, message }
 */
function parseImageDataUrl(raw) {
  if (typeof raw !== "string") {
    return { ok: false, code: "INVALID_REQUEST", message: "imageBase64 必须是字符串" };
  }
  const value = raw.trim();
  if (value.length === 0) {
    return { ok: false, code: "INVALID_REQUEST", message: "imageBase64 不能为空" };
  }
  if (HTTP_IMAGE_RE.test(value)) {
    return { ok: false, code: "INVALID_REQUEST", message: "不支持远程图片 URL，请使用 base64 Data URL" };
  }
  for (const prefix of FORBIDDEN_IMAGE_PREFIXES) {
    if (value.toLowerCase().startsWith(prefix)) {
      return { ok: false, code: "UNSUPPORTED_MEDIA", message: "不支持的图片格式" };
    }
  }
  if (!value.startsWith("data:")) {
    return { ok: false, code: "INVALID_REQUEST", message: "imageBase64 必须是 Data URL" };
  }
  let prefix = null;
  for (const candidate of ALLOWED_IMAGE_PREFIXES) {
    if (value.startsWith(candidate)) {
      prefix = candidate;
      break;
    }
  }
  if (!prefix) {
    return { ok: false, code: "UNSUPPORTED_MEDIA", message: "仅支持 jpeg / png / webp 格式" };
  }
  const base64 = value.slice(prefix.length);
  if (base64.length === 0) {
    return { ok: false, code: "INVALID_REQUEST", message: "imageBase64 数据为空" };
  }
  if (base64.length % 4 !== 0 || !BASE64_RE.test(base64)) {
    return { ok: false, code: "INVALID_REQUEST", message: "imageBase64 编码格式不合法" };
  }
  return { ok: true, mime: prefix.slice(5, prefix.indexOf(";")), base64 };
}

/**
 * Validate the JSON body of a /api/recognize-food request.
 *
 * Extra fields are ignored on purpose: the browser MUST NOT be able to
 * influence the model name, system prompt, or generation parameters.
 */
function validateRecognizeBody(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "INVALID_REQUEST", message: "请求体必须是 JSON 对象" };
  }
  const result = parseImageDataUrl(body.imageBase64);
  return result;
}

/**
 * Build the upstream Qwen request body. The browser never gets a say
 * in any of these fields.
 */
function buildUpstreamRequest(imageBase64, env) {
  const systemPrompt = env.SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;
  const model = env.QWEN_MODEL || DEFAULT_QWEN_MODEL;
  return {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageBase64 } },
          { type: "text", text: "请分析这张食物图片，识别所有食物并估算热量。" },
        ],
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
  };
}

const DEFAULT_SYSTEM_PROMPT = `你是一个专业的营养分析助手，擅长从食物图片中准确识别食物种类并估算营养信息。

当用户上传食物图片时，你需要：
1. 识别图中所有可见食物（最多 20 种）
2. 如果图中有参照物（手、筷子、碗、勺子、硬币等），利用参照物推算食物的实际尺寸和重量
3. 估算每种食物的重量（克）—— 单张照片的重量只是视觉估算，存在不确定性
4. 计算每种食物的热量

参照物尺寸参考：
- 成人手掌长 ≈ 18cm
- 筷子长 ≈ 24cm
- 标准碗口径 ≈ 14cm
- 汤勺长 ≈ 5cm
- 1元硬币直径 ≈ 2.5cm

输出要求：
- 最多返回 20 种食物；不要捏造看不见的食物
- 如果图片不是食物或者完全无法识别，返回空 foods 数组并在 note 中说明
- 对不确定的食物，把 confidence 设为 "low"，并在 note 中说明
- name 字段使用最常见的中文标准食品名（不要带"一份""大概"等修饰词）
  例如："白米饭" 而不是 "大概一碗米饭"
- 常见食物尽量使用通用名称（米饭、面条、鸡蛋、苹果、白菜、牛奶、宫保鸡丁 等）
- 不要宣称单张照片可以精确计算重量；重量只是视觉估算
- 在 note 字段中说明估算的不确定性和依据

必须以合法 JSON 格式输出，结构如下：
{
  "foods": [
    {
      "name": "食物名称（中文，使用常见标准名）",
      "weight_g": 估算克重（数字，单位克）,
      "calories_per_100g": 每100g热量（数字，单位kcal）,
      "total_calories": 该食物总热量（数字，单位kcal）,
      "boohee_code": "如果你非常确定对应薄荷食物 code，可填入；不确定则留空字符串",
      "confidence": "high 或 med 或 low"
    }
  ],
  "total_calories": 所有食物热量之和（数字）,
  "note": "补充说明，如不确定的食物、估算依据等，没有则留空字符串"
}
不要在 JSON 外面输出任何解释文字。`;

const DEFAULT_QWEN_MODEL = "qwen3-vl-flash";

module.exports.MAX_BODY_BYTES = MAX_BODY_BYTES;
module.exports.MAX_BODY_BYTES_FOR_HUMAN = MAX_BODY_BYTES_FOR_HUMAN;
module.exports.ALLOWED_IMAGE_MIME = ALLOWED_IMAGE_MIME;
module.exports.parseImageDataUrl = parseImageDataUrl;
module.exports.validateRecognizeBody = validateRecognizeBody;
module.exports.buildUpstreamRequest = buildUpstreamRequest;
module.exports.DEFAULT_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT;
module.exports.DEFAULT_QWEN_MODEL = DEFAULT_QWEN_MODEL;
