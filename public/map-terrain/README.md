# 真实地形底图

本目录只包含本系统使用的小型地理资产，不包含招聘或用户资料。

- `china-natural-earth-relief.webp`：Natural Earth Shaded Relief 3.2.0（SRTM Plus 高程生成的灰度地形阴影）与 Rivers + Lake Centerlines 5.0.0。单调颜色映射只调整原始阴影的视觉色调，颜色不表示海拔。
- 栅格经纬度边界：西 70°、南 0°、东 138°、北 56°，WGS84 / EPSG:4326；这些是像素边缘，不是像素中心。尺寸 2448 × 2016。
- 全国图与省图共用这一资产，并严格裁剪到本系统原有行政区 GeoJSON。Natural Earth 的国界和海岸线不用于替换系统行政边界。
- 这是小比例尺地理概览，不是道路导航、测绘或实时水文数据。省级预览只裁切同一真实地形，不用其他省份的照片代替。
- 上游地形与河流明确声明 WGS84；既有行政区 GeoJSON 未声明 CRS。本轮保持其原坐标，通过同一经纬度显示变换对齐与裁剪，不据此宣称既有边界或校园点位达到 WGS84 测绘精度。栅格纬向采样约 3.1 km，适用于全国/省域概览。
- 许可：公共领域，可复制、修改与商业使用；详见 [Natural Earth 许可](https://www.naturalearthdata.com/about/terms-of-use/)。
- 完整下载 URL、上游版本、源包 SHA-256、输出 SHA-256 与河流片段数量在 `source-manifest.json`。
- 可复现脚本：`scripts/build-map-terrain-20260928.py`。源压缩包保存在本地 `tmp/continuous-terrain-20260928/sources/`，不进入网站公开目录。

渲染原则：所有行政区共用一个连续地形面，内部分界只有细线；底座只在总体外轮廓露出 2 px（窄屏 1 px），不绘制逐省或逐市侧壁。hover、键盘预览与选中均为原地半透明高亮，无碎块抬升。
