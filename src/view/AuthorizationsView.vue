<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import AkskPageHeader from '../components/AkskPageHeader.vue';
import Dialog from '@sure-zzzzzz/simple-iam-theme-contract/Dialog';
import CopyButton from '../components/CopyButton.vue';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import {
  listAkskApplicationAuthorizations,
  revokeAkskApplicationAuthorization,
  type AkskApplicationAuthorization
} from '../api/akskAuth';

const router = useRouter();

const authorizations = ref<AkskApplicationAuthorization[]>([]);
const loading = ref(false);
const message = ref('');
const errorMessage = ref('');

const newClientForm = reactive({ clientId: '' });

const pageSize = ref(20);
const currentPage = ref(1);
const totalPages = ref(1);
const totalElements = ref(0);

const revokeTarget = ref<AkskApplicationAuthorization | null>(null);
const revokePending = ref(false);

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function changePage(page: number) {
  if (page < 1 || page > totalPages.value || page === currentPage.value) {
    return;
  }
  currentPage.value = page;
  void loadAuthorizations();
}

function changePageSize(size: number) {
  if (size < 1 || size === pageSize.value) {
    return;
  }
  pageSize.value = size;
  currentPage.value = 1;
  void loadAuthorizations();
}

async function loadAuthorizations() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const page = await listAkskApplicationAuthorizations({
      page: currentPage.value,
      size: pageSize.value
    });
    authorizations.value = page.data;
    totalElements.value = page.total;
    totalPages.value = Math.max(page.totalPages, 1);
    currentPage.value = page.page;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载应用授权列表失败';
  } finally {
    loading.value = false;
  }
}

const authorizationColumns: DataTableColumn[] = [
  { key: 'clientId', label: '客户端' },
  { key: 'applicationCode', label: '应用编码' },
  { key: 'clientTypeLabel', label: '类型' },
  { key: 'admitted', label: '准入' },
  { key: 'status', label: '状态' },
  { key: 'authorizationVersion', label: '版本' },
  { key: 'updatedAt', label: '更新时间' },
  { key: 'actions', label: '操作', align: 'right' },
];

function goEditor(clientId: string) {
  void router.push(`/authorizations/${encodeURIComponent(clientId)}`);
}

async function confirmRevoke() {
  const target = revokeTarget.value;
  if (!target) {
    return;
  }
  revokePending.value = true;
  try {
    await revokeAkskApplicationAuthorization(target.clientId);
    revokeTarget.value = null;
    message.value = `已撤销 ${target.clientId} 的应用授权`;
    await loadAuthorizations();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '撤销应用授权失败';
    revokeTarget.value = null;
  } finally {
    revokePending.value = false;
  }
}

onMounted(() => {
  void loadAuthorizations();
});
</script>

<template>
  <section class="management-page">
    <AkskPageHeader
      title="应用授权"
      description="按客户端配置应用授权：准入开关、角色与权限清单、数据授权文档；保存为整单替换。"
    />
    <p v-if="message" class="admin-message success" role="status">{{ message }}<button class="admin-message-dismiss" type="button" aria-label="关闭提示" @click="message = ''">×</button></p>
    <p v-if="errorMessage" class="admin-message error" role="alert">{{ errorMessage }}<button class="admin-message-dismiss" type="button" aria-label="关闭提示" @click="errorMessage = ''">×</button></p>

    <section class="admin-data-surface">
      <div class="data-toolbar">
        <div>
          <h2>授权列表 <span>{{ totalElements }}</span></h2>
          <p>每客户端至多一份授权：撤销后可重新配置，未准入的授权不会向令牌签发权限快照。</p>
        </div>
        <form class="admin-page-actions" @submit.prevent="newClientForm.clientId.trim() && goEditor(newClientForm.clientId.trim())">
          <div class="search-field">
            <label class="sr-only" for="new-authorization-client">客户端 ID</label>
            <input id="new-authorization-client" v-model="newClientForm.clientId" type="search" placeholder="输入客户端 ID 配置授权" aria-label="客户端 ID">
          </div>
          <button class="button-primary" type="submit" :disabled="!newClientForm.clientId.trim()">配置授权</button>
        </form>
      </div>
      <DataTable
        :columns="authorizationColumns"
        :rows="authorizations"
        row-key="clientId"
        :loading="loading"
        empty-text="暂无应用授权：在上方输入客户端 ID 开始配置。"
      >
        <template #cell-clientId="{ row }">
          <div class="client-cell">
            <button class="table-primary-action" type="button" @click="goEditor(row.clientId)">
              <strong>{{ row.clientId }}</strong>
              <span>{{ row.clientType === 1 ? 'AKP 平台级' : 'AKU 用户级' }}</span>
            </button>
            <CopyButton :value="row.clientId" label="AK" ghost />
          </div>
        </template>
        <template #cell-clientTypeLabel="{ row }">{{ row.clientType === 1 ? 'AKP' : 'AKU' }}</template>
        <template #cell-admitted="{ row }">
          <span class="status-badge" :class="row.admitted ? 'success' : 'warning'">
            {{ row.admitted ? '已准入' : '草稿' }}
          </span>
        </template>
        <template #cell-status="{ row }">
          <span v-if="row.revokedAt" class="status-badge danger">已撤销</span>
          <span v-else class="status-badge" :class="row.enabled ? 'success' : 'neutral'">
            {{ row.enabled ? '生效中' : '已停用' }}
          </span>
        </template>
        <template #cell-authorizationVersion="{ row }">v{{ row.authorizationVersion }}</template>
        <template #cell-updatedAt="{ row }">{{ formatDateTime(row.updatedAt) }}</template>
        <template #cell-actions="{ row }">
          <div class="table-actions-inline">
            <button class="table-action" type="button" @click="goEditor(row.clientId)">编辑</button>
            <button
              v-if="!row.revokedAt"
              class="table-action danger"
              type="button"
              @click="revokeTarget = row"
            >
              撤销
            </button>
          </div>
        </template>
      </DataTable>
      <Pagination
        v-if="totalElements > 0"
        :current="currentPage"
        :total="totalElements"
        :page-size="pageSize"
        @update:current="changePage"
        @update:page-size="changePageSize"
      />
    </section>

    <Dialog
      :open="revokeTarget !== null"
      title="撤销应用授权"
      :description="`撤销后 ${revokeTarget?.clientId ?? ''} 不再向新令牌签发授权快照，该客户端全部活跃令牌一并失效。确定撤销？`"
      confirm-label="确认撤销"
      :pending="revokePending"
      @close="!revokePending && (revokeTarget = null)"
      @confirm="confirmRevoke"
    />
  </section>
</template>
