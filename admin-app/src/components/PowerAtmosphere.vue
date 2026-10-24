<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
withDefaults(defineProps<{ photoUrl?: string }>(), {
  photoUrl: '/assets/grid-atmosphere/transmission-20261004.webp',
});

// Decorative circuits are intentionally separate from the geographic map.
const pylons = [
  { key: 'near', transform: 'translate(1270 270) scale(1.24)', secondary: false },
  { key: 'middle', transform: 'translate(745 435) scale(.82)', secondary: true },
  { key: 'far', transform: 'translate(280 530) scale(.49)', secondary: true },
];
const circuits = [
  { key: 'upper-blue', d: 'M-90 176 C250 450 745 516 1150 297 C1360 420 1530 430 1710 168', duration: 10, delay: -2, secondary: false },
  { key: 'upper-mid', d: 'M-90 209 C250 483 745 549 1150 330 C1360 453 1530 463 1710 201', duration: 12, delay: -7, secondary: true },
  { key: 'upper-low', d: 'M-90 242 C250 516 745 582 1150 363 C1360 486 1530 496 1710 234', duration: 14, delay: -11, secondary: true },
  { key: 'lower-green', d: 'M-90 295 C310 632 860 625 1390 394 C1500 461 1610 452 1710 344', duration: 11, delay: -6, secondary: false },
  { key: 'lower-mid', d: 'M-90 328 C310 665 860 658 1390 427 C1500 494 1610 485 1710 377', duration: 13, delay: -3, secondary: true },
  { key: 'lower-low', d: 'M-90 361 C310 698 860 691 1390 460 C1500 527 1610 518 1710 410', duration: 9, delay: -5, secondary: true },
];
const packets = [
  { key: 'blue', d: circuits[0]!.d, duration: 10, delay: -2, secondary: false },
  { key: 'green', d: circuits[3]!.d, duration: 11, delay: -6, secondary: true },
];
const paused = ref(true);
const syncVisibility = () => { paused.value = document.hidden; };
onMounted(() => {
  syncVisibility();
  document.addEventListener('visibilitychange', syncVisibility);
});
onBeforeUnmount(() => document.removeEventListener('visibilitychange', syncVisibility));
</script>
<template>
  <div class="power-atmosphere" :class="{ 'is-paused': paused }" aria-hidden="true" inert>
    <div class="power-photo" :style="{ backgroundImage: `url(${photoUrl})` }"></div>
    <div class="power-mist"></div>
    <div class="power-glow power-glow-blue"></div>
    <div class="power-glow power-glow-green"></div>
    <svg class="power-currents power-grid-scene" viewBox="0 0 1600 1000" preserveAspectRatio="xMaxYMid slice" focusable="false">
      <g class="power-pylons">
        <g v-for="pylon in pylons" :key="pylon.key" class="power-pylon" :class="{ 'power-pylon-secondary': pylon.secondary }" :transform="pylon.transform">
          <path class="power-pylon-body" d="M-72 430 L-15 48 L-8 0 L8 0 L15 48 L72 430 M-72 430 H72 M-55 318 H55 M-39 213 H39 M-26 125 H26 M-15 48 H15" />
          <path class="power-pylon-bracing" d="M-72 430 L55 318 L-39 213 L26 125 L-15 48 M72 430 L-55 318 L39 213 L-26 125 L15 48 M-39 213 L55 318 M39 213 L-55 318" />
          <path class="power-pylon-arms" d="M-92 24 L-18 8 H18 L92 24 M-107 69 L-22 49 H22 L107 69 M-121 114 L-30 92 H30 L121 114 M-92 24 H92 M-107 69 H107 M-121 114 H121" />
          <path class="power-insulators" d="M-92 24 V44 M92 24 V44 M-107 69 V89 M107 69 V89 M-121 114 V134 M121 114 V134" />
          <path class="power-ground" d="M-98 433 H98" />
        </g>
      </g>
      <g class="power-wires">
        <path v-for="wire in circuits" :key="wire.key" :d="wire.d" class="power-circuit" :class="{ 'power-circuit-secondary': wire.secondary }" />
      </g>
      <g v-for="wire in circuits" :key="`flow-${wire.key}`" class="power-traces" :class="{ 'power-circuit-secondary': wire.secondary, 'power-traces-green': wire.key.startsWith('lower') }" :style="{ animationDuration: `${wire.duration}s`, animationDelay: `${wire.delay}s` }">
        <path :d="wire.d" pathLength="1000" />
      </g>
      <g v-for="packet in packets" :key="packet.key" class="power-particles" :class="{ 'power-particles-secondary': packet.secondary }" :style="{ animationDuration: `${packet.duration}s`, animationDelay: `${packet.delay}s` }">
        <path class="power-packet-halo" :d="packet.d" pathLength="1000" />
        <path class="power-packet-core" :d="packet.d" pathLength="1000" />
      </g>
    </svg>
  </div>
</template>
<style scoped>
.power-atmosphere { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; user-select: none; background: #e8f2fa; }
.power-photo, .power-mist, .power-currents { position: absolute; inset: 0; width: 100%; height: 100%; }
.power-photo { background-position: 58% 64%; background-size: cover; background-repeat: no-repeat; opacity: .18; }
.power-mist { background: linear-gradient(110deg,rgba(244,251,255,.64),rgba(232,246,253,.25) 48%,rgba(226,242,250,.12) 82%,rgba(237,248,253,.25)); }
.power-glow { position: absolute; width: 70vw; height: 70vw; border-radius: 50%; opacity: .32; background: radial-gradient(circle,rgba(84,163,210,.35),rgba(137,211,229,.12) 40%,transparent 66%); animation: power-drift 30s ease-in-out infinite alternate; }
.power-glow-blue { top: -40vw; right: -8vw; }
.power-glow-green { bottom: -48vw; right: -19vw; opacity: .24; background: radial-gradient(circle,rgba(79,165,155,.31),rgba(160,218,211,.12) 42%,transparent 67%); animation-delay: -14s; }
.power-currents { opacity: .88; fill: none; }
.power-currents path { vector-effect: non-scaling-stroke; }
.power-pylon { stroke: rgba(66,113,139,.32); stroke-width: 1.45; stroke-linecap: round; stroke-linejoin: round; }
.power-pylon-secondary { opacity: .56; }
.power-pylon-bracing { stroke-width: .85; opacity: .73; }
.power-pylon-arms { stroke-width: 1.6; }
.power-insulators { stroke: rgba(64,137,149,.40); stroke-width: 2.8; stroke-dasharray: 1 3; }
.power-ground { stroke-width: 1; opacity: .45; }
.power-wires { stroke: rgba(64,118,149,.27); stroke-width: 1.05; }
.power-traces { stroke: rgba(42,123,165,.66); stroke-width: 2.35; stroke-linecap: round; stroke-dasharray: 52 948; animation: power-current 10s linear infinite; }
.power-traces-green { stroke: rgba(53,139,142,.64); stroke-dasharray: 39 961; }
.power-particles { stroke-linecap: round; stroke-dasharray: 1 999; animation: power-current 10s linear infinite; }
.power-packet-halo { stroke: rgba(56,151,173,.23); stroke-width: 10; }
.power-packet-core { stroke: rgba(70,152,176,.90); stroke-width: 4.3; }
.is-paused .power-glow, .is-paused .power-traces, .is-paused .power-particles { animation-play-state: paused; }
@keyframes power-drift { from { transform: translate3d(-2%,0,0) scale(1); } to { transform: translate3d(5%,9%,0) scale(1.05); } }
@keyframes power-current { from { stroke-dashoffset: 1000; } to { stroke-dashoffset: 0; } }
@media (pointer: coarse), (max-width: 760px) {
  .power-glow { animation: none; opacity: .17; }
  .power-currents { opacity: .70; }
  .power-pylon-secondary, .power-circuit-secondary, .power-particles-secondary { display: none; }
  .power-pylon { stroke-width: 1.1; opacity: .74; }
  .power-traces { stroke-width: 2; }
  .power-packet-halo { stroke-width: 8; }
  .power-packet-core { stroke-width: 3.4; }
  .power-photo { opacity: .12; }
}
@media (prefers-reduced-motion: reduce) {
  .power-glow, .power-traces, .power-particles { animation: none; }
  .power-traces { opacity: .25; }
  .power-particles { display: none; }
}
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  .power-photo, .power-currents, .power-glow { display: none; }
  .power-mist { background: #edf5fb; }
}
</style>
