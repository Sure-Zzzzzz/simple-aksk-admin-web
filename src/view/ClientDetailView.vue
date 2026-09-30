<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Check, Copy } from 'lucide-vue-next';
import CopyButton from '../components/CopyButton.vue';
import AkskPageHeader from '../components/AkskPageHeader.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import {
  deleteAkskClient,
  getAkskClient,
  resetAkskClientSecret,
  updateAkskClient,
  type AkskClientInfo,
  type ResetAkskSecretResult
} from '../api/akskAuth';

const route = useRoute();
const router = useRouter();
const clientId = route.params.clientId as string;

const client = ref<AkskClientInfo | null>(null);
const notFound = ref(false);
const loading = ref(false);
const message = ref('');
const errorMessage = ref('');

const nameForm = reactive({ name: '' });
const ownerForm = reactive({ ownerUserId: '', ownerUsername: '' });

function ownerLabel(client: AkskClientInfo): string {
  return client.ownerUsername || client.ownerUserId || '—';
}
const resetForm = reactive({ revokeTokens: true });
const resetPending = ref(false);
const resetResult = ref<ResetAkskSecretResult | null>(null);
const resetCopied = ref(false);
const deleteConfirmOpen = ref(false);
const deletePending = ref(false);

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function fillForms(detail: AkskClientInfo) {
  nameForm.name = detail.clientName;
  ownerForm.ownerUserId = detail.ownerUserId ?? '';
  ownerForm.ownerUsername = detail.ownerUsername ?? '';
  resetResult.value = null;
  resetCopied.value = false;
}

async function loadClient() {
  loading.value = true;
  errorMessage.value = '';
  try {
    client.value = await getAkskClient(clientId);
    notFound.value = false;
    fillForms(client.value);
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') {
      notFound.value = true;
      client.value = null;
    } else {
      errorMessage.value = error instanceof Error ? error.message : '加载客户端详情失败';
    }
  } finally {
    loading.value = false;
  }
}

async function toggleEnabled() {
  if (!client.value) {
    return;
  }
  message.value = '';
  errorMessage.value = '';
  try {
    await updateAkskClient(client.value.clientId, { enabled: !client.value.enabled });
    message.value = client.value.enabled ? '客户端已禁用' : '客户端已启用';
    await loadClient();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '更新状态失败';
  }
}

async function submitName() {
  if (!client.value || !nameForm.name.trim()) {
    return;
  }
  message.value = '';
  errorMessage.value = '';
  try {
    await updateAkskClient(client.value.clientId, { name: nameForm.name.trim() });
    message.value = '名称已更新';
    await loadClient();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '更新名称失败';
  }
}

async function submitOwner() {
  if (!client.value) {
    return;
  }
  if (!ownerForm.ownerUserId.trim() || !ownerForm.ownerUsername.trim()) {
    errorMessage.value = '归属主体 ID 与用户名不能为空';
    return;
  }
  message.value = '';
  errorMessage.value = '';
  try {
    await updateAkskClient(client.value.clientId, {
      ownerUserId: ownerForm.ownerUserId.trim(),
      ownerUsername: ownerForm.ownerUsername.trim()
    });
    message.value = '归属已更新';
    await loadClient();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '更新归属失败';
  }
}

async function submitResetSecret() {
  if (!client.value) {
    return;
  }
  message.value = '';
  errorMessage.value = '';
  resetPending.value = true;
  try {
    resetResult.value = await resetAkskClientSecret(client.value.clientId, resetForm.revokeTokens);
    message.value = '密钥已重置';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '重置密钥失败';
  } finally {
    resetPending.value = false;
  }
}

async function copyResetSecret() {
  if (!resetResult.value) {
    return;
  }
  try {
    await navigator.clipboard.writeText(resetResult.value.clientSecret);
    resetCopied.value = true;
  } catch {
    resetCopied.value = false;
  }
}

async function confirmDelete() {
  if (!client.value) {
    return;
  }
  deletePending.value = true;
  try {
    await deleteAkskClient(client.value.clientId);
    deleteConfirmOpen.value = false;
    await router.push('/clients');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '删除客户端失败';
    deleteConfirmOpen.value = false;
  } finally {
    deletePending.value = false;
  }
}

onMounted(() => {
  void loadClient();
});
</script>

<template>
  <section class="management-page">
    <template v-if="notFound">
      <AkskPageHeader title="客户端详情" description="该客户端不存在或已被删除。" />
      <div class="admin-empty-state">
        <h2>客户端不存在</h2>
        <button class="button-primary" type="button" @click="router.push('/clients')">返回客户端列表</button>
      </div>
    </template>
    <template v-else>
      <AkskPageHeader
        :title="client ? `客户端：${client.clientName}` : '客户端详情'"
        :description="client ? `${client.clientId} · ${client.clientType === 1 ? '平台级 AKP' : '用户级 AKU'}` : ''"
      >
        <template #actions>
          <button class="button-secondary" type="button" @click="router.push(`/authorizations/${encodeURIComponent(clientId)}`)">配授权</button>
          <button class="button-primary" type="button" :disabled="loading" @click="toggleEnabled">
            {{ client?.enabled ? '禁用客户端' : '启用客户端' }}
          </button>
        </template>
      </AkskPageHeader>
      <p v-if="message" class="admin-message success" role="status">{{ message }}<button class="admin-message-dismiss" type="button" aria-label="关闭提示" @click="message = ''">×</button></p>
      <p v-if="errorMessage" class="admin-message error" role="alert">{{ errorMessage }}<button class="admin-message-dismiss" type="button" aria-label="关闭提示" @click="errorMessage = ''">×</button></p>

      <section class="admin-data-surface">
        <div class="data-toolbar">
          <div>
            <h2>基本信息</h2>
            <p>AccessKey 即客户端 ID；SecretKey 仅在创建与重置时一次性返回。</p>
          </div>
        </div>
        <dl v-if="client" class="detail-grid detail-maintenance">
          <div>
            <dt>AccessKey（客户端 ID）</dt>
            <dd class="secret-line"><code>{{ client.clientId }}</code><CopyButton :value="client.clientId" label="AK" ghost /></dd>
          </div>
          <div>
            <dt>名称</dt>
            <dd>{{ client.clientName }}</dd>
          </div>
          <div>
            <dt>类型</dt>
            <dd>{{ client.clientType === 1 ? 'AKP 平台级' : 'AKU 用户级' }}</dd>
          </div>
          <div>
            <dt>归属</dt>
            <dd>{{ ownerLabel(client) }}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>
              <span class="status-badge" :class="client.enabled ? 'success' : 'neutral'">{{ client.enabled ? '启用' : '禁用' }}</span>
            </dd>
          </div>
          <div>
            <dt>签发时间</dt>
            <dd>{{ formatDateTime(client.clientIdIssuedAt) }}</dd>
          </div>
        </dl>
      </section>

      <section class="admin-data-surface">
        <div class="data-toolbar">
          <div>
            <h2>维护</h2>
            <p>单字段更新：每次提交仅修改对应字段；归属调整需稳定主体 ID 与用户名成对提交。</p>
          </div>
        </div>
        <div class="detail-maintenance">
          <form class="inline-form" @submit.prevent="submitName">
            <label>
              <span>名称</span>
              <input v-model="nameForm.name" required placeholder="客户端名称">
            </label>
            <button class="button-secondary ghost" type="submit">更新名称</button>
          </form>
          <form v-if="client?.clientType === 2" class="inline-form" @submit.prevent="submitOwner">
            <div class="inline-form-row">
              <label>
                <span>归属主体 ID</span>
                <input v-model="ownerForm.ownerUserId" required placeholder="IAM 稳定主体 ID">
              </label>
              <label>
                <span>归属用户名</span>
                <input v-model="ownerForm.ownerUsername" required placeholder="IAM 用户名">
              </label>
            </div>
            <button class="button-secondary ghost" type="submit">更新归属</button>
          </form>
          <form class="inline-form" @submit.prevent="submitResetSecret">
            <label class="checkbox-field">
              <input v-model="resetForm.revokeTokens" type="checkbox">
              <span>同时吊销该客户端既有全部令牌（建议保持勾选，防止旧密钥签发的令牌继续有效）</span>
            </label>
            <button class="button-secondary ghost" type="submit" :disabled="resetPending">
              {{ resetPending ? '正在重置…' : '重置 SecretKey' }}
            </button>
          </form>
          <div v-if="resetResult" class="secret-reveal" role="status">
            <p>客户端 {{ resetResult.clientId }} 的新 SecretKey（仅此一次展示）：</p>
            <div class="secret-line">
              <code>{{ resetResult.clientSecret }}</code>
              <button class="secret-copy" :class="{ copied: resetCopied }" type="button" @click="copyResetSecret">
                <Check v-if="resetCopied" :size="14" aria-hidden="true" />
                <Copy v-else :size="14" aria-hidden="true" />
                {{ resetCopied ? '已复制' : '复制' }}
              </button>
            </div>
          </div>
          <div class="inline-form">
            <span class="drawer-hint">删除将先撤销该客户端下所有令牌，再删除客户端本体；应用授权记录不会级联删除。</span>
            <button class="button-danger" type="button" @click="deleteConfirmOpen = true">删除客户端</button>
          </div>
        </div>
      </section>

      <ConfirmDialog
        :open="deleteConfirmOpen"
        title="删除客户端"
        :description="`将删除客户端 ${client?.clientId ?? ''}：该客户端下所有令牌将被撤销，删除后不可恢复。确定删除？`"
        confirm-label="确认删除"
        :pending="deletePending"
        @close="!deletePending && (deleteConfirmOpen = false)"
        @confirm="confirmDelete"
      />
    </template>
  </section>
</template>
