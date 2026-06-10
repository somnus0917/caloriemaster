export interface CompressOptions {
  maxWidth: number;
  quality: number;
}

export async function compressImage(
  file: File,
  options: CompressOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, options.maxWidth / img.width);
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("图片压缩失败"));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("图片压缩失败"));
              return;
            }
            const reader = new FileReader();
            reader.onload = (event) => {
              const result = event.target?.result;
              if (typeof result === "string") {
                resolve(result);
              } else {
                reject(new Error("图片读取失败"));
              }
            };
            reader.onerror = () => reject(new Error("图片读取失败"));
            reader.readAsDataURL(blob);
          },
          "image/jpeg",
          options.quality,
        );
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片加载失败"));
    };
    img.src = objectUrl;
  });
}

export async function compressForRecognition(file: File): Promise<string> {
  return compressImage(file, { maxWidth: 1024, quality: 0.85 });
}

export async function compressForThumbnail(file: File): Promise<string | null> {
  try {
    return await compressImage(file, { maxWidth: 64, quality: 0.7 });
  } catch {
    return null;
  }
}
