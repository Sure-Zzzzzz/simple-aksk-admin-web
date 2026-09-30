<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  open: boolean;
  title: string;
  description?: string;
  pending?: boolean;
  wide?: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const drawer = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

async function focusDrawer() {
  if (!props.open) return;
  previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await nextTick();
  drawer.value?.focus();
}

function close() {
  if (props.pending) return;
  emit('close');
  previouslyFocused?.focus();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open && !props.pending) {
    close();
  }
}

watch(() => props.open, focusDrawer);
onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div v-if="open" class="drawer-backdrop" @click.self="close">
    <aside
      ref="drawer"
      class="entity-drawer"
      :class="{ 'entity-drawer-wide': wide }"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      tabindex="-1"
    >
      <header class="drawer-header">
        <div>
          <h2>{{ title }}</h2>
          <p v-if="description">{{ description }}</p>
        </div>
        <button class="icon-button" type="button" :disabled="pending" @click="close">
          &times;
        </button>
      </header>
      <div class="drawer-content">
        <slot></slot>
      </div>
    </aside>
  </div>
</template>
