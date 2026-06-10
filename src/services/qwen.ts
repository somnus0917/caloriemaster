import type { Food, RecognitionResult } from "../types";
import {
  computeTotalCalories,
  sanitizeCaloriesPer100g,
  sanitizeConfidence,
  sanitizeHealthLight,
  sanitizeName,
  sanitizeOptionalNumber,
  sanitizeWeight,
} from "../utils/validation";
import { fetchWithTimeout, mapHttpError } from "./http";

const SYSTEM_PROMPT = `你是一个专业的营养分析助手，擅长从食物图片中准确识别食物种类并估算营养信息。

当用户上传食物图片时，你需要：
1. 识别图中所有可见食物
2. 如果图中有参照物（手、筷子、碗、勺子等），利用参照物推算食物的实际尺寸和重量
3. 估算每种食物的重量（克）
4. 计算每种食物的热量

参照物尺寸参考：
- 成人手掌长 ≈ 18cm
- 筷子长 ≈ 24cm
- 标准碗口径 ≈ 14cm
- 汤勺长 ≈ 5cm
- 1元硬币直径 ≈ 2.5cm

输出要求：
- name 字段使用最常见的中文名称（不要带"一份""大概"等修饰词）
  例如："白米饭" 而不是 "大概一碗米饭"
- 常见食物尽量使用通用名称（米饭、面条、鸡蛋、苹果、白菜、牛奶、宫保鸡丁 等）

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

interface RawFood {
  name?: unknown;
  weight_g?: unknown;
  calories_per_100g?: unknown;
  total_calories?: unknown;
  boohee_code?: unknown;
  code?: unknown;
  confidence?: unknown;
  cal_source?: unknown;
  protein_per_100g?: unknown;
  fat_per_100g?: unknown;
  carbohydrate_per_100g?: unknown;
  health_light?: unknown;
}

function normalizeFood(raw: RawFood): Food {
  const weight = sanitizeWeight(raw.weight_g);
  const caloriesPer100g = sanitizeCaloriesPer100g(raw.calories_per_100g);
  const code = typeof raw.boohee_code === "string"
    ? raw.boohee_code
    : typeof raw.code === "string"
      ? raw.code
      : "";
  return {
    name: sanitizeName(raw.name),
    weight_g: weight,
    calories_per_100g: caloriesPer100g,
    total_calories: computeTotalCalories(caloriesPer100g, weight),
    boohee_code: code,
    confidence: sanitizeConfidence(raw.confidence),
    cal_source:
      raw.cal_source === "boohee" || raw.cal_source === "local_lookup_miss"
        ? raw.cal_source
        : "ai_estimate",
    protein_per_100g: sanitizeOptionalNumber(raw.protein_per_100g),
    fat_per_100g: sanitizeOptionalNumber(raw.fat_per_100g),
    carbohydrate_per_100g: sanitizeOptionalNumber(raw.carbohydrate_per_100g),
    health_light: sanitizeHealthLight(raw.health_light),
  };
}

export function normalizeAiResult(parsed: unknown): RecognitionResult {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI 返回格式异常");
  }
  const result = parsed as { foods?: unknown; note?: unknown };
  if (!Array.isArray(result.foods) || result.foods.length === 0) {
    throw new Error("AI 返回格式异常");
  }
  const foods = result.foods
    .map((f) => (f && typeof f === "object" ? normalizeFood(f as RawFood) : null))
    .filter((f): f is Food => f !== null);
  if (foods.length === 0) {
    throw new Error("AI 返回格式异常");
  }
  return {
    foods,
    total_calories: foods.reduce((s, f) => s + f.total_calories, 0),
    note: typeof result.note === "string" ? result.note : "",
  };
}

/**
 * Parse a JSON string from the model, optionally wrapped in a single
 * ```json ... ``` fence. The previous implementation used a greedy regex
 * which could swallow too much; this version prefers JSON.parse and only
 * strips the outermost fence.
 */
export function parseAiContent(content: string): unknown {
  const trimmed = content.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const target = fence ? fence[1] : trimmed;
  return JSON.parse(target);
}

export interface RecognizeOptions {
  imageBase64: string;
  timeoutMs?: number;
}

/**
 * Call Qwen through the local /api/qwen proxy. The proxy holds the
 * QWEN_API_KEY (loaded from .env on the server) and forwards the request.
 * The browser never sees the key.
 */
export async function recognizeFood({
  imageBase64,
  timeoutMs,
}: RecognizeOptions): Promise<RecognitionResult> {
  const response = await fetchWithTimeout(
    "/api/qwen",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageBase64 } },
              { type: "text", text: "请分析这张食物图片，识别所有食物并估算热量。" },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
      timeoutMs,
    },
  );

  if (!response.ok) {
    let body: { error?: { message?: string } } | undefined;
    try {
      body = (await response.json()) as { error?: { message?: string } };
    } catch {
      body = undefined;
    }
    throw mapHttpError(response.status, body);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI 返回格式异常");
  }
  let parsed: unknown;
  try {
    parsed = parseAiContent(content);
  } catch {
    throw new Error("AI 返回格式异常");
  }
  return normalizeAiResult(parsed);
}
