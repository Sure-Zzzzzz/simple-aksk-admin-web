<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Check, Copy } from 'lucide-vue-next';
import AkskPageHeader from '../components/AkskPageHeader.vue';
import FormSelect, { type FormSelectOption } from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import { createAkskClient, type CreateAkskClientResult } from '../api/akskAuth';

const router = useRouter();

// 用户级 AKU 已收敛为统一应用门户内本人自助创建（服务端 type=user 一律 409），管理台只建平台级 AKP
const form = reactive({
  type: 'platform' as const,
  name: ''
});

const clientTypeOptions: FormSelectOption[] = [
  { label: '平台级 AKP（业务系统持有）', value: 'platform' }
];

const pending = ref(false);
const errorMessage = ref('');
const created = ref<CreateAkskClientResult | null>(null);
const copied = ref(false);
const copiedKey = ref(false);

async function submitCreate() {
  errorMessage.value = '';
  if (!form.name.trim()) {
    errorMessage.value = '请填写客户端名称';
    return;
  }
  pending.value = true;
  try {
    created.value = await createAkskClient({
      type: form.type,
      name: form.name.trim()
    });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '创建客户端失败';
  } finally {
    pending.value = false;
  }
}

async function copySecret() {
  if (!created.value) {
    return;
  }
  try {
    await navigator.clipboard.writeText(created.value.clientSecret);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}

async function copyAccessKey() {
  if (!created.value) {
    return;
  }
  try {
    await navigator.clipboard.writeText(created.value.clientId);
    copiedKey.value = true;
  } catch {
    copiedKey.value = false;
  }
}

function goToDetail() {
  if (created.value) {
    void router.push(`/clients/${encodeURIComponent(created.value.clientId)}`);
  }
}
</script>

<template>
  <section class="management-page">
    <AkskPageHeader
      title="新建客户端"
      description="创建平台级 AKP：面向业务系统的访问凭证，密钥仅在创建成功后展示一次。用户级 AKU 由本人在统一应用门户「我的 AKSK 访问凭证」自助创建。"
    />
    <p v-if="errorMessage" class="admin-message error" role="alert">{{ errorMessage }}<button class="admin-message-dismiss" type="button" aria-label="关闭提示" @click="errorMessage = ''">×</button></p>

    <div v-if="created" class="admin-empty-state">
      <h2>客户端创建成功</h2>
      <div class="secret-reveal secret-reveal-wide" role="status">
        <p>客户端 {{ created.clientId }} 的 AccessKey / SecretKey（SecretKey 仅此一次展示，关闭后无法再查看）：</p>
        <code class="secret-line">AK：{{ created.clientId }}<button class="secret-copy" :class="{ copied: copiedKey }" type="button" @click="copyAccessKey"><Check v-if="copiedKey" :size="14" aria-hidden="true" /><Copy v-else :size="14" aria-hidden="true" />{{ copiedKey ? '已复制' : '复制' }}</button></code>
        <div class="secret-line">
          <code>SK：{{ created.clientSecret }}</code>
          <button class="secret-copy" :class="{ copied }" type="button" @click="copySecret">
            <Check v-if="copied" :size="14" aria-hidden="true" />
            <Copy v-else :size="14" aria-hidden="true" />
            {{ copied ? '已复制' : '复制' }}
          </button>
        </div>
      </div>
      <div class="admin-page-actions">
        <button class="button-primary" type="button" @click="goToDetail">我已妥善保存，查看客户端</button>
      </div>
    </div>

    <section v-else class="admin-data-surface">
      <div class="data-toolbar">
        <div>
          <h2>客户端信息</h2>
          <p>创建后 AccessKey 立即可用，SecretKey 只在本次返回中明文出现。</p>
        </div>
      </div>
      <form class="detail-maintenance" @submit.prevent="submitCreate">
        <fieldset class="client-editor">
          <legend>基础信息</legend>
          <label>
            <span>类型</span>
            <FormSelect v-model="form.type" :options="clientTypeOptions" aria-label="客户端类型" disabled />
          </label>
          <label>
            <span>名称</span>
            <input v-model="form.name" required placeholder="客户端名称">
          </label>
          <p class="drawer-hint-block">用户级 AKU（归属 IAM 用户）须由本人登录统一应用门户，在「我的 AKSK 访问凭证」页自助创建；其接口与数据授权来自 IAM 权限投影。</p>
        </fieldset>
        <footer class="drawer-actions">
          <button class="button-secondary" type="button" :disabled="pending" @click="router.push('/clients')">取消</button>
          <button class="button-primary" type="submit" :disabled="pending">{{ pending ? '正在创建…' : '创建客户端' }}</button>
        </footer>
      </form>
    </section>
  </section>
</template>
