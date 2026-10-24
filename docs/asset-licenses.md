# 素材来源与许可 / Asset licenses

软件代码的 MIT 许可证不替代照片、地图资料和来源网站各自的使用条件。再分发本仓库时，请保留本文件、根目录 `LICENSE`、`THIRD_PARTY_NOTICES.md`，以及图片目录中的 `credits.html`。

## 上游界面与行政区底图

本项目基于 [daidaibg/IofTV-Screen-Vue3](https://github.com/daidaibg/IofTV-Screen-Vue3) 二次开发，上游版权为 **Copyright (c) 2022 daidai**，采用 [MIT](https://github.com/daidaibg/IofTV-Screen-Vue3/blob/master/LICENSE)。

- `src/assets/img/` 中的 21 张原界面图片保留上游文件字节。
- `public/map-geojson/` 中的 36 个 JSON 文件保留上游文件字节；可追溯来源为上述仓库。上游未提供单独的行政边界数据授权文件；此处记录仓库层面的 MIT 声明，不额外声称边界属于公共领域或已获得测绘审图认证。
- 地图用于小比例尺交互演示，不是导航、测绘或官方边界证明。实际部署者应核对自身发布地区与使用方式的要求。

## Natural Earth 地形与河流

`public/assets/china-natural-earth-relief-v1.webp` 使用 Natural Earth Shaded Relief 3.2.0 和 Rivers + Lake Centerlines 5.0.0。Natural Earth 声明其栅格与矢量地图数据处于公共领域，允许修改与再分发，见 [官方使用条款](https://www.naturalearthdata.com/about/terms-of-use/)。

派生图经过裁切、调色与河流叠加。源版本、下载链接、输出 SHA-256 与地理范围保存在 [source-manifest.json](../public/map-terrain/source-manifest.json)。本仓库文件的 SHA-256 与清单相符。感谢 Natural Earth / NACIS、Tom Patterson、Nathaniel Vaughn Kelso 及贡献者。

## 34 张省份装饰照片

照片保留各自许可。CC BY 要求署名、链接许可并标注修改；CC BY-SA 的照片改作继续按其对应 ShareAlike 版本提供，不因与 MIT 软件一起分发而改为 MIT。CC0 项按其权利放弃声明提供。完整标题、原作者、原图链接、缩放/转换/裁切说明保留在 [照片署名页](../public/assets/province-backdrops/credits.html)。

| 装饰主题 / 文件 | 作者 | 原始照片 | 许可 |
|---|---|---|---|
| 北京市 · 天坛<br>[110000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/110000-landmark-hd-v2-20261004.webp) | Balon Greyjoy | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:20200110_Temple_of_Heaven-1.jpg) | [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) |
| 天津市 · 天津之眼<br>[120000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/120000-landmark-hd-v2-20261004.webp) | 钉钉 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Tianjin_Eye_0.jpg) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 河北省 · 赵州桥<br>[130000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/130000-landmark-hd-v2-20261004.webp) | Siyuwj | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Anji_Bridge,_Zhao_County,_2020-09-06_05.jpg) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 山西省 · 平遥古城<br>[140000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/140000-landmark-hd-v2-20261004.webp) | Jan Bockaert | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:2015-01-06_a_building_on_the_city_wall_in_Pingyao.jpg) | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) |
| 内蒙古自治区 · 内蒙古草原<br>[150000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/150000-landmark-hd-v2-20261004.webp) | 악준동 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:%E5%86%85%E8%92%99%E5%8F%A4%E5%A4%A7%E8%8D%89%E5%8E%9F.jpg) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 辽宁省 · 沈阳故宫<br>[210000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/210000-landmark-hd-v2-20261004.webp) | xiquinhosilva | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Shenyang_Imperial_Palace_Museum_24381-Shenyang_(49052231866).jpg) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) |
| 吉林省 · 长白山天池<br>[220000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/220000-landmark-hd-v2-20261004.webp) | 颐园新居 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Tianchi_Lake_of_Changbai_20130714.jpeg) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| 黑龙江省 · 哈尔滨圣索菲亚教堂<br>[230000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/230000-landmark-hd-v2-20261004.webp) | Steve Zhang | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:%E5%93%88%E5%B0%94%E6%BB%A8%E5%9C%A3%E7%B4%A2%E8%8F%B2%E4%BA%9A%E6%95%99%E5%A0%82%E4%BE%A7%E9%9D%A2%E4%BB%B0%E8%A7%86%E5%9B%BE.jpg) | [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) |
| 上海市 · 东方明珠<br>[310000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/310000-landmark-hd-v2-20261004.webp) | Ermell | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Shanghai_Oriental_Pearl_Tower-20150516-RM-130617.jpg) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 江苏省 · 拙政园借景北寺塔<br>[320000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/320000-landmark-hd-v2-20261004.webp) | King of Hearts | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Humble_Administrator%27s_Garden_Suzhou_November_2017_006.jpg) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 浙江省 · 雷峰塔<br>[330000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/330000-landmark-hd-v2-20261004.webp) | xiquinhosilva | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Leifeng_Pagoda_20191102.jpg) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) |
| 安徽省 · 黄山<br>[340000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/340000-landmark-hd-v2-20261004.webp) | Peter05031960 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Huangshan_mountain_peak_pine_trees.jpg) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| 福建省 · 福建土楼<br>[350000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/350000-landmark-hd-v2-20261004.webp) | Motohiro Sunouchi | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Tianluokeng_Tulou_cluster_DSC5269_(16013519850).jpg) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) |
| 江西省 · 滕王阁<br>[360000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/360000-landmark-hd-v2-20261004.webp) | 原图页面未提供明确摄影作者；版权字段原文：No machine-readable author provided. BetacommandBot assumed (based on copyright claims). | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Pavilion_of_Prince_Teng_3.jpg) | [CC BY-SA 3.0](http://creativecommons.org/licenses/by-sa/3.0/) |
| 山东省 · 泰山十八盘<br>[370000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/370000-landmark-hd-v2-20261004.webp) | Zhangzhugang | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Tai_Shan_2015.08.12_11-18-27.jpg) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 河南省 · 龙门石窟<br>[410000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/410000-landmark-hd-v2-20261004.webp) | Gary Todd | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Ancient_Buddhist_Grottoes_at_Longmen-_Fengxian_Temple,_Colossal_Statue_of_Vairocana.jpg) | [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) |
| 湖北省 · 黄鹤楼<br>[420000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/420000-landmark-hd-v2-20261004.webp) | MonsieurRoi | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:CN_-_Hubei_-_Wuhan_-_Kranichpagode.jpg) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| 湖南省 · 张家界武陵源<br>[430000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/430000-landmark-hd-v2-20261004.webp) | chensiyuan | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:1_tianzishan_wulingyuan_zhangjiajie_2012.jpg) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 广东省 · 广州塔<br>[440000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/440000-landmark-hd-v2-20261004.webp) | Tim Wu | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Canton_Tower_20241027.jpg) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 广西壮族自治区 · 桂林漓江<br>[450000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/450000-landmark-hd-v2-20261004.webp) | shankar s. from Dubai, united arab emirates | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:You_can_see_now_why_this_landscape_has_inspired_so_many_poets_and_local_artists_(35689549310).jpg) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) |
| 海南省 · 三亚海滨<br>[460000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/460000-landmark-hd-v2-20261004.webp) | Huangdan2060 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Beaches_in_Sanya,_Hainan,_China2.jpg) | [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) |
| 重庆市 · 洪崖洞<br>[500000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/500000-landmark-hd-v2-20261004.webp) | Jonashtand | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:202308_Hongya_Cave_at_night_from_Qiansimen_Bridge.jpg) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 四川省 · 乐山大佛<br>[510000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/510000-landmark-hd-v2-20261004.webp) | xiquinhosilva | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Leshan_Giant_Buddha_(2).jpg) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) |
| 贵州省 · 黄果树瀑布<br>[520000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/520000-landmark-hd-v2-20261004.webp) | Robinliu | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Huangguoshu_Waterfall_-_Pixabay.jpg) | [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) |
| 云南省 · 大理三塔<br>[530000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/530000-landmark-hd-v2-20261004.webp) | CEphoto, Uwe Aranas | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Dali_Yunnan_China_Chongsheng-Temple-03a.jpg) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| 西藏自治区 · 布达拉宫<br>[540000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/540000-landmark-hd-v2-20261004.webp) | Ondřej Žváček | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Potala.jpg) | [CC BY 2.5](https://creativecommons.org/licenses/by/2.5) |
| 陕西省 · 大雁塔<br>[610000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/610000-landmark-hd-v2-20261004.webp) | Alex Kwok | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Giant_Wild_Goose_Pagoda.jpg) | [CC BY-SA 3.0](http://creativecommons.org/licenses/by-sa/3.0/) |
| 甘肃省 · 鸣沙山月牙泉<br>[620000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/620000-landmark-hd-v2-20261004.webp) | N509FZ | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Crescent_Lake_from_the_Singing_Sand_Dunes_(20230918101214).jpg) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 青海省 · 青海湖油菜花<br>[630000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/630000-landmark-hd-v2-20261004.webp) | Jucember | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Rapeseed_at_Qinghai_Lake.jpg) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| 宁夏回族自治区 · 沙坡头黄河<br>[640000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/640000-landmark-hd-v2-20261004.webp) | w0zny | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Yellow_River_in_Shapotou_town,_Zhongwei,_Ningxia_IGP4683.jpg) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| 新疆维吾尔自治区 · 天山天池<br>[650000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/650000-landmark-hd-v2-20261004.webp) | User:CatOnMars | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:DSC-Tianshan_Heavenly_Lake_2026.jpg) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| 台湾省 · 台北101<br>[710000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/710000-landmark-hd-v2-20261004.webp) | CEphoto, Uwe Aranas | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Taipei_Taiwan_Taipei-101-Tower-01.jpg) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| 香港特别行政区 · 维多利亚港夜景<br>[810000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/810000-landmark-hd-v2-20261004.webp) | Benh LIEU SONG (Flickr) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Hong_Kong_Harbour_Night_2019-06-11.jpg) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 澳门特别行政区 · 大三巴牌坊<br>[820000-landmark-hd-v2-20261004.webp](../public/assets/province-backdrops/820000-landmark-hd-v2-20261004.webp) | Ank Kumar | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Macau_-_Ruins_of_Saint_Paul%27s_(Ank_Kumar)_01.jpg) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |

## 输电铁塔氛围照片

- 文件：[`transmission-20261004.webp`](../public/assets/grid-atmosphere/transmission-20261004.webp)。
- 作者：**Edmund Vermeulen**。
- 原图：[Pylon at sunset Midden Delftland NL 2017.jpg](https://commons.wikimedia.org/wiki/File:Pylon_at_sunset_Midden_Delftland_NL_2017.jpg)。
- 许可：[CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/)，衍生照片保留该许可。
- 修改：EXIF 方向与色彩转换，等比例缩小为 2560×1920，WebP 编码；界面叠加淡色玻璃遮罩。详见 [署名页](../public/assets/grid-atmosphere/credits.html)。
- 拍摄地为荷兰 Midden Delftland，作为电网主题装饰，不代表国家电网设施。

## 数据与标识

`demo/` 是本项目编写的合成数据。`src/data/school-public-profiles-20261010.ts` 为学校属性与来源索引；`src/data/school-admissions-2026.ts` 为带公开来源的历史招生分数事实，不含考生名单。这些事实整理不是来源网站全文或附件的开源授权；原公告、附件、商标和校徽仍分别归其权利人。更新数据时应保留来源、年份、招生省份、科类与专业口径，不把投档线描述为最终录取线。

公开仓库不包含客户付费原资料、个人录用名册、纸质资料转录、生产数据库、账号凭据、站点所有权验证文件或微信二维码。用户添加素材时应补充对应许可与署名。


## Demo screenshots

`docs/images/*` are captured from the synthetic local demo. Background photographs visible in screenshots retain the same attribution and licenses listed above. School names and recruitment values in these screenshots are fictional.
