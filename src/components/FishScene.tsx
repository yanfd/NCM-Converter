import { useMemo } from "react";

interface Fish {
  id: number;
  color1: string;
  color2: string;
  size: number;
  y: number;
  duration: number;
  delay: number;
  direction: "left" | "right";
  opacity: number;
  wave: number;
}

const KOI_COLORS: [string, string][] = [
  ["#ff6b35", "#ff9f1c"],
  ["#e63946", "#ff8fa3"],
  ["#ffffff", "#f1faee"],
  ["#2a9d8f", "#48cae4"],
  ["#ffd60a", "#ffc300"],
  ["#e63946", "#ffffff"],
  ["#ff6b35", "#ffffff"],
  ["#264653", "#2a9d8f"],
];

function randomFish(id: number): Fish {
  const colors = KOI_COLORS[id % KOI_COLORS.length];
  return {
    id,
    color1: colors[0],
    color2: colors[1],
    size: 22 + Math.random() * 28,
    y: 15 + Math.random() * 70,
    duration: 10 + Math.random() * 16,
    delay: Math.random() * -18,
    direction: Math.random() > 0.5 ? "left" : "right",
    opacity: 0.35 + Math.random() * 0.45,
    wave: 8 + Math.random() * 18,
  };
}

function KoiFish({ fish }: { fish: Fish }) {
  const s = fish.size;
  const flip = fish.direction === "left" ? "scaleX(-1)" : "";

  return (
    <div
      className="fish"
      style={{
        top: `${fish.y}%`,
        opacity: fish.opacity,
        animationDuration: `${fish.duration}s`,
        animationDelay: `${fish.delay}s`,
        transform: flip,
      }}
    >
      <svg width={s} height={s * 0.55} viewBox="0 0 60 33" fill="none">
        <ellipse cx="28" cy="16" rx="20" ry="11" fill={fish.color1} />
        <ellipse cx="22" cy="13" rx="8" ry="6" fill={fish.color2} opacity="0.7" />
        <ellipse cx="32" cy="18" rx="5" ry="4" fill={fish.color2} opacity="0.5" />
        <ellipse cx="28" cy="20" rx="14" ry="4" fill="rgba(255,255,255,0.2)" />
        <path d="M46 16 Q52 8 58 4 Q54 16 58 28 Q52 22 46 16Z" fill={fish.color1} opacity="0.85" />
        <path d="M22 5 Q26 2 30 5 Q27 8 22 5Z" fill={fish.color1} opacity="0.7" />
        <circle cx="14" cy="14" r="2" fill="#1a1a2e" />
        <circle cx="13.5" cy="13.5" r="0.7" fill="#fff" />
        <path d="M20 20 Q18 26 22 28 Q22 22 20 20Z" fill={fish.color1} opacity="0.6" />
      </svg>
    </div>
  );
}

/** Fish + bubbles scene, rendered behind panels */
export function FishContent() {
  const fishes = useMemo(() => Array.from({ length: 12 }, (_, i) => randomFish(i)), []);

  return (
    <div className="fish-scene">
      {fishes.map((f) => (
        <KoiFish key={f.id} fish={f} />
      ))}
      {Array.from({ length: 18 }, (_, i) => (
        <div
          key={`b${i}`}
          className="bubble"
          style={{
            left: `${5 + Math.random() * 90}%`,
            width: `${3 + Math.random() * 10}px`,
            height: `${3 + Math.random() * 10}px`,
            animationDuration: `${5 + Math.random() * 10}s`,
            animationDelay: `${Math.random() * -10}s`,
            opacity: 0.12 + Math.random() * 0.25,
          }}
        />
      ))}
    </div>
  );
}

/** Dolphins rendered ABOVE panels, directly in App root */
export function Dolphins() {
  return (
    <>
      <div className="dolphin dolphin--right" />
      <div className="dolphin dolphin--left" />
    </>
  );
}
