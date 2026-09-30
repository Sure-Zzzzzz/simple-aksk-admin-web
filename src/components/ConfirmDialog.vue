<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  pending?: boolean;
  variant?: 'danger' | 'confirm';
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

const dialog = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

async function focusDialog() {
  if (!props.open) return;
  previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await nextTick();
  dialog.value?.focus();
}

function close() {
  emit('close');
  previouslyFocused?.focus();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open && !props.pending) {
    close();
  }
}

watch(() => props.open, focusDialog);
onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div v-if="open" class="dialog-backdrop" @click.self="!pending && close()">
    <section
      ref="dialog"
      class="confirm-dialog"
      role="alertdialog"
      aria-modal="true"
      :aria-label="title"
      tabindex="-1"
    >
      <span :class="variant === 'confirm' ? 'confirm-icon' : 'danger-icon'" aria-hidden="true">{{ variant === 'confirm' ? '✓' : '!' }}</span>
      <h2>{{ title }}</h2>
      <p>{{ description }}</p>
      <footer>
        <button class="button-secondary" type="button" :disabled="pending" @click="close">
          取消
        </button>
        <button :class="variant === 'confirm' ? 'button-primary' : 'button-danger'" type="button" :disabled="pending" @click="emit('confirm')">
          {{ pending ? '正在处理…' : (confirmLabel || '确认') }}
        </button>
      </footer>
    </section>
  </div>
</template>
