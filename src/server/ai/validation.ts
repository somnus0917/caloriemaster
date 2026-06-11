/**
 * Pure validators for the /api/recognize-food endpoint.
 *
 * SECURITY BOUNDARY: every input check that influences the upstream
 * Qwen call lives here. Routes in src/server/ai/routes.ts only
 * translate the result into HTTP responses.
 */
import { z } from "zod";

export const MAX_BODY_BYTES = 6 * 1024 * 1024;
export const MAX_FOODS = 20;
export const MIN_FOODS = 1;
export const WEIGHT_MIN = 10;
export const WEIGHT_MAX = 1000;
export const CAL_MIN = 0;
export const CAL_MAX = 1000;
export const NAME_MAX = 50;
export const THUMBNAIL_MAX = 1024 * 1024; // 1 MB Data URL for the client-side 512px jpeg.
export const NOTE_MAX = 500;

const ALLOWED_PREFIXES = [
  "data:image/jpeg;base64,",
  "data:image/png;base64,",
  "data:image/webp;base64,",
] as const;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const HTTP_IMAGE_RE = /^https?:\/\//i;

export interface ParsedImage {
  ok: true;
  mime: string;
  base64: string;
}

export interface ValidationError {
  ok: false;
  code:
    | "INVALID_REQUEST"
    | "UNSUPPORTED_MEDIA"
    | "PAYLOAD_TOO_LARGE";
  message: string;
}

export function parseImageDataUrl(raw: unknown): ParsedImage | ValidationError {
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
  const lower = value.toLowerCase();
  if (lower.startsWith("data:image/svg")) {
    return { ok: false, code: "UNSUPPORTED_MEDIA", message: "不支持 SVG" };
  }
  if (!value.startsWith("data:")) {
    return { ok: false, code: "INVALID_REQUEST", message: "imageBase64 必须是 Data URL" };
  }
  let prefix: (typeof ALLOWED_PREFIXES)[number] | null = null;
  for (const candidate of ALLOWED_PREFIXES) {
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

export const RecognizeFoodBodySchema = z
  .object({
    imageBase64: z.string(),
  })
  .passthrough(); // extra fields are intentionally allowed but ignored

export function validateRecognizeBody(body: unknown): ParsedImage | ValidationError {
  const parsed = RecognizeFoodBodySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_REQUEST", message: "请求体必须是 { imageBase64 }" };
  }
  return parseImageDataUrl(parsed.data.imageBase64);
}

export const DEFAULT_SYSTEM_PROMPT = `你是一个专业的营养分析助手，擅长从食物图片中准确识别食物种类并估算营养信息。

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

export const DEFAULT_QWEN_MODEL = "qwen3-vl-flash";

export const FoodItemInputSchema = z.object({
  name: z.string().min(1).max(NAME_MAX),
  weightG: z.number().min(WEIGHT_MIN).max(WEIGHT_MAX),
  caloriesPer100g: z.number().min(CAL_MIN).max(CAL_MAX),
  confidence: z.enum(["high", "med", "low"]).optional().default("med"),
  calorieSource: z.string().max(20).optional(),
  booheeCode: z.string().max(50).optional(),
  proteinPer100g: z.number().min(0).max(100).nullable().optional(),
  fatPer100g: z.number().min(0).max(100).nullable().optional(),
  carbohydratePer100g: z.number().min(0).max(100).nullable().optional(),
  healthLight: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
});

export const RecordInputSchema = z.object({
  timestamp: z.number().int().positive(),
  mealType: z.string().min(1).max(20),
  /** Legacy inline thumbnail — accepted during the one-shot localStorage migration. */
  thumbnailUrl: z
    .string()
    .max(THUMBNAIL_MAX)
    .nullable()
    .optional(),
  /** New image field: a small Data URL the server uploads to OSS. */
  thumbnailDataUrl: z
    .string()
    .max(THUMBNAIL_MAX)
    .optional(),
  sourceId: z.string().max(100).optional(),
  isDemo: z.boolean().optional().default(false),
  items: z.array(FoodItemInputSchema).min(MIN_FOODS).max(MAX_FOODS),
  note: z.string().max(NOTE_MAX).optional(),
});

export const ThumbnailActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("keep") }),
  z.object({ type: z.literal("remove") }),
  z.object({
    type: z.literal("replace"),
    dataUrl: z.string().min(1).max(THUMBNAIL_MAX),
  }),
]);

export type RecordInput = z.infer<typeof RecordInputSchema>;
export type FoodItemInput = z.infer<typeof FoodItemInputSchema>;

export const ImportBodySchema = z.object({
  records: z.array(RecordInputSchema).min(1).max(500),
});

/** Compute total calories for one item, rounded to int kcal. */
export function computeItemTotal(caloriesPer100g: number, weightG: number): number {
  return Math.round((caloriesPer100g * weightG) / 100);
}
