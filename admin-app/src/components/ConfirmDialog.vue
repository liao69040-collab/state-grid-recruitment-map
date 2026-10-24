<script setup lang="ts">
import { ref } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import { useDialogFocus } from "@/lib/dialog-focus";

const props = withDefaults(defineProps<{
  title: string;
  description: string;
  confirmText?: string;
  danger?: boolean;
  loading?: boolean;
}>(), {
  confirmText: "确认",
  danger: false,
  loading: false,
});

const emit = defineEmits<{ cancel: []; confirm: [] }>();

const dialogElement = ref<HTMLElement | null>(null);
useDialogFocus(dialogElement, () => emit("cancel"), () => props.loading);
</script>

<template>
  <Teleport to="body">
    <div class="dialog-backdrop" role="presentation" @mousedown.self="!loading && emit('cancel')">
      <section ref="dialogElement" class="confirm-dialog" role="alertdialog" aria-modal="true" :aria-labelledby="`${title}-heading`" :aria-busy="loading" tabindex="-1">
        <div class="dialog-symbol" :class="{ danger }" aria-hidden="true"><AppIcon :name="danger ? 'WarningFilled' : 'QuestionFilled'" :size="21" /></div>
        <div>
          <h2 :id="`${title}-heading`">{{ title }}</h2>
          <p>{{ description }}</p>
        </div>
        <div class="dialog-actions">
          <button type="button" class="button secondary" data-dialog-initial :disabled="loading" @click="emit('cancel')">取消</button>
          <button type="button" class="button" :class="danger ? 'danger' : 'primary'" :disabled="loading" @click="emit('confirm')">
            <span v-if="loading" class="button-spinner" aria-hidden="true"></span>
            {{ loading ? "处理中…" : confirmText }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
