import metadata from './map-terrain-metadata.json' with { type: 'json' };

/** WGS84 pixel-edge bounds, in west/south/east/north order, not pixel centres. */
export const TERRAIN_BOUNDS = metadata.bounds as [number, number, number, number];
export const TERRAIN_ASSET_URL = metadata.asset;
export const TERRAIN_PIXEL_SIZE = [metadata.width, metadata.height] as const;
export const TERRAIN_SOURCE_LABEL = 'Natural Earth · SRTM 地形';

/** Current ECharts geo has no non-affine projection. Its own coord transform
 * supplies both corners, so pan, zoom, aspectScale and resize stay identical. */
export const terrainImageRect = (project: (point: [number, number]) => number[]) => {
  const [west, south, east, north] = TERRAIN_BOUNDS;
  const a = project([west, north]);
  const b = project([east, south]);
  if (![...a, ...b].every(Number.isFinite) || b[0]! <= a[0]! || b[1]! <= a[1]!) return null;
  return { x: a[0]!, y: a[1]!, width: b[0]! - a[0]!, height: b[1]! - a[1]! };
};

/** Province-specific licensed imagery, with the same real terrain as fallback. */
import backdrops from './province-backdrops.json' with { type: 'json' };

type ProvinceBackdropManifest = {
  basePath: string;
  images: Record<string, string>;
  positions?: Record<string, string>;
  attributions?: Record<string, { label: string; href: string }>;
};
const provinceBackdrops = backdrops as ProvinceBackdropManifest;

/**
 * A province card prefers a licensed photo of that province when one has been
 * registered; otherwise it falls back to the cropped relief below. No image is
 * invented: an unregistered province simply keeps the terrain crop.
 */
export const provinceBackdropStyle = (adcode: string): Record<string, string> | null => {
  const file = provinceBackdrops.images[adcode];
  if (!file) return null;
  return { backgroundImage: `url("${provinceBackdrops.basePath}${file}")`, backgroundSize: 'cover',
    backgroundPosition: provinceBackdrops.positions?.[adcode] ?? 'center' };
};
export const provinceBackdropAttribution = (adcode: string): { label: string; href: string } | null => {
  if (!provinceBackdrops.images[adcode]) return null;
  return provinceBackdrops.attributions?.[adcode] ?? null;
};
/** Bbox comes from the existing province GeoJSON, without another boundary. */
export const terrainPreviewStyle = (adcode: string, aspectRatio = 16 / 9): Record<string, string> => {
  const item = metadata.provinceBounds[adcode as keyof typeof metadata.provinceBounds];
  if (!item) return {};
  const [west, south, east, north] = TERRAIN_BOUNDS;
  const [x0, y0, x1, y1] = item.bounds;
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 16 / 9;
  const scaleX = metadata.width / (east - west), scaleY = metadata.height / (north - south);
  let width = Math.max((x1 - x0) * scaleX * 1.12, 1);
  let height = Math.max((y1 - y0) * scaleY * 1.12, 1);
  if (width / height < ratio) width = height * ratio;
  else height = width / ratio;
  const fit = Math.min(1, metadata.width / width, metadata.height / height);
  width *= fit; height *= fit;
  const left = Math.max(0, Math.min(metadata.width - width, ((x0 + x1) / 2 - west) * scaleX - width / 2));
  const top = Math.max(0, Math.min(metadata.height - height, (north - (y0 + y1) / 2) * scaleY - height / 2));
  return {
    backgroundImage: `url("${TERRAIN_ASSET_URL}")`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${metadata.width / width * 100}% ${metadata.height / height * 100}%`,
    backgroundPosition: `${metadata.width === width ? 50 : left / (metadata.width - width) * 100}% ${metadata.height === height ? 50 : top / (metadata.height - height) * 100}%`,
  };
};
