<script setup lang="ts">
import { toast } from "@/lib/toast";
import AppIcon from "@/components/AppIcon.vue";
</script>

<template>
  <div class="toast-stack" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="toast">
      <button
        v-for="message in toast.messages.value"
        :key="message.id"
        type="button"
        class="toast-message"
        :class="`is-${message.kind}`"
        @click="toast.remove(message.id)"
      >
        <span class="toast-dot" aria-hidden="true"></span>
        <span>{{ message.text }}</span>
        <span class="toast-close" aria-hidden="true"><AppIcon name="Close" :size="15" /></span>
      </button>
    </TransitionGroup>
  </div>
</template>
