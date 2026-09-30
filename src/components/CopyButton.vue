<script setup lang="ts">
import { Check, Copy } from 'lucide-vue-next';
import { computed, ref } from 'vue';

const props = withDefaults(defineProps<{ value: string; label?: string; ghost?: boolean }>(), { label: '值', ghost: false });
const copied = ref(false);

const title = computed(() => (copied.value ? '已复制' : `复制 ${props.label ?? '值'}`));

async function copy() {
  try {
    await navigator.clipboard.writeText(props.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1600);
  } catch {
    // 剪贴板被浏览器拒绝时保持原样，用户可手动选择文本
  }
}
</script>

<template>
  <button
    :class="[ghost ? 'copy-ghost' : 'secret-copy', { copied }]"
    type="button"
    :aria-label="title"
    :title="title"
    @click.stop="copy"
  >
    <Check v-if="copied" :size="14" aria-hidden="true" />
    <Copy v-else :size="14" aria-hidden="true" />
    <span v-if="!ghost">{{ copied ? '已复制' : (label ?? '复制') }}</span>
  </button>
</template>
