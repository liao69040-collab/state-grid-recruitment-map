<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
withDefaults(defineProps<{ photoUrl?: string }>(), {
  photoUrl: '/assets/grid-atmosphere/transmission-20261004.webp',
});

// Decorative circuits are intentionally separate from the geographic map.
const pylons = [
  { key: 'near', x:1270, y:270, scale:1.24, secondary: false },
  { key: 'middle', x:745, y:435, scale:.82, secondary: true },
  { key: 'far', x:280, y:530, scale:.49, secondary: true },
];
const insulators = [
  { key:'left-upper', x:-92, y:24, length:45, secondary:false },
  { key:'left-middle', x:-110, y:76, length:45, secondary:true },
  { key:'left-lower', x:-128, y:128, length:49, secondary:true },
  { key:'right-upper', x:92, y:24, length:45, secondary:false },
  { key:'right-middle', x:110, y:76, length:45, secondary:true },
  { key:'right-lower', x:128, y:128, length:49, secondary:true },
].map(chain => ({ ...chain, skirts:Array.from({length:8}, (_,i)=>{
  const y=6+i*(chain.length-12)/7;
  return `M-3.4 ${y} Q0 ${y+2.2} 3.4 ${y} M-3.4 ${y} L-2.3 ${y-1.6} H2.3 L3.4 ${y}`;
}).join(' ') }));
// Each phase passes through all three suspension clamps. A cubic span keeps
// a downward sag relative to the chord; the towers themselves remain static.
const conductorPath = (chain:typeof insulators[number]) => {
  const supports=pylons.slice().reverse().map(pylon=>({x:pylon.x+chain.x*pylon.scale,y:pylon.y+(chain.y+chain.length)*pylon.scale}));
  const points=[{x:-120,y:supports[0]!.y-125},...supports,{x:1730,y:supports[2]!.y-45}];
  const n=(value:number)=>Number(value.toFixed(2));
  return `M${n(points[0]!.x)} ${n(points[0]!.y)}`+points.slice(1).map((to,i)=>{
    const from=points[i]!,dx=to.x-from.x,dy=to.y-from.y,sag=Math.min(130,dx*.18);
    return ` C${n(from.x+dx/3)} ${n(from.y+dy/3+sag)} ${n(from.x+dx*2/3)} ${n(from.y+dy*2/3+sag)} ${n(to.x)} ${n(to.y)}`;
  }).join('');
};
const circuits = [
  { key:'upper-blue', duration:10, delay:-2 }, { key:'upper-mid', duration:12, delay:-7 }, { key:'upper-low', duration:14, delay:-11 },
  { key:'lower-green', duration:11, delay:-6 }, { key:'lower-mid', duration:13, delay:-3 }, { key:'lower-low', duration:9, delay:-5 },
].map((wire,i)=>({ ...wire, phase:insulators[i]!.key, d:conductorPath(insulators[i]!), secondary:insulators[i]!.secondary }));
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
        <g v-for="pylon in pylons" :key="pylon.key" class="power-pylon" :class="{ 'power-pylon-secondary': pylon.secondary }" :transform="`translate(${pylon.x} ${pylon.y}) scale(${pylon.scale})`">
          <path class="power-pylon-body" d="M-72 430 L-15 52 L-8 0 L8 0 L15 52 L72 430 M-72 430 H72 M-55 318 H55 M-39 213 H39 M-26 125 H26 M-15 52 H15" />
          <path class="power-pylon-rear power-fine-detail" d="M-62 422 L-5 44 L2 -8 L18 -8 L25 44 L82 422 M-62 422 H82 M-45 310 H65 M-29 205 H49 M-16 117 H36 M-5 44 H25 M-72 430 L-62 422 M72 430 L82 422 M-55 318 L-45 310 M55 318 L65 310 M-39 213 L-29 205 M39 213 L49 205 M-26 125 L-16 117 M26 125 L36 117 M-8 0 L2 -8 M8 0 L18 -8" />
          <path class="power-pylon-bracing" d="M-72 430 L55 318 L-39 213 L26 125 L-15 52 M72 430 L-55 318 L39 213 L-26 125 L15 52" />
          <path class="power-pylon-lattice power-fine-detail" d="M-62 422 L65 310 L-29 205 L36 117 L-5 44 M82 422 L-45 310 L49 205 L-16 117 L25 44 M-64 375 H64 M-64 375 L-55 318 L55 318 L64 375 M-47 265 H47 M-47 265 L-39 213 L39 213 L47 265 M-32 170 H32 M-32 170 L-26 125 L26 125 L32 170 M-55 318 L47 265 L-39 213 M55 318 L-47 265 L39 213 M-39 213 L32 170 L-26 125 M39 213 L-32 170 L26 125" />
          <path class="power-pylon-arms" d="M-92 24 L-17 7 H17 L92 24 H-92 M-110 76 L-24 54 H24 L110 76 H-110 M-128 128 L-31 103 H31 L128 128 H-128" />
          <path class="power-arm-metal power-fine-detail" d="M-92 24 L-80 16 H104 L92 24 M-110 76 L-98 68 H122 L110 76 M-128 128 L-116 120 H140 L128 128 M-54 24 L-17 7 M54 24 L17 7 M-62 76 L-24 54 M62 76 L24 54 M-73 128 L-31 103 M73 128 L31 103" />
          <g v-for="chain in insulators" :key="chain.key" class="power-insulator-string" :class="{'power-insulator-secondary':chain.secondary}" :data-phase="chain.key" :transform="`translate(${chain.x} ${chain.y})`">
            <path class="power-insulator-core" :d="`M-3 0 H3 M0 -3 V3 M-2 ${chain.length-3} L0 ${chain.length} L2 ${chain.length-3} M-4 ${chain.length} H4 M0 0 V${chain.length}`" />
            <path class="power-insulator-skirts power-fine-detail" :d="chain.skirts" />
          </g>
          <path class="power-ground" d="M-98 433 H98" />
        </g>
      </g>
      <g class="power-wires">
        <path v-for="wire in circuits" :key="wire.key" :d="wire.d" :data-phase="wire.phase" class="power-circuit" :class="{ 'power-circuit-secondary': wire.secondary }" />
      </g>
      <g v-for="wire in circuits" :key="`flow-${wire.key}`" class="power-traces" :class="{ 'power-circuit-secondary': wire.secondary, 'power-traces-green': wire.key.startsWith('lower') }" :style="{ animationDuration: `${wire.duration}s`, animationDelay: `${wire.delay}s` }">
        <path :d="wire.d" pathLength="1000" />
      </g>
      <g v-for="packet in packets" :key="packet.key" class="power-particles" :class="{ 'power-particles-secondary': packet.secondary }" :style="{ animationDuration: `${packet.duration}s`, animationDelay: `${packet.delay}s` }">
        <path class="power-packet-halo" :d="packet.d" pathLength="1000" />
        <path class="power-packet-core" :d="packet.d" pathLength="1000" />
      </g>
      <g class="power-formulas">
        <g class="power-formula" transform="translate(1040 435) scale(.55)">
          <text class="power-formula-caption" y="0">正弦稳态 · 平衡网络 · 同基准标幺</text>
          <text y="24">P<tspan baseline-shift="sub" font-size="75%">i</tspan> = U<tspan baseline-shift="sub" font-size="75%">i</tspan> Σ<tspan baseline-shift="sub" font-size="75%">j</tspan> U<tspan baseline-shift="sub" font-size="75%">j</tspan> [G<tspan baseline-shift="sub" font-size="75%">ij</tspan> cos δ<tspan baseline-shift="sub" font-size="75%">ij</tspan> + B<tspan baseline-shift="sub" font-size="75%">ij</tspan> sin δ<tspan baseline-shift="sub" font-size="75%">ij</tspan>]</text>
          <text y="47">Q<tspan baseline-shift="sub" font-size="75%">i</tspan> = U<tspan baseline-shift="sub" font-size="75%">i</tspan> Σ<tspan baseline-shift="sub" font-size="75%">j</tspan> U<tspan baseline-shift="sub" font-size="75%">j</tspan> [G<tspan baseline-shift="sub" font-size="75%">ij</tspan> sin δ<tspan baseline-shift="sub" font-size="75%">ij</tspan> − B<tspan baseline-shift="sub" font-size="75%">ij</tspan> cos δ<tspan baseline-shift="sub" font-size="75%">ij</tspan>]</text>
          <text class="power-formula-caption" y="68">δ<tspan baseline-shift="sub" font-size="75%">ij</tspan> = δ<tspan baseline-shift="sub" font-size="75%">i</tspan> − δ<tspan baseline-shift="sub" font-size="75%">j</tspan> · Y<tspan baseline-shift="sub" font-size="75%">bus</tspan> = G + jB · 节点注入 · j=1…n（含j=i）</text>
        </g>
        <g class="power-formula" transform="translate(1050 555) scale(.85)">
          <text class="power-formula-caption" y="0">同频三相相量 · 零序分量</text>
          <text y="24">I<tspan baseline-shift="sub" font-size="75%">0</tspan> = (I<tspan baseline-shift="sub" font-size="75%">a</tspan> + I<tspan baseline-shift="sub" font-size="75%">b</tspan> + I<tspan baseline-shift="sub" font-size="75%">c</tspan>) / 3</text>
          <text y="47">a = e<tspan baseline-shift="super" font-size="75%">j2π/3</tspan></text>
        </g>
        <g class="power-formula" transform="translate(1050 665) scale(.85)">
          <text class="power-formula-caption" y="0">s域 · 理想线性元件 · 零初始</text>
          <text y="24">Z<tspan baseline-shift="sub" font-size="75%">L</tspan> = sL</text>
          <text y="47">Z<tspan baseline-shift="sub" font-size="75%">C</tspan> = 1 / (sC)</text>
          <text class="power-formula-caption" y="68">i<tspan baseline-shift="sub" font-size="75%">L</tspan>(0<tspan baseline-shift="super" font-size="75%">−</tspan>) = 0 · v<tspan baseline-shift="sub" font-size="75%">C</tspan>(0<tspan baseline-shift="super" font-size="75%">−</tspan>) = 0</text>
        </g>
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
.power-pylon-rear { stroke-width: .95; opacity: .54; }
.power-pylon-lattice { stroke-width: .65; opacity: .55; }
.power-pylon-arms { stroke-width: 1.6; }
.power-arm-metal { stroke-width: .8; opacity: .70; }
.power-insulator-core { stroke: rgba(64,127,142,.38); stroke-width: 1; }
.power-insulator-skirts { stroke: rgba(72,132,148,.42); stroke-width: .8; }
.power-ground { stroke-width: 1; opacity: .45; }
.power-formulas { fill: #1c536e; opacity: .28; stroke: none; font: 15px 'Cambria Math','STIX Two Math',Georgia,serif; letter-spacing: .08px; }
.power-formula-caption { font: 11px -apple-system,'PingFang SC','Microsoft YaHei',sans-serif; letter-spacing: .5px; opacity: .8; }
.power-wires { stroke: rgba(64,118,149,.27); stroke-width: 1.05; }
.power-traces { stroke: rgba(42,123,165,.66); stroke-width: 2.35; stroke-linecap: round; stroke-dasharray: 52 948; animation: power-current 10s linear infinite; }
.power-traces-green { stroke: rgba(53,139,142,.64); stroke-dasharray: 39 961; }
.power-particles { stroke-linecap: round; stroke-dasharray: 1 999; animation: power-current 10s linear infinite; }
.power-packet-halo { stroke: rgba(56,151,173,.23); stroke-width: 10; }
.power-packet-core { stroke: rgba(70,152,176,.90); stroke-width: 4.3; }
.is-paused .power-glow, .is-paused .power-traces, .is-paused .power-particles { animation-play-state: paused; }
@keyframes power-drift { from { transform: translate3d(-2%,0,0) scale(1); } to { transform: translate3d(5%,9%,0) scale(1.05); } }
@keyframes power-current { from { stroke-dashoffset: 1000; } to { stroke-dashoffset: 0; } }
@media (max-width: 1900px) {
  .power-formulas { display: none; }
}
@media (pointer: coarse), (max-width: 760px) {
  .power-glow { animation: none; opacity: .17; }
  .power-currents { opacity: .70; }
  .power-pylon-secondary, .power-circuit-secondary, .power-particles-secondary, .power-insulator-secondary, .power-fine-detail, .power-formulas { display: none; }
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
