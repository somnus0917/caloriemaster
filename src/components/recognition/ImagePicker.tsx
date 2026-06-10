import { useRef, type ChangeEvent } from "react";
import { compressForRecognition, compressForThumbnail } from "../../services/image";

interface ImagePickerProps {
  onPicked: (image: { recognize: string; thumbnail: string | null }) => void | Promise<void>;
  onError: (message: string) => void;
}

export function ImagePicker({ onPicked, onError }: ImagePickerProps) {
  const photoRef = useRef<HTMLInputElement | null>(null);
  const albumRef = useRef<HTMLInputElement | null>(null);

  const handleChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onError("请选择图片文件");
      return;
    }
    try {
      const [recognize, thumbnail] = await Promise.all([
        compressForRecognition(file),
        compressForThumbnail(file),
      ]);
      await onPicked({ recognize, thumbnail });
    } catch (error) {
      onError((error as Error).message || "图片处理失败，请重试");
    }
  };

  return (
    <>
      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleChange}
        hidden
        data-testid="photo-input"
      />
      <input
        ref={albumRef}
        type="file"
        accept="image/*"
        onChange={handleChange}
        hidden
        data-testid="album-input"
      />
      <div className="camera-actions">
        <button
          className="btn-primary"
          type="button"
          onClick={() => albumRef.current?.click()}
        >
          从相册选择
        </button>
        <button
          className="btn-solid"
          type="button"
          onClick={() => photoRef.current?.click()}
        >
          拍照
        </button>
      </div>
    </>
  );
}
