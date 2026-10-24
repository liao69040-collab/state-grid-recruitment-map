<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

interface IonParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  phase: number;
}

const props = withDefaults(defineProps<{
  motionKey?: string;
  density?: number;
}>(), {
  motionKey: "default",
  density: 34,
});

const canvasRef = ref<HTMLCanvasElement | null>(null);
let context: CanvasRenderingContext2D | null = null;
let particles: IonParticle[] = [];
let frameId = 0;
let resizeObserver: ResizeObserver | null = null;
let reduceMotionQuery: MediaQueryList | null = null;
let reducedMotion = false;
let width = 0;
let height = 0;
let lastTime = 0;
let sceneEnergy = 0;

const randomParticle = (): IonParticle => ({
  x: Math.random() * Math.max(width, 1),
  y: Math.random() * Math.max(height, 1),
  vx: (Math.random() - 0.42) * 8,
  vy: (Math.random() - 0.5) * 5,
  radius: 0.7 + Math.random() * 1.35,
  alpha: 0.22 + Math.random() * 0.44,
  phase: Math.random() * Math.PI * 2,
});

const createParticles = () => {
  const areaDensity = Math.round((width * height) / 28_000);
  const count = Math.max(16, Math.min(props.density, areaDensity));
  particles = Array.from({ length: count }, randomParticle);
};

const resizeCanvas = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  width = Math.max(1, rect.width);
  height = Math.max(1, rect.height);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  context = canvas.getContext("2d");
  context?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  createParticles();
};

const drawConnections = () => {
  if (!context) return;
  for (let index = 0; index < particles.length; index += 1) {
    const first = particles[index];
    for (let nextIndex = index + 1; nextIndex < particles.length; nextIndex += 1) {
      const second = particles[nextIndex];
      const dx = first.x - second.x;
      const dy = first.y - second.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 105) continue;
      context.beginPath();
      context.moveTo(first.x, first.y);
      context.lineTo(second.x, second.y);
      context.strokeStyle = `rgba(47, 171, 231, ${(1 - distance / 105) * 0.09})`;
      context.lineWidth = 0.7;
      context.stroke();
    }
  }
};

const drawParticle = (particle: IonParticle, time: number) => {
  if (!context) return;
  const shimmer = reducedMotion ? 0.72 : 0.66 + Math.sin(time * 0.0016 + particle.phase) * 0.2;
  const glowRadius = particle.radius * (5.6 + sceneEnergy * 2.2);
  const glow = context.createRadialGradient(
    particle.x,
    particle.y,
    0,
    particle.x,
    particle.y,
    glowRadius,
  );
  glow.addColorStop(0, `rgba(216, 250, 255, ${particle.alpha * shimmer})`);
  glow.addColorStop(0.3, `rgba(68, 191, 241, ${particle.alpha * 0.5 * shimmer})`);
  glow.addColorStop(1, "rgba(34, 145, 218, 0)");
  context.fillStyle = glow;
  context.beginPath();
  context.arc(particle.x, particle.y, glowRadius, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = `rgba(236, 253, 255, ${Math.min(0.92, particle.alpha + sceneEnergy * 0.18)})`;
  context.beginPath();
  context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
  context.fill();
};

const updateParticle = (particle: IonParticle, delta: number) => {
  particle.x += particle.vx * delta;
  particle.y += particle.vy * delta;
  if (particle.x < -18) particle.x = width + 18;
  if (particle.x > width + 18) particle.x = -18;
  if (particle.y < -18) particle.y = height + 18;
  if (particle.y > height + 18) particle.y = -18;
};

const renderFrame = (time = 0) => {
  frameId = 0;
  if (!context || !width || !height) return;
  const delta = Math.min(0.04, Math.max(0, (time - lastTime) / 1000 || 0));
  lastTime = time;
  context.clearRect(0, 0, width, height);
  drawConnections();
  particles.forEach((particle) => {
    if (!reducedMotion) updateParticle(particle, delta);
    drawParticle(particle, time);
  });
  sceneEnergy = Math.max(0, sceneEnergy - delta * 1.7);
  if (!reducedMotion && !document.hidden) frameId = window.requestAnimationFrame(renderFrame);
};

const startAnimation = () => {
  if (frameId) window.cancelAnimationFrame(frameId);
  lastTime = 0;
  if (reducedMotion) {
    renderFrame(0);
    return;
  }
  frameId = window.requestAnimationFrame(renderFrame);
};

const handleMotionPreference = () => {
  reducedMotion = Boolean(reduceMotionQuery?.matches);
  startAnimation();
};

const handleVisibility = () => {
  if (document.hidden) {
    if (frameId) window.cancelAnimationFrame(frameId);
    frameId = 0;
    return;
  }
  startAnimation();
};

watch(() => props.motionKey, () => {
  if (reducedMotion) return;
  sceneEnergy = 1;
  particles.forEach((particle) => {
    particle.vx += (Math.random() - 0.28) * 5;
    particle.vy += (Math.random() - 0.5) * 3;
  });
});

onMounted(() => {
  reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  reducedMotion = reduceMotionQuery.matches;
  reduceMotionQuery.addEventListener("change", handleMotionPreference);
  resizeObserver = new ResizeObserver(resizeCanvas);
  if (canvasRef.value) resizeObserver.observe(canvasRef.value);
  document.addEventListener("visibilitychange", handleVisibility);
  resizeCanvas();
  startAnimation();
});

onBeforeUnmount(() => {
  if (frameId) window.cancelAnimationFrame(frameId);
  resizeObserver?.disconnect();
  reduceMotionQuery?.removeEventListener("change", handleMotionPreference);
  document.removeEventListener("visibilitychange", handleVisibility);
});
</script>

<template>
  <canvas ref="canvasRef" class="ion-field" aria-hidden="true"></canvas>
</template>

<style scoped>
.ion-field {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
