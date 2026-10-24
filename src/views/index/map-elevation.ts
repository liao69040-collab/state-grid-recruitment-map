import type { CustomSeriesOption } from 'echarts/charts';
import { TERRAIN_ASSET_URL, terrainImageRect } from './map-terrain.ts';

export const PROVINCE_ELEVATION_SERIES_ID = 'active-province-elevation';
export const PROVINCE_BASE_SERIES_ID = 'province-relief-base';
// Compatibility names are retained for existing event IDs; no province is lifted.
export const PROVINCE_ELEVATION_PX = 0;
export const PROVINCE_SELECTED_PX = 0;
export const PROVINCE_BASE_PX = 2;
type Point = [number, number];
type Ring = Point[];
type Polygon = Ring[];
export interface ProvinceFace {
  key: string;
  name: string;
  polygons: Polygon[];
  labelCoordinate: Point | null;
}
export type ElevationMode = 'hidden' | 'flat' | 'raised';

/** Fill the new desktop shell without changing camera zoom or its roam thresholds. */
export const provinceMapLayout = (state: {
  national: boolean; contextPreview: boolean; touch: boolean; reducedMotion: boolean; hoverCapable: boolean; narrowViewport: boolean;
}) => {
  const narrowGlass = state.national && state.contextPreview && !state.touch && state.narrowViewport;
  const expanded = state.national && state.contextPreview && !state.touch && !state.reducedMotion && state.hoverCapable && !state.narrowViewport;
  return {
    layoutCenter: ['50%', state.national ? (expanded || narrowGlass ? '50%' : '57%') : '56%'],
    layoutSize: state.national ? (expanded ? '125%' : '90%') : '88%',
  };
};

const preparedMaps = new WeakMap<object, Map<string, ProvinceFace>>();
const preparedFaceLists = new WeakMap<object, ProvinceFace[]>();
const finitePoint = (value: unknown): value is Point => Array.isArray(value)
  && value.length >= 2 && typeof value[0] === 'number' && Number.isFinite(value[0])
  && typeof value[1] === 'number' && Number.isFinite(value[1]);

/** Reject malformed rings as a whole: dropping a bad inner ring would fill a hole. */
export const prepareProvinceGeometry = (geometry: unknown): Polygon[] | null => {
  if (!geometry || typeof geometry !== 'object') return null;
  const source = geometry as { type?: string; coordinates?: unknown };
  const polygons = source.type === 'Polygon' ? [source.coordinates]
    : source.type === 'MultiPolygon' ? source.coordinates : null;
  if (!Array.isArray(polygons) || !polygons.length) return null;
  const output: Polygon[] = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) return null;
    const rings: Polygon = [];
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4 || !ring.every(finitePoint)) return null;
      const first = ring[0] as Point;
      const last = ring[ring.length - 1] as Point;
      if (first[0] !== last[0] || first[1] !== last[1]) return null;
      const points = ring.slice(0, -1).map((point: Point): Point => [point[0], point[1]]);
      if (new Set(points.map(([x, y]) => `${x},${y}`)).size < 3) return null;
      rings.push(points);
    }
    output.push(rings);
  }
  return output;
};

/** Cache only immutable administrative geometry, keyed by the actual registered GeoJSON. */
export const provinceFaceFromMap = (geoJson: unknown, key: string): ProvinceFace | null => {
  if (!geoJson || typeof geoJson !== 'object' || !key) return null;
  let faces = preparedMaps.get(geoJson);
  if (!faces) {
    faces = new Map();
    const features = (geoJson as { features?: unknown }).features;
    for (const feature of Array.isArray(features) ? features : []) {
      const polygons = prepareProvinceGeometry(feature?.geometry);
      if (!polygons) continue;
      const properties = feature?.properties ?? {};
      const name = String(properties.name ?? '');
      const adcode = String(properties.adcode ?? '');
      const label = [properties.cp, properties.centroid, properties.center].find(finitePoint);
      const face: ProvinceFace = {
        key: adcode || name, name, polygons,
        labelCoordinate: label ? [label[0], label[1]] : null,
      };
      if (adcode) faces.set(adcode, face);
      if (name) faces.set(name, face);
    }
    preparedMaps.set(geoJson, faces);
  }
  return faces.get(key) ?? null;
};

export const provinceFacesFromMap = (geoJson: unknown): ProvinceFace[] => {
  if (!geoJson || typeof geoJson !== 'object') return [];
  const cached = preparedFaceLists.get(geoJson);
  if (cached) return cached;
  const features = (geoJson as { features?: any[] }).features;
  const faces = (Array.isArray(features) ? features : []).flatMap(feature => {
    const key = String(feature?.properties?.adcode ?? feature?.properties?.name ?? '');
    const face = provinceFaceFromMap(geoJson, key);
    return face ? [face] : [];
  });
  preparedFaceLists.set(geoJson, faces);
  return faces;
};

/** Hover is temporary; a pinned keyboard/filter selection survives pointer exit. */
export const provinceReliefTarget = (hover: string, selected: string, suspended: boolean) => {
  const key = (!suspended && hover) || selected;
  return { key, selected: Boolean(key && (suspended || !hover)) };
};

export const provinceKeyboardTarget = (keys: string[], current: string, key: string): string | null => {
  if (!keys.length) return null;
  if (key === 'Home') return keys[0]!;
  if (key === 'End') return keys[keys.length - 1]!;
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return null;
  const backwards = key === 'ArrowLeft' || key === 'ArrowUp';
  const index = keys.indexOf(current);
  return keys[index < 0 ? (backwards ? keys.length - 1 : 0)
    : (index + (backwards ? -1 : 1) + keys.length) % keys.length]!;
};

export const provinceElevationMode = (state: {
  national: boolean; active: boolean; suspended: boolean; hidden: boolean;
  touch: boolean; reducedMotion: boolean;
}): ElevationMode => {
  if (!state.national || !state.active || state.suspended || state.hidden) return 'hidden';
  return 'flat';
};

const signedArea = (ring: Ring) => ring.reduce((sum, point, index) => {
  const next = ring[(index + 1) % ring.length]!;
  return sum + point[0] * next[1] - next[0] * point[1];
}, 0) / 2;
const ringPath = (ring: Ring) => `M${ring.map(([x, y]) => `${x},${y}`).join('L')}Z`;

/** Exact edge extrusions in screen pixels; no buffer, inset or invented border. */
export const provinceWallPath = (rings: Ring[], top: number, bottom: number, frontOnly = false) => {
  if (top === bottom) return '';
  return rings.flatMap(ring => ring.flatMap((point, index) => {
    const next = ring[(index + 1) % ring.length]!;
    // Projected outer/hole winding already agrees. Horizontal screen-facing
    // normals decide visible walls for a vertical extrusion, including holes.
    if (frontOnly && next[0] >= point[0]) return [];
    return [ringPath([[point[0], point[1] + top], [next[0], next[1] + top],
      [next[0], next[1] + bottom], [point[0], point[1] + bottom]])];
  })).join('');
};

/** Nonzero winding works in both Canvas and SVG; inner rings must oppose their exterior. */
export const projectProvinceFace = (face: ProvinceFace, project: (point: Point) => number[], lift: number) => {
  const rings: Ring[] = [];
  for (const polygon of face.polygons) {
    for (const [index, ring] of polygon.entries()) {
      const points = ring.map((point) => project(point));
      if (!points.every(finitePoint)) return null;
      const projected = points.map((point): Point => [point[0]!, point[1]!]);
      const area = signedArea(projected);
      if (!Number.isFinite(area) || area === 0) return null;
      if ((area > 0) !== (index === 0)) projected.reverse();
      rings.push(projected);
    }
  }
  const path = rings.map(ringPath).join('');
  // One compound side path, not one display object/canvas for every boundary edge.
  const sides = lift > 0 ? provinceWallPath(rings, 0, -lift) : '';
  const label = face.labelCoordinate ? project(face.labelCoordinate) : null;
  return { path, sides, rings, label: finitePoint(label) ? label : null };
};

// Hover and selection updates invoke every custom-series renderer again. Keep
// the immutable land path while the shared affine geo camera stays unchanged;
// pan, zoom, map identity and resize all invalidate these six screen values.
const landProjections = new WeakMap<ProvinceFace[], {
  camera: number[]; path: string; rect: ReturnType<typeof terrainImageRect>;
}>();
const projectLand = (faces: ProvinceFace[], project: (point: Point) => number[]) => {
  const camera = [[0, 0], [1, 0], [0, 1]].flatMap(point => project(point as Point));
  if (camera.length !== 6 || !camera.every(Number.isFinite)) return null;
  const cached = landProjections.get(faces);
  if (cached && camera.every((value, index) => value === cached.camera[index])) return cached;
  const projected = faces.map(face => projectProvinceFace(face, project, 0));
  if (projected.some(face => !face)) return null;
  const result = { camera, path: projected.map(face => face!.path).join(''), rect: terrainImageRect(project) };
  landProjections.set(faces, result);
  return result;
};

/** One compound land surface for the WHOLE currently registered map. Its opaque
 * top occludes the shifted foundation at every interior boundary, leaving only
 * the exterior silhouette with a very light depth. No individual province/city
 * wall paths are generated. Nonzero winding preserves real holes and islands. */
export const createProvinceBaseSeries = (
  faces: ProvinceFace[],
  options: { enabled: boolean; compact: boolean; activeKey?: string },
): CustomSeriesOption => {
  const depth = options.compact ? 1 : PROVINCE_BASE_PX;
  return {
    id: PROVINCE_BASE_SERIES_ID, name: '连续地形', type: 'custom', coordinateSystem: 'geo', geoIndex: 0,
    silent: true, zlevel: 0, z: 2, clip: true, animation: false, tooltip: { show: false },
    data: options.enabled && faces.length ? [{ id: 'continuous-land', name: '连续地形', value: [0] }] : [],
    renderItem: (_params, api) => {
      if (!faces.length) return null;
      const projected = projectLand(faces, point => api.coord(point));
      if (!projected) return null;
      const { path, rect } = projected;
      return {
        type: 'group', silent: true, children: [
          { type: 'path', name: 'continuous-foundation', silent: true, y: depth,
            shape: { pathData: path }, style: { fill: '#8fa9bd', stroke: 'none',
              shadowColor: 'rgba(55,83,88,.12)', shadowBlur: options.compact ? 1 : 3, shadowOffsetY: 1 } },
          // An opaque fallback remains usable while the local image loads/fails.
          { type: 'path', name: 'continuous-land-top', silent: true,
            shape: { pathData: path }, style: { fill: '#cfe0ee', stroke: 'none' } },
          ...(rect ? [{
            type: 'image' as const, name: 'real-terrain-image', silent: true,
            style: { image: TERRAIN_ASSET_URL, ...rect, opacity: 0.7 },
            clipPath: { type: 'path' as const, shape: { pathData: path } },
          }] : []),
        ],
      };
    },
  };
};

export const createProvinceElevationSeries = (
  face: ProvinceFace | null,
  mode: ElevationMode,
  label = face?.name ?? '',
  options: { selected?: boolean; compact?: boolean; interactive?: boolean; baseDepth?: number; legacy?: boolean } = {},
): CustomSeriesOption => {
  const silent = !options.interactive;
  return {
    id: PROVINCE_ELEVATION_SERIES_ID,
    name: '当前省份', type: 'custom', coordinateSystem: 'geo', geoIndex: 0,
    silent, zlevel: 0, z: 4, clip: true,
    animation: false, tooltip: { show: false },
    data: face && mode !== 'hidden' ? [{ id: face.key, name: face.name, value: [0] }] : [],
    renderItem: (_params, api) => {
      if (!face || mode === 'hidden') return null;
      const projected = projectProvinceFace(face, (point) => api.coord(point), 0);
      if (!projected) return null;
      return {
        type: 'group', silent, emphasisDisabled: true,
        children: [
          {
            type: 'group', name: 'province-top', silent, y: 0,
            children: [
              { type: 'path', name: 'province-face', silent, shape: { pathData: projected.path },
                style: { fill: options.selected ? 'rgba(80,143,180,.17)' : 'rgba(97,162,188,.12)',
                  stroke: '#527f92', lineWidth: 1.4, lineJoin: 'round' } },
            ],
          },
        ],
      };
    },
  };
};
