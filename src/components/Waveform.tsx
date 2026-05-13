import { useEffect, useRef } from "react";

interface WaveformProps {
  // Whether the mic is actively recording
  active: boolean;
  // Real-time mic level (0..1)
  level: number;
  // Waveform bar color (default: Apple system blue)
  color?: string;
}

export default function Waveform({ active, level, color = "rgba(80, 160, 255," }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const tRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const BAR_WIDTH = 2;
    const BAR_GAP = 2;
    const TOTAL = BAR_WIDTH + BAR_GAP;
    const NUM_BARS = Math.floor(W / TOTAL);
    const CENTER = H / 2;
    const MIN_HEIGHT = 2;
    const MAX_HEIGHT = H * 0.75;

    // Speed multiplier — animate slowly when idle, lively when recording
    const speed = active ? 0.07 : 0.015;
    const amplitudeScale = active ? (0.2 + level * 1.1) : 0.05;

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);

      for (let i = 0; i < NUM_BARS; i++) {
        const norm = i / NUM_BARS;

        // Soft fade at the edges (Apple style)
        const edgeFade = Math.sin(norm * Math.PI);

        // Layered sine waves for organic, voice-like motion
        const wave =
          Math.sin(norm * 14 + tRef.current * 1.4) * 0.55 +
          Math.sin(norm * 23 + tRef.current * 0.9) * 0.3 +
          Math.sin(norm * 7  + tRef.current * 2.1) * 0.2 +
          Math.sin(norm * 31 + tRef.current * 0.6) * 0.15;

        const amp = Math.abs(wave) * edgeFade * amplitudeScale;
        const height = MIN_HEIGHT + amp * (MAX_HEIGHT - MIN_HEIGHT);

        const x = i * TOTAL + (W - NUM_BARS * TOTAL) / 2;
        const y = CENTER - height / 2;
        const alpha = 0.4 + edgeFade * 0.6;

        ctx.fillStyle = withAlpha(color, alpha);

        // Rounded pill bars
        const r = BAR_WIDTH / 2;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + BAR_WIDTH - r, y);
        ctx.arcTo(x + BAR_WIDTH, y, x + BAR_WIDTH, y + r, r);
        ctx.lineTo(x + BAR_WIDTH, y + height - r);
        ctx.arcTo(x + BAR_WIDTH, y + height, x + BAR_WIDTH - r, y + height, r);
        ctx.lineTo(x + r, y + height);
        ctx.arcTo(x, y + height, x, y + height - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
        ctx.fill();
      }

      tRef.current += speed;
      animRef.current = requestAnimationFrame(draw);
    }

    draw();

    // Cleanup animation frame on unmount or when props change
    return () => cancelAnimationFrame(animRef.current);
  }, [active, color, level]);

  return (
    <canvas
      ref={canvasRef}
      width={484}
      height={40}
      style={{ width: "100%", height: "40px", display: "block" }}
    />
  );
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("rgba(")) {
    return color.replace(/rgba\(([^)]+)\)/, (_m, inner) => {
      const parts = inner.split(",").map((p: string) => p.trim());
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
    });
  }
  if (color.startsWith("#")) {
    const hex = color.replace("#", "");
    const full = hex.length === 3
      ? hex.split("").map((c) => c + c).join("")
      : hex;
    const r = Number.parseInt(full.slice(0, 2), 16);
    const g = Number.parseInt(full.slice(2, 4), 16);
    const b = Number.parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}
