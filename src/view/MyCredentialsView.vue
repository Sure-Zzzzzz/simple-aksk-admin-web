<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Check, Copy, KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-vue-next';
import AkskPageHeader from '../components/AkskPageHeader.vue';
import Dialog from '@sure-zzzzzz/simple-iam-theme-contract/Dialog';
import FormSelect, { type FormSelectOption } from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import {
  createMyAkskClient,
  listMyAkskCandidateApplications,
  listMyAkskClients,
  renameMyAkskClient,
  rotateMyAkskSecret,
  terminateMyAkskClient,
  type AkskCandidateApplication,
  type AkskClientInfo
} from '../api/akskAuth';

const credentialColumns: DataTableColumn[] = [
  { key: 'clientName', label: '凭证' },
  { key: 'targetApplication', label: '目标业务应用' },
  { key: 'enabled', label: '状态' },
  { key: 'clientIdIssuedAt', label: '创建时间' },
  { key: 'actions', label: '操作', align: 'right' },
];

const clients = ref<AkskClientInfo[]>([]);
const candidates = ref<AkskCandidateApplication[]>([]);
// 身份源投影同步租约过期（X-Aksk-Projection-Degraded，server 3.2.1+）：空候选可能是"读不到"而非"没授权"
const projectionDegraded = ref(false);
const loading = ref(false);
const pending = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const showCreate = ref(false);
const showSecret = ref<AkskClientInfo | null>(null);
const copied = ref(false);
const copiedKey = ref(false);
const confirmClient = ref<AkskClientInfo | null>(null);
const editingClientId = ref('');
const editingName = ref('');
const createForm = ref({ applicationId: '', clientName: '' });

const applicationOptions = computed<FormSelectOption[]>(() =>
  candidates.value.map(candidate => ({
    label: `${candidate.applicationName}（${candidate.applicationCodeSnapshot}）`,
    value: String(candidate.applicationId)
  }))
);

function clearNotice() {
  errorMessage.value = '';
  successMessage.value = '';
}

function closeDialogs() {
  if (showSecret.value) {
    showSecret.value = null;
    return;
  }
  if (showCreate.value) {
    showCreate.value = false;
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeDialogs();
  }
}

function formatDateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function applicationLabel(applicationId: number | null | undefined): string {
  if (!applicationId) {
    return '已授权业务应用';
  }
  const application = candidates.value.find(item => item.applicationId === applicationId);
  return application ? `${application.applicationName}（${application.applicationCodeSnapshot}）` : `业务应用 #${applicationId}（已不在当前候选目录，可能已撤授权或停用继承）`;
}

function idempotencyKey(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

async function load() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const [items, candidateResult] = await Promise.all([listMyAkskClients(), listMyAkskCandidateApplications()]);
    clients.value = items;
    candidates.value = candidateResult.applications;
    projectionDegraded.value = candidateResult.degraded;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载我的访问凭证失败';
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  clearNotice();
  createForm.value = { applicationId: candidates.value[0] ? String(candidates.value[0].applicationId) : '', clientName: '' };
  showCreate.value = true;
}

async function submitCreate() {
  const applicationId = Number(createForm.value.applicationId);
  const clientName = createForm.value.clientName.trim();
  if (!Number.isSafeInteger(applicationId) || applicationId <= 0 || !clientName) {
    errorMessage.value = '请选择业务应用并填写凭证名称';
    return;
  }
  pending.value = true;
  clearNotice();
  try {
    showSecret.value = await createMyAkskClient({ targetApplicationId: applicationId, clientName }, idempotencyKey());
    copied.value = false;
    showCreate.value = false;
    await load();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '创建访问凭证失败';
  } finally {
    pending.value = false;
  }
}

function beginRename(client: AkskClientInfo) {
  clearNotice();
  editingClientId.value = client.clientId;
  editingName.value = client.clientName;
}

async function saveRename(client: AkskClientInfo) {
  const name = editingName.value.trim();
  if (!name || !client.lifecycleVersion) {
    errorMessage.value = '凭证版本已失效，请刷新后重试';
    return;
  }
  pending.value = true;
  clearNotice();
  try {
    await renameMyAkskClient(client.clientId, name, client.lifecycleVersion);
    successMessage.value = '凭证名称已更新';
    editingClientId.value = '';
    await load();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '修改凭证名称失败';
  } finally {
    pending.value = false;
  }
}

async function rotate(client: AkskClientInfo) {
  if (!client.lifecycleVersion) {
    errorMessage.value = '凭证版本已失效，请刷新后重试';
    return;
  }
  pending.value = true;
  clearNotice();
  try {
    showSecret.value = await rotateMyAkskSecret(client.clientId, client.lifecycleVersion);
    copied.value = false;
    await load();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '轮换密钥失败';
  } finally {
    pending.value = false;
  }
}

async function terminate() {
  const client = confirmClient.value;
  confirmClient.value = null;
  if (!client?.lifecycleVersion) {
    return;
  }
  pending.value = true;
  clearNotice();
  try {
    await terminateMyAkskClient(client.clientId, client.lifecycleVersion);
    successMessage.value = '访问凭证已撤销';
    await load();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '撤销访问凭证失败';
  } finally {
    pending.value = false;
  }
}

async function copySecret() {
  if (!showSecret.value?.clientSecret) {
    return;
  }
  try {
    await navigator.clipboard.writeText(showSecret.value.clientSecret);
    copied.value = true;
  } catch {
    errorMessage.value = '浏览器未允许访问剪贴板，请手动复制';
  }
}

async function copyAccessKey() {
  if (!showSecret.value?.clientId) {
    return;
  }
  try {
    await navigator.clipboard.writeText(showSecret.value.clientId);
    copiedKey.value = true;
  } catch {
    errorMessage.value = '浏览器未允许访问剪贴板，请手动复制';
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  void load();
});

onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <section class="management-page self-credentials-page">
    <AkskPageHeader
      title="我的 AKSK 访问凭证"
      description="只管理当前登录账号自己的访问凭证。可用业务应用由 IAM 授权决定，凭证密钥只在创建或轮换成功时展示一次。"
    >
      <template #actions>
        <button class="button-primary" type="button" :disabled="loading || !candidates.length" :title="candidates.length ? '从已授权业务应用创建凭证' : (projectionDegraded ? '业务应用目录同步暂不可用，不代表没有权限' : '暂无可创建的业务应用（需已获业务应用授权并启用个人凭证创建）')" @click="openCreate">
          <Plus :size="16" aria-hidden="true" />
          新建访问凭证
        </button>
      </template>
    </AkskPageHeader>

    <div class="self-credentials-notice">
      <ShieldCheck :size="20" aria-hidden="true" />
      <div>
        <strong>凭证权限跟随 IAM 授权</strong>
        <p>组织、部门或角色发生变化后，凭证状态会按 IAM 的最新授权自动更新。</p>
      </div>
    </div>

    <p v-if="successMessage" class="admin-message success" role="status">{{ successMessage }}<button class="admin-message-dismiss" type="button" aria-label="关闭提示" @click="successMessage = ''">×</button></p>
    <p v-if="errorMessage" class="admin-message error" role="alert">{{ errorMessage }}<button class="admin-message-dismiss" type="button" aria-label="关闭提示" @click="errorMessage = ''">×</button></p>

    <section v-if="loading" class="admin-empty-state self-credentials-empty" aria-live="polite" aria-busy="true">
      <RefreshCw class="dashboard-icon is-spinning" aria-hidden="true" />
      <h2>正在加载凭证</h2>
      <p>正在同步当前账号的凭证和 IAM 应用授权。</p>
    </section>

    <section v-else-if="errorMessage && !clients.length" class="admin-empty-state self-credentials-empty">
      <ShieldCheck class="dashboard-icon danger-icon" aria-hidden="true" />
      <h2>凭证暂时加载失败</h2>
      <p>没有读取到当前账号的凭证，请检查登录状态后重试。</p>
      <button class="button-primary" type="button" @click="load">重新加载</button>
    </section>

    <section v-else-if="!clients.length" class="admin-empty-state self-credentials-empty">
      <KeyRound class="dashboard-icon" aria-hidden="true" />
      <h2>还没有自己的访问凭证</h2>
      <p v-if="candidates.length">从已获 IAM 授权的业务应用中创建一枚访问凭证，用于访问对应业务 API。</p>
      <template v-else-if="projectionDegraded">
        <p>业务应用目录暂时读不到——身份源授权同步当前不可用，<strong>这不代表你没有权限</strong>。</p>
        <p>请稍后重试；若持续出现，请联系管理员检查 AKSK 与身份源的授权同步状态。</p>
        <button class="button-primary" type="button" @click="load">重新加载</button>
      </template>
      <template v-else>
        <p>当前没有可创建的业务应用。</p>
        <p>可创建访问凭证的业务应用需同时满足：在统一身份平台登记为可信应用、启用个人凭证创建，且已授权给你或你的角色。请联系管理员确认应用准入与个人凭证设置。</p>
      </template>
      <button v-if="candidates.length" class="button-primary" type="button" @click="openCreate">创建第一枚凭证</button>
    </section>

    <section v-else class="admin-data-surface">
      <div class="data-toolbar">
        <div>
          <h2>我的凭证 <span>{{ clients.length }}</span></h2>
          <p>凭证仅用于当前账号访问已授权的业务应用。</p>
        </div>
      </div>
      <DataTable
        class="self-credentials-table"
        :columns="credentialColumns"
        :rows="clients"
        row-key="clientId"
        :loading="pending && !clients.length"
        empty-text="还没有凭证：点击右上角新建。"
      >
        <template #cell-clientName="{ row }">
          <div v-if="editingClientId === row.clientId" class="rename-cell">
            <input v-model="editingName" maxlength="128" aria-label="凭证名称" @keyup.enter="saveRename(row)">
            <button class="table-action" type="button" :disabled="pending" @click="saveRename(row)">保存</button>
            <button class="table-action" type="button" @click="editingClientId = ''">取消</button>
          </div>
          <div v-else class="table-primary-action">
            <strong>{{ row.clientName }}</strong>
          </div>
        </template>
        <template #cell-targetApplication="{ row }"><span class="muted-inline">{{ applicationLabel(row.targetApplicationId) }}</span></template>
        <template #cell-enabled="{ row }"><span class="status-badge" :class="row.enabled ? 'success' : 'warning'">{{ row.enabled ? '可用' : '已停用' }}</span></template>
        <template #cell-clientIdIssuedAt="{ row }">{{ formatDateTime(row.clientIdIssuedAt) }}</template>
        <template #cell-actions="{ row }">
          <div class="table-actions-inline">
            <button class="table-action" type="button" :disabled="pending || !row.enabled" @click="rotate(row)">
              <RefreshCw :size="14" aria-hidden="true" />轮换密钥
            </button>
            <button class="table-action" type="button" :disabled="pending" @click="beginRename(row)">
              <Pencil :size="14" aria-hidden="true" />重命名
            </button>
            <button class="table-action danger" type="button" :disabled="pending" @click="confirmClient = row">
              <Trash2 :size="14" aria-hidden="true" />撤销
            </button>
          </div>
        </template>
      </DataTable>
    </section>

    <div v-if="showCreate" class="self-credentials-dialog" role="dialog" aria-modal="true" aria-labelledby="create-credential-title">
      <div class="self-credentials-dialog-card" @click.stop>
        <header><div><span class="dialog-eyebrow">MY CREDENTIAL</span><h2 id="create-credential-title">新建访问凭证</h2></div><button class="icon-button" type="button" aria-label="关闭" @click="showCreate = false"><X :size="18" aria-hidden="true" /></button></header>
        <p class="drawer-hint-block">凭证会绑定到当前登录用户，不能转让给其他用户。</p>
        <label>目标业务应用<FormSelect v-model="createForm.applicationId" :options="applicationOptions" aria-label="目标业务应用" placeholder="请选择已授权应用" /></label>
        <label>凭证名称<input v-model="createForm.clientName" maxlength="128" placeholder="例如：我的报表访问凭证"></label>
        <footer class="drawer-actions"><button class="button-secondary" type="button" :disabled="pending" @click="showCreate = false">取消</button><button class="button-primary" type="button" :disabled="pending" @click="submitCreate">{{ pending ? '正在创建…' : '创建凭证' }}</button></footer>
      </div>
    </div>

    <div v-if="showSecret" class="self-credentials-dialog" role="dialog" aria-modal="true" aria-labelledby="secret-title">
      <div class="self-credentials-dialog-card secret-card" @click.stop>
        <header><div><span class="dialog-eyebrow">ONE-TIME SECRET</span><h2 id="secret-title">请立即保存 SecretKey</h2></div><button class="icon-button" type="button" aria-label="关闭" @click="showSecret = null"><X :size="18" aria-hidden="true" /></button></header>
        <p class="drawer-hint-block">关闭后无法再次查看明文 SecretKey。轮换会立即使旧密钥失效。</p>
        <dl class="secret-list"><div><dt>AccessKey</dt><dd class="secret-line"><code>{{ showSecret.clientId }}</code><button class="secret-copy" :class="{ copied: copiedKey }" type="button" @click="copyAccessKey"><Check v-if="copiedKey" :size="14" aria-hidden="true" /><Copy v-else :size="14" aria-hidden="true" />{{ copiedKey ? '已复制' : '复制' }}</button></dd></div><div><dt>SecretKey</dt><dd class="secret-line"><code>{{ showSecret.clientSecret || '服务端未返回明文密钥' }}</code><button class="secret-copy" :class="{ copied }" type="button" :disabled="!showSecret.clientSecret" @click="copySecret"><Check v-if="copied" :size="14" aria-hidden="true" /><Copy v-else :size="14" aria-hidden="true" />{{ copied ? '已复制' : '复制' }}</button></dd></div></dl>
        <footer class="drawer-actions"><button class="button-primary" type="button" @click="showSecret = null">我已保存</button></footer>
      </div>
    </div>

    <Dialog
      v-if="confirmClient"
      :open="true"
      title="撤销访问凭证"
      :description="`撤销后 ${confirmClient.clientName} 将立即失效，相关令牌也不能继续使用。`"
      confirm-label="确认撤销"
      variant="danger"
      @confirm="terminate"
      @close="confirmClient = null"
    />
  </section>
</template>
