<script setup lang="ts">
import { computed } from "vue";
import {
  ArrowRight,
  Calendar,
  CircleCheck,
  Close,
  DataLine,
  Delete,
  Document,
  DocumentRemove,
  Edit,
  Finished,
  Grid,
  InfoFilled,
  Link,
  Location,
  Lock,
  MapLocation,
  Menu,
  Monitor,
  OfficeBuilding,
  Plus,
  QuestionFilled,
  Refresh,
  School,
  Search,
  SwitchButton,
  TopRight,
  Tickets,
  TrendCharts,
  User,
  View,
  WarningFilled,
  Clock,
} from "@element-plus/icons-vue";

const props = withDefaults(defineProps<{ name: string; size?: number | string }>(), { size: 16 });

const registry = {
  ArrowRight,
  Calendar,
  CircleCheck,
  Close,
  Clock,
  DataLine,
  Delete,
  Document,
  DocumentRemove,
  Edit,
  Finished,
  Grid,
  InfoFilled,
  Link,
  Location,
  Lock,
  MapLocation,
  Menu,
  Monitor,
  OfficeBuilding,
  Plus,
  QuestionFilled,
  Refresh,
  School,
  Search,
  SwitchButton,
  TopRight,
  Tickets,
  TrendCharts,
  User,
  View,
  WarningFilled,
} as const;

const component = computed(() => registry[props.name as keyof typeof registry] || DataLine);
</script>

<template>
  <component :is="component" class="app-icon" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true" />
</template>
