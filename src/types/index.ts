export type Confidence = "high" | "med" | "low";

export type CalSource = "ai_estimate" | "boohee" | "local_lookup_miss";

export type HealthLight = 0 | 1 | 2 | 3;

export interface Food {
  name: string;
  weight_g: number;
  calories_per_100g: number;
  total_calories: number;
  boohee_code?: string;
  confidence: Confidence;
  cal_source: CalSource;
  protein_per_100g?: number | null;
  fat_per_100g?: number | null;
  carbohydrate_per_100g?: number | null;
  health_light?: HealthLight;
  food_image_url?: string;
}

export interface RecognitionResult {
  foods: Food[];
  total_calories: number;
  note: string;
}

export interface Record {
  id: string;
  timestamp: number;
  mealType: string;
  foods: Food[];
  totalCalories: number;
  thumbnailUrl: string | null;
  /** True iff the server has an OSS image for this record. */
  hasImage: boolean;
  imageMimeType?: string | null;
  imageSize?: number | null;
  /** True iff the server has an OSS original image for this record. */
  hasOriginalImage: boolean;
  originalImageMimeType?: string | null;
  originalImageSize?: number | null;
  isDemo?: boolean;
}

export interface Settings {
  dailyGoal: number;
  dailyLimit: number;
}

export type ScreenName = "home" | "camera" | "confirm" | "history";

export interface DayStat {
  date: Date;
  isoDate: string;
  label: string;
  calories: number;
  isToday: boolean;
}

export type AdjustMode = "slider" | "stepper" | "input";

export type PortionMultiplier = 0.5 | 1 | 1.5 | 2;
