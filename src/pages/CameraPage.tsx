import { ImagePicker } from "../components/recognition/ImagePicker";

interface CameraPageProps {
  onImagePicked: (image: { recognize: string; thumbnail: string | null }) => void | Promise<void>;
  onError: (message: string) => void;
  onBack: () => void;
  onDemo: () => void;
}

export function CameraPage({ onImagePicked, onError, onBack, onDemo }: CameraPageProps) {
  return (
    <main className="screen active">
      <div className="screen-header">
        <button className="btn-ghost" type="button" onClick={onBack}>
          ← 返回
        </button>
        <div className="screen-title">拍照引导</div>
        <button className="btn-ghost" type="button" onClick={onDemo}>
          演示
        </button>
      </div>
      <section className="camera-stage">
        <div>
          <div className="viewfinder">
            <div className="hand-guide">把手放这里</div>
            <div className="finder-copy">把手放在食物旁边一起拍</div>
          </div>
          <div className="panel" style={{ marginTop: 14 }}>
            <div className="text-lg">把手放在食物旁边一起拍</div>
            <div className="text-sm" style={{ color: "var(--c-muted)" }}>
              俯拍效果更好，光线充足识别更准
            </div>
          </div>
          <ImagePicker onPicked={onImagePicked} onError={onError} />
        </div>
      </section>
    </main>
  );
}
