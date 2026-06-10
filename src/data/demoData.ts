import type { Food, Record } from "../types";
import { getMealType } from "../utils/dates";

interface TemplateFood {
  name: string;
  weight_g: number;
  total_calories: number;
}

interface TemplateMeal {
  hour: number;
  foods: TemplateFood[];
}

interface TemplateDay {
  /** Days ago. 0 = today, 1 = yesterday, etc. */
  offset: number;
  meals: TemplateMeal[];
}

const TEMPLATE: TemplateDay[] = [
  {
    offset: 6,
    meals: [
      {
        hour: 8,
        foods: [
          { name: "包子", weight_g: 100, total_calories: 227 },
          { name: "豆浆", weight_g: 250, total_calories: 65 },
        ],
      },
      {
        hour: 19,
        foods: [
          { name: "米饭", weight_g: 150, total_calories: 174 },
          { name: "宫保鸡丁", weight_g: 150, total_calories: 270 },
          { name: "炒青菜", weight_g: 120, total_calories: 54 },
        ],
      },
    ],
  },
  {
    offset: 5,
    meals: [
      {
        hour: 13,
        foods: [{ name: "牛肉面", weight_g: 400, total_calories: 540 }],
      },
      {
        hour: 20,
        foods: [
          { name: "米饭", weight_g: 120, total_calories: 139 },
          { name: "红烧鱼", weight_g: 180, total_calories: 270 },
        ],
      },
    ],
  },
  {
    offset: 4,
    meals: [
      {
        hour: 12,
        foods: [
          { name: "麻辣烫", weight_g: 600, total_calories: 720 },
          { name: "可乐", weight_g: 500, total_calories: 215 },
        ],
      },
      {
        hour: 15,
        foods: [{ name: "蛋糕", weight_g: 120, total_calories: 360 }],
      },
      {
        hour: 19,
        foods: [
          { name: "烧烤", weight_g: 300, total_calories: 720 },
          { name: "啤酒", weight_g: 500, total_calories: 215 },
        ],
      },
    ],
  },
  {
    offset: 3,
    meals: [
      {
        hour: 13,
        foods: [
          { name: "沙拉", weight_g: 250, total_calories: 130 },
          { name: "酸奶", weight_g: 150, total_calories: 90 },
        ],
      },
    ],
  },
  {
    offset: 2,
    meals: [
      {
        hour: 8,
        foods: [
          { name: "燕麦片", weight_g: 50, total_calories: 180 },
          { name: "牛奶", weight_g: 250, total_calories: 165 },
          { name: "苹果", weight_g: 200, total_calories: 100 },
        ],
      },
      {
        hour: 19,
        foods: [
          { name: "米饭", weight_g: 100, total_calories: 116 },
          { name: "清蒸鱼", weight_g: 150, total_calories: 165 },
          { name: "西兰花", weight_g: 150, total_calories: 51 },
        ],
      },
    ],
  },
  {
    offset: 1,
    meals: [
      {
        hour: 12,
        foods: [
          { name: "饺子", weight_g: 300, total_calories: 660 },
          { name: "紫菜蛋花汤", weight_g: 250, total_calories: 60 },
        ],
      },
      {
        hour: 19,
        foods: [
          { name: "米饭", weight_g: 130, total_calories: 151 },
          { name: "麻婆豆腐", weight_g: 180, total_calories: 252 },
          { name: "米饭", weight_g: 80, total_calories: 93 },
        ],
      },
    ],
  },
];

function buildFood(template: TemplateFood): Food {
  const calories_per_100g = Math.round((template.total_calories / template.weight_g) * 100);
  return {
    name: template.name,
    weight_g: template.weight_g,
    calories_per_100g,
    total_calories: template.total_calories,
    confidence: "med",
    cal_source: "ai_estimate",
  };
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 7);
}

export function buildDemoWeek(now: number = Date.now()): Record[] {
  const dayMs = 86400000;
  const records: Record[] = [];
  for (const day of TEMPLATE) {
    for (const meal of day.meals) {
      const base = now - day.offset * dayMs;
      const date = new Date(base);
      date.setHours(meal.hour, Math.floor(Math.random() * 50), 0, 0);
      const ts = date.getTime();
      const foods = meal.foods.map(buildFood);
      records.push({
        id: `demo-${day.offset}-${meal.hour}-${randomId()}`,
        timestamp: ts,
        mealType: getMealType(ts),
        foods,
        totalCalories: foods.reduce((s, f) => s + f.total_calories, 0),
        thumbnailUrl: null,
        hasImage: false,
        isDemo: true,
      });
    }
  }
  return records;
}

export const DEMO_RECOGNITION = {
  foods: [
    {
      name: "白米饭",
      weight_g: 150,
      calories_per_100g: 116,
      total_calories: 174,
      confidence: "high" as const,
      cal_source: "boohee" as const,
      health_light: 1 as const,
      protein_per_100g: 2.6,
      fat_per_100g: 0.3,
      carbohydrate_per_100g: 25.6,
      food_image_url: "https://static.boohee.cn/image/food/small/food_1001001.jpg",
    },
    {
      name: "红烧肉",
      weight_g: 120,
      calories_per_100g: 478,
      total_calories: 574,
      confidence: "med" as const,
      cal_source: "boohee" as const,
      health_light: 3 as const,
      protein_per_100g: 18.5,
      fat_per_100g: 45,
      carbohydrate_per_100g: 4.8,
      food_image_url: "https://static.boohee.cn/image/food/small/food_1007014.jpg",
    },
    {
      name: "清炒青菜",
      weight_g: 90,
      calories_per_100g: 45,
      total_calories: 41,
      confidence: "high" as const,
      cal_source: "boohee" as const,
      health_light: 1 as const,
      protein_per_100g: 1.8,
      fat_per_100g: 0.2,
      carbohydrate_per_100g: 8.1,
      food_image_url: "https://static.boohee.cn/image/food/small/food_1004002.jpg",
    },
  ],
  total_calories: 789,
  note: "演示数据用于体验克重调整和保存流程，未调用真实 API。",
} as const;
