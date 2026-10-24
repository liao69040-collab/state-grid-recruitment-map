import { createRouter, createWebHashHistory } from 'vue-router'
import type {RouteRecordRaw} from "vue-router"
const routes: Array<RouteRecordRaw> = [
  {
    path: '/mobile',
    name: 'mobile-query',
    component: () => import('@/views/mobile/MobileQueryPage.vue'),
  },
  {
    path: '/information',
    name: 'information',
    component: () => import('@/views/information/InformationPage.vue'),
  },
  {
    path: '/',
    redirect: '/index',
  },
  {
    path: '/home',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
    children:[
      {
        path: '/index',
        name: 'index',
        component: () => import('@/views/index/index.vue'),
      }
    ]
  },
]
const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes,
})

router.afterEach((to) => {
  document.title = to.name === 'mobile-query' ? '电网招聘查询 · 手机版' : to.name === 'information' ? '电网报考指南 · Hengzhen Grid Atlas' : '全国电网招聘数据地图'
})

export default router
